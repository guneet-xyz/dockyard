import { describe, expect, it } from "vitest"
import { allowedActions, canRead, canWrite, validRepositoryName } from "@/lib/permissions"
import type { Role } from "@/lib/types"

describe("registry permissions", () => {
  it.each<{ role: Role | null; visibility: "public" | "private"; expected: string[] }>([
    { role: null, visibility: "public", expected: ["pull"] },
    { role: null, visibility: "private", expected: [] },
    { role: "viewer", visibility: "public", expected: ["pull"] },
    { role: "viewer", visibility: "private", expected: ["pull"] },
    { role: "maintainer", visibility: "public", expected: ["pull", "push", "delete"] },
    { role: "maintainer", visibility: "private", expected: ["pull", "push", "delete"] },
    { role: "admin", visibility: "public", expected: ["pull", "push", "delete"] },
    { role: "admin", visibility: "private", expected: ["pull", "push", "delete"] },
  ])("$role / $visibility receives only authorized actions", ({ role, visibility, expected }) => {
    expect(allowedActions(role, visibility, ["pull", "push", "delete", "*", "unknown"])).toEqual(
      expected,
    )
  })
  it("intersects requested scopes, rather than granting extra permissions", () => {
    expect(allowedActions("admin", "public", ["pull", "pull"])).toEqual(["pull"])
    expect(allowedActions("admin", "private", [])).toEqual([])
    expect(allowedActions("viewer", "private", ["push"])).toEqual([])
  })
  it("enforces read-only guests and viewers", () => {
    expect(canWrite(null)).toBe(false)
    expect(canWrite({ role: "viewer" })).toBe(false)
    expect(canWrite({ role: "maintainer" })).toBe(true)
    expect(canWrite({ role: "admin" })).toBe(true)
    expect(canRead(null, "public")).toBe(true)
    expect(canRead(null, "private")).toBe(false)
    expect(canRead({ role: "viewer" }, "private")).toBe(true)
  })
})

describe("repository names", () => {
  it.each([
    "alpine",
    "team/api",
    "org/team/app",
    "my-app",
    "my_app",
    "my.app",
    "foo__bar",
    "foo---bar",
  ])("accepts %s", (name) => expect(validRepositoryName(name)).toBe(true))
  it.each([
    "",
    "../secret",
    "UpperCase",
    "/team",
    "team/",
    "a//b",
    "a:b",
    "a?x",
    "a%2fb",
    "a b",
    "a..b",
    "a".repeat(256),
  ])("rejects %s", (name) => expect(validRepositoryName(name)).toBe(false))
})
