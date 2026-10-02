import { afterEach, describe, expect, it, vi } from "vitest"
import { config } from "@/lib/config"

afterEach(() => vi.unstubAllEnvs())

describe("single-endpoint configuration", () => {
  it("defaults the public registry host to the web origin", () => {
    vi.stubEnv("APP_URL", undefined)
    vi.stubEnv("REGISTRY_PUBLIC_HOST", undefined)
    expect(config.registryHost).toBe("localhost:3000")
  })

  it("derives Docker commands from a configured HTTPS origin", () => {
    vi.stubEnv("APP_URL", "https://dockyard.example.com")
    vi.stubEnv("REGISTRY_PUBLIC_HOST", undefined)
    expect(config.registryHost).toBe("dockyard.example.com")
    expect(config.secureCookies).toBe(true)
  })

  it("preserves custom ports and IPv6 hosts", () => {
    vi.stubEnv("APP_URL", "http://[::1]:3100")
    vi.stubEnv("REGISTRY_PUBLIC_HOST", undefined)
    expect(config.registryHost).toBe("[::1]:3100")
  })

  it("allows a separate registry host only when explicitly configured for development", () => {
    vi.stubEnv("APP_URL", "http://localhost:3000")
    vi.stubEnv("REGISTRY_PUBLIC_HOST", "localhost:5000")
    expect(config.registryHost).toBe("localhost:5000")
  })
})
