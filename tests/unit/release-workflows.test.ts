import { execFile } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import { parse } from "yaml"

type Step = {
  name?: string
  if?: string
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
      "runs-on"?: string
      strategy?: {
        matrix: {
          target?: string[]
          platform?: string[]
          include?: { platform: string; arch: string; runner: string }[]
        }
      }
    }
  >
}
const root = fileURLToPath(new URL("../../", import.meta.url))
const load = (path: string) => readFileSync(join(root, path), "utf8")
const ci = parse(load(".github/workflows/ci.yml")) as Workflow
const release = parse(load(".github/workflows/release.yml")) as Workflow
const builder = release.jobs.build
const smoke = release.jobs.smoke
const publisher = release.jobs.publish
const step = (job: Workflow["jobs"][string], name: string) =>
  job.steps!.find((step) => step.name === name || step.id === name)!
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
    expect(release.jobs.checks.needs).toBe("prepare")
    expect(builder.needs).toEqual(["prepare", "checks"])
    expect(smoke.needs).toEqual(["prepare", "build"])
    expect(publisher.needs).toEqual(["prepare", "smoke"])
    for (const job of [builder, smoke]) {
      const checkout = job.steps!.find((step) => step.uses?.startsWith("actions/checkout@"))
      expect(checkout?.with?.ref).toBe(release.jobs.checks.with?.ref)
    }
    for (const job of [builder, smoke, publisher]) {
      expect(job.environment).toBe("release")
      expect(job).not.toHaveProperty("secrets")
      expect(job).not.toHaveProperty("uses")
    }
    expect(
      release.jobs.prepare.steps?.find((step) => step.name?.startsWith("Dispatch quality"))?.run,
    ).toContain('gh workflow run ci.yml --ref "$branch"')
  })

  it("runs only Release Please on main pushes that do not create a release", () => {
    const released = "needs.prepare.outputs.release == 'true'"
    for (const job of ["checks", "build", "smoke", "publish"])
      expect(release.jobs[job].if).toBe(released)
    expect(Object.keys(release.jobs)).toEqual(["prepare", "checks", "build", "smoke", "publish"])
    const checkout = release.jobs.prepare.steps!.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    )
    expect(checkout?.if).toBe("steps.release.outputs.release_created == 'true'")
  })

  it("has no manual or other publishing trigger besides pushes to main", () => {
    expect(Object.keys(release.on)).toEqual(["push"])
    expect(load(".github/workflows/release.yml")).not.toMatch(/workflow_dispatch:|inputs\./)
    expect(load(".github/workflows/ci.yml")).not.toContain("docker/login-action")
    expect(load(".github/workflows/ci.yml")).not.toMatch(/imagetools|push-by-digest/)
  })

  it("pins every action to a full commit SHA with a version comment", () => {
    for (const path of [".github/workflows/ci.yml", ".github/workflows/release.yml"]) {
      const uses = load(path)
        .split("\n")
        .map((line) => /^\s*(?:-\s+)?uses:\s*(.+)$/.exec(line)?.[1])
        .filter((value): value is string => value !== undefined && !value.startsWith("./"))
      expect(uses.length).toBeGreaterThan(0)
      for (const value of uses)
        expect(value).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/)
    }
  })

  it("builds each Dockerfile target per platform on native runners and pushes by digest only", () => {
    const matrix = builder.strategy!.matrix
    expect(matrix.target).toEqual(["init", "migrate", "web", "ingress"])
    for (const target of matrix.target!)
      expect(load("Dockerfile")).toMatch(new RegExp(`^FROM .+ AS ${target}$`, "m"))
    const runners = [
      { platform: "linux/amd64", arch: "amd64", runner: "ubuntu-24.04" },
      { platform: "linux/arm64", arch: "arm64", runner: "ubuntu-24.04-arm" },
    ]
    expect(matrix.platform).toEqual(["linux/amd64", "linux/arm64"])
    expect(matrix.include).toEqual(runners)
    expect(smoke.strategy!.matrix.include).toEqual(runners)
    expect(builder["runs-on"]).toBe("${{ matrix.runner }}")
    expect(smoke["runs-on"]).toBe("${{ matrix.runner }}")
    expect(load(".github/workflows/release.yml")).not.toContain("setup-qemu-action")
    const build = step(builder, "build")
    expect(build.with?.platforms).toBe("${{ matrix.platform }}")
    expect(build.with?.target).toBe("${{ matrix.target }}")
    expect(build.with?.outputs).toBe(
      "type=image,name=cr.guneet.dev/dockyard/${{ matrix.target }},push-by-digest=true,name-canonical=true,push=true",
    )
    expect(build.with).not.toHaveProperty("push")
    expect(build.with).not.toHaveProperty("tags")
    expect(build.with?.provenance).toBe("mode=min")
    expect(build.with?.sbom).toBe(true)
    expect(build.with).not.toHaveProperty("build-args")
    expect(build.with).not.toHaveProperty("secrets")
    expect(step(builder, "Log in to the Dockyard registry").with?.registry).toBe("cr.guneet.dev")
    expect(step(publisher, "Log in to the Dockyard registry").with?.registry).toBe("cr.guneet.dev")
  })

  it("publishes only v-prefixed version tags and latest, with no edge or SHA tags", () => {
    const metadata = step(builder, "meta")
    expect(metadata.with?.images).toBe("cr.guneet.dev/dockyard/${{ matrix.target }}")
    expect(metadata.with?.flavor).toBe("latest=false")
    expect(metadata.with?.context).toBe("workflow")
    expect(metadata.with?.labels).toContain(
      "org.opencontainers.image.revision=${{ needs.prepare.outputs.sha }}",
    )
    const tags = String(metadata.with?.tags).trim().split("\n")
    const value = "value=${{ needs.prepare.outputs.version }}"
    expect(tags).toEqual([
      `type=semver,pattern=v{{version}},${value}`,
      `type=semver,pattern=v{{major}}.{{minor}},${value}`,
      `type=semver,pattern=v{{major}},${value},enable=\${{ !startsWith(needs.prepare.outputs.version, '0.') }}`,
      "type=raw,value=latest",
    ])
    const workflow = load(".github/workflows/release.yml")
    expect(workflow).not.toMatch(/\bedge\b/)
    expect(workflow).not.toContain("sha-")
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
  const preflight = builder.steps!.find(
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
        RELEASE_VERSION: version,
        ...env,
      },
    })
  }
  it("accepts environment credentials for the matching release version", async () => {
    await expect(checkCredentials({})).resolves.toMatchObject({ stdout: "" })
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
  it("refuses to build without a release version, or with a different or prerelease one", async () => {
    await expect(checkCredentials({ RELEASE_VERSION: "" })).rejects.toMatchObject({ code: 1 })
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
    for (const job of [ci.jobs.checks, smoke])
      for (const name of ["Service logs on failure", "Stop test services"]) {
        const script = step(job, name).run!
        await expect(execute("/bin/bash", ["-c", script], { cwd: folder })).resolves.toMatchObject({
          stdout: "",
          stderr: "",
        })
      }
  })
})

