import { execFile } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import { parse } from "yaml"

type Step = {
  name?: string
  id?: string
  uses?: string
  run?: string
  with?: Record<string, string | boolean>
  env?: Record<string, string>
}
type Workflow = {
  on: Record<
    string,
    {
      branches?: string[]
      "branches-ignore"?: string[]
      inputs?: Record<string, unknown>
      secrets?: Record<string, unknown>
    } | null
  >
  permissions: Record<string, string>
  jobs: Record<
    string,
    {
      environment?: string
      if?: string
      needs?: string | string[]
      uses?: string
      with?: Record<string, string>
      secrets?: Record<string, string>
      steps?: Step[]
      strategy?: { matrix: { target: string[] } }
    }
  >
}
const root = fileURLToPath(new URL("../../", import.meta.url))
const load = (path: string) => readFileSync(join(root, path), "utf8")
const ci = parse(load(".github/workflows/ci.yml")) as Workflow
const release = parse(load(".github/workflows/release.yml")) as Workflow
const publisher = release.jobs.publish
const execute = promisify(execFile)
const folders: string[] = []
const sha = "a".repeat(40)
const olderSha = "b".repeat(40)

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

describe("release and publishing workflow contracts", () => {
  it("keeps PR/branch CI secret-free and publishes only after the exact source passes CI", () => {
    expect(ci.on).toHaveProperty("pull_request")
    expect(ci.on).toHaveProperty("workflow_dispatch")
    expect(ci.on).toHaveProperty("workflow_call")
    expect(ci.on.push?.["branches-ignore"]).toContain("main")
    expect(ci.permissions).toEqual({ contents: "read" })
    expect(load(".github/workflows/ci.yml")).not.toContain("secrets.DOCKER_")
    expect(release.on.push?.branches).toEqual(["main"])
    expect(release.jobs.prepare.if).toContain("github.repository == 'guneet-xyz/dockyard'")
    expect(release.jobs.prepare.if).toContain("github.ref == 'refs/heads/main'")
    expect(release.jobs.checks.uses).toBe("./.github/workflows/ci.yml")
    expect(release.jobs.publish.needs).toContain("checks")
    expect(release.jobs.checks.with?.ref).toBe(
      publisher.steps!.find((step) => step.uses === "actions/checkout@v4")?.with?.ref,
    )
    expect(release.jobs.publish).not.toHaveProperty("secrets")
    expect(publisher.environment).toBe("release")
    expect(publisher).not.toHaveProperty("uses")
    expect(
      release.jobs.prepare.steps?.find((step) => step.name?.startsWith("Dispatch quality"))?.run,
    ).toContain('gh workflow run ci.yml --ref "$branch"')
  })

  it("builds all Dockerfile targets for both architectures without passing secrets to builds", () => {
    const targets = publisher.strategy!.matrix.target
    expect(targets).toEqual(["init", "migrate", "web", "ingress"])
    for (const target of targets)
      expect(load("Dockerfile")).toMatch(new RegExp(`^FROM .+ AS ${target}$`, "m"))
    const build = publisher.steps!.find((step) => step.id === "build")!
    expect(build.with?.platforms).toBe("linux/amd64,linux/arm64")
    expect(build.with?.target).toBe("${{ matrix.target }}")
    expect(build.with?.push).toBe(true)
    expect(build.with).not.toHaveProperty("build-args")
    expect(build.with).not.toHaveProperty("secrets")
    expect(
      publisher.steps!.find((step) => step.name === "Log in to the Dockyard registry")?.with
        ?.registry,
    ).toBe("cr.guneet.dev")
    const metadata = publisher.steps!.find((step) => step.id === "meta")!
    expect(metadata.with?.images).toBe("cr.guneet.dev/dockyard/${{ matrix.target }}")
    expect(metadata.with?.flavor).toBe("latest=false")
    expect(metadata.with?.context).toBe("workflow")
    expect(metadata.with?.tags).toContain("type=raw,value=sha-${{ needs.prepare.outputs.sha }}")
    expect(metadata.with?.labels).toContain(
      "org.opencontainers.image.revision=${{ needs.prepare.outputs.sha }}",
    )
    expect(metadata.with?.tags).toContain(
      "type=raw,value=edge,enable=${{ needs.prepare.outputs.edge == 'true' }}",
    )
    expect(metadata.with?.tags).toContain(
      "type=raw,value=latest,enable=${{ needs.prepare.outputs.aliases == 'true' && needs.prepare.outputs.version != '' }}",
    )
  })

  it("uses a single conventional-commit application version, with a bootstrap or matching released manifest", () => {
    const config = JSON.parse(load("release-please-config.json"))
    const manifest = JSON.parse(load(".release-please-manifest.json"))
    expect(Object.keys(config.packages)).toEqual(["."])
    expect(config.packages["."]["release-type"]).toBe("node")
    expect(config.packages["."]["include-component-in-tag"]).toBe(false)
    expect(config.packages["."]["initial-version"]).toBe("0.1.0")
    if (manifest["."]) expect(manifest["."]).toBe(JSON.parse(load("package.json")).version)
    expect(load(".prettierignore")).toContain("CHANGELOG.md")
    expect(load(".prettierignore")).toContain(".release-please-manifest.json")
  })

  it("uses a configurable published namespace for all four Compose images", () => {
    const compose = parse(load("deploy/compose.yaml"))
    for (const target of ["init", "migrate", "web", "ingress"]) {
      expect(compose.services[target].image).toBe(
        `\${DOCKYARD_IMAGE_PREFIX:-cr.guneet.dev/dockyard}/${target}:\${DOCKYARD_IMAGE_TAG:-local}`,
      )
    }
    expect(compose.services.postgres.image).toBe("postgres:17-alpine")
    expect(compose.services.registry.image).toBe("registry:3.1.2")
  })
})

