import assert from "node:assert/strict"
import { createHash } from "node:crypto"

// Run against an isolated stack: this creates real users and repositories.
const app = process.env.TEST_APP_URL ?? "http://localhost:3000"
const registry = process.env.TEST_REGISTRY_URL ?? "http://localhost:5000"
const username = process.env.TEST_ADMIN_USERNAME ?? "admin"
const password = process.env.TEST_ADMIN_PASSWORD
if (!password) throw new Error("Set TEST_ADMIN_PASSWORD to run integration checks.")
const suffix = Date.now().toString(36)
const viewer = `viewer-${suffix}`
const maintainer = `maintainer-${suffix}`
const repo = `smoke-${suffix}/public`
const privateRepo = `smoke-${suffix}/private`
const testPassword = `test-password-${suffix}`
let assertions = 0

async function check(response: Response, status: number, label: string) {
  const text = await response.text()
  assert.equal(response.status, status, `${label}: ${text}`)
  assertions++
  return text ? JSON.parse(text) : null
}
async function browser(
  path: string,
  method = "GET",
  body?: unknown,
  cookie?: string,
  origin = app,
) {
  return fetch(`${app}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}
async function login(name: string, pass: string) {
  const response = await browser("/api/auth/login", "POST", { username: name, password: pass })
  const cookie = response.headers.getSetCookie()[0]?.split(";")[0]
  await check(response, 200, `Login ${name}`)
  assert.ok(cookie)
  return cookie
}
async function token(scope: string, name?: string, pass = testPassword) {
  const response = await fetch(
    `${app}/api/registry/token?service=dockyard-registry&scope=${encodeURIComponent(scope)}`,
    {
      headers: name
        ? { Authorization: `Basic ${Buffer.from(`${name}:${pass}`).toString("base64")}` }
        : {},
    },
  )
  const data = await check(response, 200, "Issue registry token")
  return data.token as string
}
async function registryCall(
  path: string,
  bearer: string,
  method = "GET",
  body?: string,
  type = "application/json",
) {
  return fetch(`${registry}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": type,
      Accept: "application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json",
    },
    body,
  })
}