describe("read-only registry permission preflight", () => {
  const run = builder.steps!.find(
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

async function temporaryFolder(prefix: string) {
  const folder = await mkdtemp(
    join(existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir(), `dockyard-${prefix}-`),
  )
  folders.push(folder)
  return folder
}

async function resolve(env: Record<string, string> = {}) {
  const folder = await temporaryFolder("release-test")
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
  const script = step(release.jobs.prepare, "source").run!
  await execute("/bin/bash", ["-c", script], {
    env: {
      ...process.env,
      PATH: `${folder}:${process.env.PATH}`,
      TAG_SHA: sha,
      RELEASE_CREATED: "false",
      RELEASE_TAG: "",
      RELEASE_SHA: "",
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
  it("publishes nothing for main pushes that do not create a release", async () => {
    expect(await resolve()).toEqual({ release: "false" })
  })
  it("publishes the exact newly released commit", async () => {
    expect(
      await resolve({ RELEASE_CREATED: "true", RELEASE_TAG: "v1.2.3", RELEASE_SHA: sha }),
    ).toEqual({ release: "true", sha, version: "1.2.3" })
  })
  it("builds a release that Release Please creates for an older merged commit from that commit", async () => {
    expect(
      await resolve({
        RELEASE_CREATED: "true",
        RELEASE_TAG: "v1.2.3",
        RELEASE_SHA: olderSha,
        TAG_SHA: olderSha,
      }),
    ).toEqual({ release: "true", sha: olderSha, version: "1.2.3" })
  })
  it.each(["main", "v01.2.3", "1.2.3", "v1.2.3-rc.1", "v1.2.3\nsha=injected", "v1.2.3; echo x"])(
    "rejects invalid, prerelease, or injected release tag %j",
    async (tag) => {
      await expect(
        resolve({ RELEASE_CREATED: "true", RELEASE_TAG: tag, RELEASE_SHA: sha }),
      ).rejects.toMatchObject({ code: 1 })
    },
  )
  it("refuses mismatched tags, missing GitHub releases, and source outside main history", async () => {
    const created = { RELEASE_CREATED: "true", RELEASE_TAG: "v1.2.3", RELEASE_SHA: sha }
    await expect(resolve({ ...created, TAG_SHA: olderSha })).rejects.toMatchObject({ code: 1 })
    await expect(resolve({ ...created, MISSING_RELEASE: "true" })).rejects.toMatchObject({
      code: 1,
    })
    await expect(resolve({ ...created, NOT_ON_MAIN: "true" })).rejects.toMatchObject({ code: 1 })
  })
})

const digest = (character: string) => `sha256:${character.repeat(64)}`

// A fake docker CLI that records its arguments and answers inspect calls.
async function fakeDocker(folder: string) {
  await writeFile(
    join(folder, "docker"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_LOG"
[ "$1" = login ] && cat > /dev/null
case "$1 $2 $3" in
  "image inspect --format") printf '%s\\n' "\${INSPECT_PLATFORM:-$PLATFORM}" ;;
  "buildx imagetools inspect")
    if [ "$4" = --raw ]; then
      printf '%s\\n' '{"manifests":[{"platform":{"os":"linux","architecture":"arm64"}},{"platform":{"os":"linux","architecture":"amd64"}},{"platform":{"os":"unknown","architecture":"unknown"}}]}'
    else
      printf '%s\\n' '{"digest":"${digest("f")}"}'
    fi ;;
esac
`,
    { mode: 0o700 },
  )
}

async function writeImage(folder: string, name: string, imageDigest: string, tags: string[]) {
  await mkdir(join(folder, name), { recursive: true })
  await writeFile(join(folder, name, "digest"), `${imageDigest}\n`)
  await writeFile(join(folder, name, "tags"), tags.map((tag) => `${tag}\n`).join(""))
}

describe("smoke tests use the exact pushed digests", () => {
  const script = step(smoke, "Pull the exact pushed images").run!
  async function pull(env: Record<string, string> = {}, imageDigest = digest("a")) {
    const folder = await temporaryFolder("smoke-test")
    await fakeDocker(folder)
    for (const target of ["init", "migrate", "web", "ingress"])
      await writeImage(folder, `image-${target}-arm64`, imageDigest, [])
    const log = join(folder, "docker.log")
    await writeFile(log, "")
    await execute("/bin/bash", ["-c", script], {
      env: {
        ...process.env,
        PATH: `${folder}:${process.env.PATH}`,
        ARCH: "arm64",
        PLATFORM: "linux/arm64",
        IMAGES: folder,
        DOCKER_USERNAME: "test-user",
        DOCKER_PASSWORD: "test-secret",
        DOCKER_LOG: log,
        GITHUB_STEP_SUMMARY: join(folder, "summary"),
        RUNNER_TEMP: folder,
        ...env,
      },
    })
    return readFileSync(log, "utf8")
  }
  it("pulls each pushed digest for the native platform and names it only locally", async () => {
    const log = await pull()
    expect(log).toContain("login cr.guneet.dev --username test-user --password-stdin")
    for (const target of ["init", "migrate", "web", "ingress"]) {
      const image = `cr.guneet.dev/dockyard/${target}@${digest("a")}`
      expect(log).toContain(`pull --platform linux/arm64 ${image}\n`)
      expect(log).toContain(`tag ${image} localhost/dockyard-smoke/${target}:arm64\n`)
    }
    expect(log).not.toContain("test-secret")
    expect(log).not.toMatch(/^push /m)
  })
  it("refuses malformed digests and images for another platform", async () => {
    await expect(pull({}, "latest")).rejects.toMatchObject({ code: 1 })
    await expect(pull({ INSPECT_PLATFORM: "linux/amd64" })).rejects.toMatchObject({ code: 1 })
  })
  it("starts the Compose stack without pulling Dockyard images", () => {
    expect(step(smoke, "Configure Compose to use the pulled images").run).toContain(
      "DOCKYARD_IMAGE_PREFIX=localhost/dockyard-smoke",
    )
    expect(step(smoke, "Configure Compose to use the pulled images").run).toContain(
      "pull postgres registry",
    )
    expect(step(smoke, "Start the Compose stack").run).toContain("up --pull never --wait")
    const names = smoke.steps!.map((step) => step.name)
    expect(names.indexOf("Start the Compose stack")).toBeLessThan(
      names.indexOf("Verify initialization and migration jobs"),
    )
    expect(step(smoke, "Verify initialization and migration jobs").run).toBe(
      step(ci.jobs.checks, "Verify initialization and migration jobs").run,
    )
    expect(step(smoke, "Docker CLI through ingress").run).toBe(
      step(ci.jobs.checks, "Docker CLI through ingress").run,
    )
    expect(step(smoke, "Registry integration").run).toBe(
      step(ci.jobs.checks, "Registry integration").run,
    )
  })
})

describe("tags are created only from the tested digests", () => {
  const script = step(publisher, "Tag the tested multi-architecture image").run!
  const image = "cr.guneet.dev/dockyard/web"
  const tags = [`${image}:v1.2.3`, `${image}:v1.2`, `${image}:v1`, `${image}:latest`]
  async function tag(amd64Tags = tags, arm64Tags = tags) {
    const folder = await temporaryFolder("publish-test")
    await fakeDocker(folder)
    await writeImage(folder, "image-web-amd64", digest("a"), amd64Tags)
    await writeImage(folder, "image-web-arm64", digest("b"), arm64Tags)
    const log = join(folder, "docker.log")
    await writeFile(log, "")
    await execute("/bin/bash", ["-c", script], {
      env: {
        ...process.env,
        PATH: `${folder}:${process.env.PATH}`,
        IMAGE: image,
        IMAGES: join(folder, "image-web"),
        DOCKER_LOG: log,
        GITHUB_STEP_SUMMARY: join(folder, "summary"),
      },
    })
    return {
      log: readFileSync(log, "utf8"),
      summary: readFileSync(join(folder, "summary"), "utf8"),
    }
  }
  it("merges both platform digests into one index carrying every planned tag", async () => {
    const { log, summary } = await tag()
    expect(log.split("\n")[0]).toBe(
      `buildx imagetools create ${tags.map((tag) => `--tag ${tag}`).join(" ")} ${image}@${digest("a")} ${image}@${digest("b")}`,
    )
    expect(summary).toContain(digest("f"))
  })
  it("refuses differing tag plans, foreign repositories, and empty plans", async () => {
    await expect(tag(tags, tags.slice(1))).rejects.toMatchObject({ code: 1 })
    await expect(tag([`${image}-other:v1.2.3`], [`${image}-other:v1.2.3`])).rejects.toMatchObject({
      code: 1,
    })
    await expect(tag([`${image}:bad tag`], [`${image}:bad tag`])).rejects.toMatchObject({ code: 1 })
    await expect(tag([], [])).rejects.toMatchObject({ code: 1 })
  })
})