describe("publication preflight and early-failure cleanup", () => {
  const preflight = publisher.steps!.find(
    (step) => step.name === "Check release version and registry credentials",
  )!.run!
  const version = JSON.parse(load("package.json")).version as string
  function checkCredentials(env: Record<string, string>) {
    return execute("/bin/bash", ["-c", preflight], {
      cwd: root,
      env: {
        ...process.env,
        DOCKER_USERNAME: "test-user",
        DOCKER_PASSWORD: "test-secret",
        RELEASE_VERSION: "",
        ...env,
      },
    })
  }
  it("accepts environment credentials for development and version-matching releases", async () => {
    await expect(checkCredentials({})).resolves.toMatchObject({ stdout: "" })
    await expect(checkCredentials({ RELEASE_VERSION: version })).resolves.toMatchObject({
      stdout: "",
    })
  })
  it.each(["DOCKER_USERNAME", "DOCKER_PASSWORD"])(
    "fails clearly when %s is missing without printing the other secret",
    async (key) => {
      await expect(checkCredentials({ [key]: "" })).rejects.toMatchObject({
        code: 1,
        stderr: "Set DOCKER_USERNAME and DOCKER_PASSWORD secrets in the release environment\n",
      })
    },
  )
  it("refuses to label source with a different or prerelease version", async () => {
    await expect(checkCredentials({ RELEASE_VERSION: "999.0.0" })).rejects.toMatchObject({
      code: 1,
    })
    await expect(checkCredentials({ RELEASE_VERSION: `${version}-rc.1` })).rejects.toMatchObject({
      code: 1,
    })
  })
  it("skips Compose logs and cleanup when failure occurs before environment generation", async () => {
    const folder = await mkdtemp(
      join(existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir(), "dockyard-cleanup-test-"),
    )
    folders.push(folder)
    for (const name of ["Service logs on failure", "Stop test services"]) {
      const script = ci.jobs.checks.steps!.find((step) => step.name === name)!.run!
      await expect(execute("/bin/bash", ["-c", script], { cwd: folder })).resolves.toMatchObject({
        stdout: "",
        stderr: "",
      })
    }
  })
})

describe("read-only registry permission preflight", () => {
  const run = publisher.steps!.find(
    (step) => step.name === "Verify scoped registry permissions",
  )!.run!
  const script = run.slice(run.indexOf("const registry"), run.lastIndexOf("\nNODE"))
  function checkAccess({
    actions = ["pull", "push"],
    realm = "https://cr.guneet.dev/api/registry/token",
    status = 200,
    target = "init",
    repository = `dockyard/${target}`,
  }: {
    actions?: string[]
    realm?: string
    status?: number
    target?: string
    repository?: string
  } = {}) {
    const fixture = JSON.stringify({ actions, realm, status, repository, target })
    const mocked = `
      const fixture = ${fixture}
      let calls = 0
      globalThis.fetch = async (url, options) => {
        url = new URL(url)
        if (++calls === 1) return new Response(null, { status: 401, headers: { "www-authenticate": 'Bearer realm="' + fixture.realm + '",service="dockyard-registry"' } })
        if (url.origin !== "https://cr.guneet.dev") throw new Error("Credential escaped the registry origin")
        if (url.searchParams.get("scope") !== "repository:dockyard/" + fixture.target + ":pull,push") throw new Error("Wrong requested scope")
        if (options.headers.Authorization !== "Basic " + Buffer.from("test-user:test-secret").toString("base64")) throw new Error("Wrong credential")
        const claims = { access: [{ type: "repository", name: fixture.repository, actions: fixture.actions }] }
        const token = "header." + Buffer.from(JSON.stringify(claims)).toString("base64url") + ".signature"
        return new Response(JSON.stringify({ token }), { status: fixture.status })
      }
    `
    return execute(process.execPath, ["--input-type=module", "-e", `${mocked}\n${script}`], {
      env: {
        ...process.env,
        DOCKER_USERNAME: "test-user",
        DOCKER_PASSWORD: "test-secret",
        TARGET: target,
      },
    })
  }
  it.each(["init", "migrate", "web", "ingress"])(
    "accepts exact pull + push authorization for dockyard/%s",
    async (target) => {
      await expect(checkAccess({ target })).resolves.toMatchObject({
        stdout: `Verified pull + push permission for dockyard/${target}\n`,
      })
    },
  )
  it("rejects valid pull-only credentials and unrelated resource grants before building", async () => {
    await expect(checkAccess({ actions: ["pull"] })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("granted: pull"),
    })
    await expect(checkAccess({ repository: "other/init" })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("granted: none"),
    })
  })
  it("rejects invalid credentials and refuses to send them to another origin", async () => {
    await expect(checkAccess({ status: 401 })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Registry token request failed (401)"),
    })
    await expect(checkAccess({ realm: "https://evil.example/token" })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Refusing to forward credentials"),
    })
  })
})

