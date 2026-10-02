import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const execute = promisify(execFile)
const root = fileURLToPath(new URL("../../", import.meta.url))
const temporaryRoot = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
let workspace: string
let script: string

beforeEach(async () => {
  workspace = await mkdtemp(join(temporaryRoot, "dockyard-env-test-"))
  await mkdir(join(workspace, "deploy"))
  await copyFile(join(root, ".env.example"), join(workspace, ".env.example"))
  script = join(workspace, "deploy", "generate-env.sh")
  await copyFile(join(root, "deploy", "generate-env.sh"), script)
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

function generate(args: string[] = [], cwd = workspace) {
  return execute("/bin/sh", [script, ...args], { cwd })
}

function values(text: string) {
  return Object.fromEntries(
    text
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=")
        return [line.slice(0, separator), line.slice(separator + 1)]
      }),
  )
}

describe("deployment environment generator", () => {
  it("uses the repository root regardless of working directory and creates private, unique secrets", async () => {
    const result = await generate([], join(workspace, "deploy"))
    const output = join(workspace, ".env")
    const text = await readFile(output, "utf8")
    const env = values(text)
    const secrets = [
      env.POSTGRES_PASSWORD,
      env.ADMIN_PASSWORD,
      env.REGISTRY_HTTP_SECRET,
      env.REGISTRY_WEBHOOK_SECRET,
    ]
    for (const secret of secrets) {
      expect(secret).toMatch(/^[a-f0-9]{64}$/)
      expect(result.stdout).not.toContain(secret)
      expect(result.stderr).not.toContain(secret)
    }
    expect(new Set(secrets).size).toBe(4)
    expect(text).not.toContain("replace-with")
    expect(env.DATABASE_URL).toBe(
      `postgres://dockyard:${env.POSTGRES_PASSWORD}@localhost:5432/dockyard`,
    )
    expect((await stat(output)).mode & 0o777).toBe(0o600)
    expect(result.stdout).toContain("deploy/compose.yaml")
    expect(result.stdout).toContain("deploy/compose.build.yaml")
    await expect(access(join(workspace, "deploy", ".env"))).rejects.toThrow()
  })

  it("supports an explicit output path containing spaces", async () => {
    const output = join(workspace, "custom environment.env")
    await generate([output])
    expect(await readFile(output, "utf8")).not.toContain("replace-with")
    expect((await stat(output)).mode & 0o777).toBe(0o600)
    await expect(access(join(workspace, ".env"))).rejects.toThrow()
  })

  it("refuses to overwrite an existing configuration", async () => {
    const output = join(workspace, ".env")
    await writeFile(output, "KEEP_EXISTING_CONFIGURATION=yes\n", { mode: 0o600 })
    await expect(generate()).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("already exists"),
    })
    expect(await readFile(output, "utf8")).toBe("KEEP_EXISTING_CONFIGURATION=yes\n")
  })

  it("refuses even dangling symlinks without creating their target", async () => {
    const target = join(workspace, "missing.env")
    const output = join(workspace, ".env")
    await symlink(target, output)
    await expect(generate()).rejects.toMatchObject({ code: 1 })
    expect((await lstat(output)).isSymbolicLink()).toBe(true)
    await expect(access(target)).rejects.toThrow()
  })

  it("allows only one concurrent invocation to create the output", async () => {
    const results = await Promise.allSettled([generate(), generate()])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    expect(await readFile(join(workspace, ".env"), "utf8")).not.toContain("replace-with")
  })

  it("supports help and rejects excess arguments without writing configuration", async () => {
    expect((await generate(["--help"])).stdout).toContain("Usage:")
    await expect(generate(["first", "second"])).rejects.toMatchObject({ code: 2 })
    await expect(access(join(workspace, ".env"))).rejects.toThrow()
  })

  it("reports a missing OpenSSL installation without creating a file", async () => {
    await expect(
      execute("/bin/sh", [script], { cwd: workspace, env: { ...process.env, PATH: "" } }),
    ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("OpenSSL is required") })
    await expect(access(join(workspace, ".env"))).rejects.toThrow()
  })

  it("reports a missing template without creating configuration", async () => {
    await rm(join(workspace, ".env.example"))
    await expect(generate()).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Cannot read template"),
    })
    await expect(access(join(workspace, ".env"))).rejects.toThrow()
  })
})