async function main() {
  await check(await browser("/api/health"), 200, "Stack health")
  await check(await browser("/api/users"), 401, "Anonymous admin API blocked")
  await check(
    await browser(
      "/api/auth/login",
      "POST",
      { username, password },
      undefined,
      "http://evil.example",
    ),
    403,
    "Cross-origin login blocked",
  )
  const adminCookie = await login(username, password!)
  await check(
    await browser(
      "/api/users",
      "POST",
      { name: "Smoke viewer", username: viewer, password: testPassword, role: "viewer" },
      adminCookie,
    ),
    201,
    "Create viewer",
  )
  const created = await check(
    await browser(
      "/api/users",
      "POST",
      {
        name: "Smoke maintainer",
        username: maintainer,
        password: testPassword,
        role: "maintainer",
      },
      adminCookie,
    ),
    201,
    "Create maintainer",
  )
  const viewerCookie = await login(viewer, testPassword)
  await check(
    await browser("/api/users", "GET", undefined, viewerCookie),
    403,
    "Viewer admin API blocked",
  )
  await check(
    await browser("/api/repositories", "POST", { name: repo, visibility: "public" }, viewerCookie),
    403,
    "Viewer repository write blocked",
  )
  const maintainerCookie = await login(maintainer, testPassword)
  await check(
    await browser(
      "/api/repositories",
      "POST",
      { name: repo, visibility: "public" },
      maintainerCookie,
    ),
    201,
    "Maintainer creates repository",
  )
  await check(
    await browser(
      "/api/repositories",
      "POST",
      { name: privateRepo, visibility: "private" },
      maintainerCookie,
    ),
    201,
    "Reserve private repository",
  )
  const guestList = await check(await browser("/api/repositories"), 200, "Guest catalog")
  assert.ok(guestList.repositories.some((item: { name: string }) => item.name === repo))
  assert.ok(!guestList.repositories.some((item: { name: string }) => item.name === privateRepo))
  assertions += 2
  await check(await browser(`/api/repositories/${privateRepo}`), 404, "Guest private detail hidden")
  await check(
    await browser(`/api/repositories/${privateRepo}`, "GET", undefined, viewerCookie),
    200,
    "Viewer private detail allowed",
  )
  const guestToken = await token(`repository:${repo}:pull,push,delete`)
  const guestClaims = JSON.parse(Buffer.from(guestToken.split(".")[1], "base64url").toString())
  assert.deepEqual(guestClaims.access[0].actions, ["pull"])
  assertions++
  await check(
    await registryCall(`/v2/${repo}/blobs/uploads/`, guestToken, "POST"),
    401,
    "Guest push rejected by actual registry",
  )
  const viewerToken = await token(`repository:${repo}:pull,push,delete`, viewer)
  await check(
    await registryCall(`/v2/${repo}/blobs/uploads/`, viewerToken, "POST"),
    401,
    "Viewer push rejected by actual registry",
  )
  const pushToken = await token(`repository:${repo}:pull,push,delete`, maintainer)
  const config = JSON.stringify({
    architecture: "arm64",
    os: "linux",
    created: new Date().toISOString(),
    config: {},
    rootfs: { type: "layers", diff_ids: [] },
  })
  const digest = `sha256:${createHash("sha256").update(config).digest("hex")}`
  const upload = await registryCall(`/v2/${repo}/blobs/uploads/`, pushToken, "POST")
  assert.equal(upload.status, 202)
  const location = new URL(upload.headers.get("location")!, registry)
  location.searchParams.set("digest", digest)
  await check(
    await registryCall(
      `${location.pathname}${location.search}`,
      pushToken,
      "PUT",
      config,
      "application/octet-stream",
    ),
    201,
    "Upload OCI config",
  )
  const manifest = JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: {
      mediaType: "application/vnd.oci.image.config.v1+json",
      size: Buffer.byteLength(config),
      digest,
    },
    layers: [],
  })
  await check(
    await registryCall(
      `/v2/${repo}/manifests/latest`,
      pushToken,
      "PUT",
      manifest,
      "application/vnd.oci.image.manifest.v1+json",
    ),
    201,
    "Maintainer pushes OCI manifest",
  )
  const pull = await registryCall(`/v2/${repo}/manifests/latest`, guestToken)
  await check(pull, 200, "Guest pulls actual manifest with signed token")
  const detail = await check(
    await browser(`/api/repositories/${repo}`),
    200,
    "UI reads live image metadata",
  )
  assert.equal(detail.images[0].platforms[0], "linux/arm64")
  assertions++
  await check(
    await browser(
      `/api/repositories/${repo}`,
      "DELETE",
      { digest: detail.images[0].digest },
      viewerCookie,
    ),
    403,
    "Viewer deletion blocked",
  )
  await check(
    await browser(
      `/api/repositories/${repo}`,
      "DELETE",
      { digest: detail.images[0].digest },
      maintainerCookie,
    ),
    200,
    "Maintainer deletes manifest",
  )
  const privateGuest = await token(`repository:${privateRepo}:pull`)
  const claims = JSON.parse(Buffer.from(privateGuest.split(".")[1], "base64url").toString())
  assert.deepEqual(claims.access[0].actions, [])
  assertions++
  const catalogToken = await token("registry:catalog:*")
  await check(
    await registryCall("/v2/_catalog", catalogToken),
    401,
    "Anonymous raw catalog blocked",
  )
  await check(
    await browser(`/api/users/${created.id}`, "PATCH", { enabled: false }, adminCookie),
    200,
    "Disable maintainer",
  )
  await check(
    await browser(
      "/api/repositories",
      "POST",
      { name: "not-allowed", visibility: "public" },
      maintainerCookie,
    ),
    401,
    "Disabled user's existing session revoked",
  )
  const badToken = await fetch(`${app}/api/registry/token?service=dockyard-registry`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${maintainer}:${testPassword}`).toString("base64")}`,
    },
  })
  await check(badToken, 401, "Disabled Docker credentials rejected")
  await check(await browser("/api/activity", "GET", undefined, adminCookie), 200, "Admin audit log")
  await check(await browser("/api/auth/logout", "POST", {}, viewerCookie), 200, "Logout")
  const me = await check(
    await browser("/api/auth/me", "GET", undefined, viewerCookie),
    200,
    "Revoked session checked",
  )
  assert.equal(me.user, null)
  assertions++
  console.log(`Passed ${assertions} integration assertions against PostgreSQL and Docker Registry.`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