async function resolve(env: Record<string, string> = {}) {
  const folder = await mkdtemp(
    join(existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir(), "dockyard-release-test-"),
  )
  folders.push(folder)
  await writeFile(
    join(folder, "gh"),
    '#!/bin/sh\n[ "$1" = release ] && [ "$2" = view ] || exit 1\n[ "${MISSING_RELEASE:-false}" != true ]\n',
    { mode: 0o700 },
  )
  await writeFile(
    join(folder, "git"),
    '#!/bin/sh\ncase "$1" in\nrev-parse) printf \'%s\\n\' "$TAG_SHA" ;;\nmerge-base) [ "${NOT_ON_MAIN:-false}" != true ] ;;\n*) exit 1 ;;\nesac\n',
    { mode: 0o700 },
  )
  const output = join(folder, "outputs")
  await writeFile(output, "")
  const script = release.jobs.prepare.steps!.find((step) => step.id === "source")!.run!
  await execute("/bin/bash", ["-c", script], {
    env: {
      ...process.env,
      PATH: `${folder}:${process.env.PATH}`,
      SOURCE_SHA: sha,
      TAG_SHA: sha,
      REQUESTED_TAG: "",
      RELEASE_CREATED: "false",
      RELEASE_TAG: "",
      RELEASE_SHA: "",
      UPDATE_LATEST: "false",
      GITHUB_OUTPUT: output,
      ...env,
    },
  })
  return Object.fromEntries(
    readFileSync(output, "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split("=")),
  )
}

describe("release source resolution", () => {
  it("publishes unreleased main commits only as development builds", async () => {
    expect(await resolve()).toEqual({ sha, version: "", edge: "true", aliases: "false" })
  })
  it("publishes stable aliases for the exact newly released commit", async () => {
    expect(
      await resolve({ RELEASE_CREATED: "true", RELEASE_TAG: "v1.2.3", RELEASE_SHA: sha }),
    ).toEqual({ sha, version: "1.2.3", edge: "true", aliases: "true" })
  })
  it("does not overwrite edge when Release Please discovers an older release", async () => {
    expect(
      await resolve({
        RELEASE_CREATED: "true",
        RELEASE_TAG: "v1.2.3",
        RELEASE_SHA: olderSha,
        TAG_SHA: olderSha,
      }),
    ).toEqual({ sha: olderSha, version: "1.2.3", edge: "false", aliases: "true" })
  })
  it("retries an existing release without moving floating tags by default", async () => {
    expect(await resolve({ REQUESTED_TAG: "v1.2.3", TAG_SHA: olderSha })).toEqual({
      sha: olderSha,
      version: "1.2.3",
      edge: "false",
      aliases: "false",
    })
    expect((await resolve({ REQUESTED_TAG: "v1.2.3", UPDATE_LATEST: "true" })).aliases).toBe("true")
  })
  it.each(["main", "v01.2.3", "v1.2.3-rc.1", "v1.2.3\nsha=injected", "v1.2.3; echo injected"])(
    "rejects invalid, prerelease, or injected release input %j",
    async (tag) => {
      await expect(resolve({ REQUESTED_TAG: tag })).rejects.toMatchObject({ code: 1 })
    },
  )
  it("refuses mismatched tags, missing GitHub releases, and source outside main history", async () => {
    await expect(
      resolve({
        RELEASE_CREATED: "true",
        RELEASE_TAG: "v1.2.3",
        RELEASE_SHA: sha,
        TAG_SHA: olderSha,
      }),
    ).rejects.toMatchObject({ code: 1 })
    await expect(
      resolve({ REQUESTED_TAG: "v1.2.3", MISSING_RELEASE: "true" }),
    ).rejects.toMatchObject({ code: 1 })
    await expect(resolve({ REQUESTED_TAG: "v1.2.3", NOT_ON_MAIN: "true" })).rejects.toMatchObject({
      code: 1,
    })
  })
})
