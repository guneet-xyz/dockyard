import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  currentVersion,
  isNewerVersion,
  LATEST_RELEASE_API,
  latestRelease,
  parseVersion,
  resetUpdateCheck,
  UPDATE_CHECK_RETRY_MS,
  UPDATE_CHECK_TTL_MS,
  versionInfo,
} from "@/lib/version"

import packageJson from "../../package.json"

function release(tag: unknown, status = 200) {
  return new Response(JSON.stringify({ tag_name: tag }), { status })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  resetUpdateCheck()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-13T00:00:00Z"))
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("version comparison", () => {
  it("reports the package version maintained by release-please", () => {
    expect(currentVersion).toBe(packageJson.version)
  })

  it("parses stable versions with or without the v prefix", () => {
    expect(parseVersion("v1.2.3")).toEqual([1, 2, 3])
    expect(parseVersion("0.10.0")).toEqual([0, 10, 0])
    expect(parseVersion("v1.2.3-rc.1")).toBeNull()
    expect(parseVersion("v01.2.3")).toBeNull()
    expect(parseVersion("latest")).toBeNull()
  })

  it("compares versions numerically", () => {
    expect(isNewerVersion("v0.10.0", "0.9.9")).toBe(true)
    expect(isNewerVersion("v0.2.1", "0.2.0")).toBe(true)
    expect(isNewerVersion("v1.0.0", "0.99.99")).toBe(true)
    expect(isNewerVersion("v0.2.0", "0.2.0")).toBe(false)
    expect(isNewerVersion("v0.1.9", "0.2.0")).toBe(false)
    expect(isNewerVersion("nonsense", "0.2.0")).toBe(false)
  })
})

describe("latest release lookup", () => {
  it("reads the latest GitHub release and builds its URL from the tag", async () => {
    fetchMock.mockResolvedValue(release("v9.8.7"))
    await expect(latestRelease()).resolves.toEqual({
      version: "9.8.7",
      url: "https://github.com/guneet-xyz/dockyard/releases/tag/v9.8.7",
    })
    expect(fetchMock).toHaveBeenCalledWith(
      LATEST_RELEASE_API,
      expect.objectContaining({ cache: "no-store" }),
    )
  })

  it("shares concurrent requests and caches successful results", async () => {
    fetchMock.mockResolvedValue(release("v9.8.7"))
    await Promise.all([latestRelease(), latestRelease()])
    await latestRelease()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + UPDATE_CHECK_TTL_MS + 1)
    await latestRelease()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("treats failures as unknown and retries after the retry interval", async () => {
    fetchMock.mockResolvedValueOnce(release(undefined, 403))
    await expect(latestRelease()).resolves.toBeNull()
    fetchMock.mockRejectedValueOnce(new Error("offline"))
    await expect(latestRelease()).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + UPDATE_CHECK_RETRY_MS + 1)
    await expect(latestRelease()).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("rejects unexpected tags", async () => {
    fetchMock.mockResolvedValue(release("v1.0.0/../../evil"))
    await expect(latestRelease()).resolves.toBeNull()
  })

  it("keeps the last known release when a later refresh fails", async () => {
    fetchMock.mockResolvedValueOnce(release("v9.8.7"))
    await latestRelease()
    vi.setSystemTime(Date.now() + UPDATE_CHECK_TTL_MS + 1)
    fetchMock.mockRejectedValueOnce(new Error("offline"))
    await expect(latestRelease()).resolves.toMatchObject({ version: "9.8.7" })
  })
})

describe("version information by audience", () => {
  it("shows only the running version to non-administrators without contacting GitHub", async () => {
    await expect(versionInfo(false)).resolves.toEqual({
      current: currentVersion,
      update: null,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("tells administrators when a newer release exists", async () => {
    fetchMock.mockResolvedValue(release("v999.0.0"))
    await expect(versionInfo(true)).resolves.toEqual({
      current: currentVersion,
      update: {
        latest: {
          version: "999.0.0",
          url: "https://github.com/guneet-xyz/dockyard/releases/tag/v999.0.0",
        },
        available: true,
      },
    })
  })

  it("does not report an update when the running version is current", async () => {
    fetchMock.mockResolvedValue(release(`v${currentVersion}`))
    await expect(versionInfo(true)).resolves.toMatchObject({
      update: { available: false },
    })
  })

  it.each(["false", "FALSE", "0", "off", "no"])(
    "makes no outbound request when UPDATE_CHECK=%s",
    async (value) => {
      vi.stubEnv("UPDATE_CHECK", value)
      await expect(versionInfo(true)).resolves.toEqual({
        current: currentVersion,
        update: null,
      })
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )
})
