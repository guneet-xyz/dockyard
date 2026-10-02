import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const execute = promisify(execFile)
const script = fileURLToPath(new URL("../../deploy/ingress-entrypoint.sh", import.meta.url))

function render(env: Record<string, string> = {}) {
  return execute("/bin/sh", [script, "--print-config"], {
    env: {
      ...process.env,
      INGRESS_PUBLIC_URL: "http://localhost:3000",
      WEB_UPSTREAM_URL: "http://web:3000",
      REGISTRY_UPSTREAM_URL: "http://registry:5000",
      ...env,
    },
  })
}

describe("environment-driven ingress configuration", () => {
  it("renders an HTTP listener, registry routing, and a private readiness check", async () => {
    const { stdout } = await render()
    expect(stdout).toContain("auto_https off")
    expect(stdout).toContain(":80 {")
    expect(stdout).toContain("@registry path /v2 /v2/*")
    expect(stdout).toContain("reverse_proxy http://registry:5000")
    expect(stdout).toContain("reverse_proxy http://web:3000")
    expect(stdout).toContain("bind 127.0.0.1")
    expect(stdout).toContain("rewrite * /api/health")
    expect(stdout).not.toContain("handle_path")
    expect(stdout).not.toContain("header_up")
    expect(stdout).not.toContain("request_buffers")
    expect(stdout.indexOf("(dockyard_routes)")).toBeLessThan(
      stdout.indexOf("import dockyard_routes"),
    )
  })

  it("accepts custom root HTTP/HTTPS endpoints and normalizes trailing slashes", async () => {
    const { stdout } = await render({
      WEB_UPSTREAM_URL: "https://ui.example.com:8443/",
      REGISTRY_UPSTREAM_URL: "http://registry_api:5100/",
    })
    expect(stdout).toContain("reverse_proxy https://ui.example.com:8443")
    expect(stdout).toContain("reverse_proxy http://registry_api:5100")
    expect(stdout).not.toContain("reverse_proxy https://ui.example.com:8443/")
  })

  it("enables managed HTTPS and redirects to the full public origin, including custom ports", async () => {
    const { stdout } = await render({ INGRESS_PUBLIC_URL: "https://dockyard.example.com:8443/" })
    expect(stdout).toContain("auto_https disable_redirects")
    expect(stdout).toContain("https://dockyard.example.com {")
    expect(stdout).toContain("redir https://dockyard.example.com:8443{uri} 308")
    expect(stdout).not.toContain("https://dockyard.example.com:8443 {")
  })

  it("supports bracketed IPv6 URLs without confusing the address with a port", async () => {
    const { stdout } = await render({
      INGRESS_PUBLIC_URL: "https://[::1]:3443",
      WEB_UPSTREAM_URL: "http://[::1]:3000",
      REGISTRY_UPSTREAM_URL: "http://[2001:db8::1]",
    })
    expect(stdout).toContain("https://[::1] {")
    expect(stdout).toContain("redir https://[::1]:3443{uri} 308")
    expect(stdout).toContain("reverse_proxy http://[2001:db8::1]")
  })

  it.each([
    "",
    "ftp://web:3000",
    "http://user:secret@web:3000",
    "http://web:3000/api",
    "http://web:3000?query=x",
    "http://web:3000#fragment",
    "http://web:0",
    "http://web:65536",
    "http://web:-1",
    "http://web:3000\nimport /secrets",
    "http://web:3000\n",
    "http://web:3000\r",
    "http://web:3000 { respond unsafe }",
    "http://{env.SECRET}:3000",
    "http://web:3000//",
  ])("rejects an unsafe or unsupported upstream URL: %j", async (value) => {
    await expect(render({ WEB_UPSTREAM_URL: value })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("WEB_UPSTREAM_URL must be"),
    })
  })

  it("also validates the public origin and registry endpoint", async () => {
    await expect(render({ INGRESS_PUBLIC_URL: "https://example.com/other" })).rejects.toMatchObject(
      { code: 1, stderr: expect.stringContaining("INGRESS_PUBLIC_URL must be") },
    )
    await expect(render({ REGISTRY_UPSTREAM_URL: "http://registry:99999" })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("REGISTRY_UPSTREAM_URL must be"),
    })
  })

  it("does not echo rejected upstream credentials", async () => {
    const result = await render({
      REGISTRY_UPSTREAM_URL: "https://user:private-password@registry.example.com",
    }).catch((error: { code: number; stdout: string; stderr: string }) => error)
    expect(result).toMatchObject({ code: 1 })
    expect(`${result.stdout}${result.stderr}`).not.toContain("private-password")
  })
})
