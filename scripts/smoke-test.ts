import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"

// Run against an isolated stack: this creates real users and repositories.
const app = process.env.TEST_APP_URL ?? "http://localhost:3000"
const registry = process.env.TEST_REGISTRY_URL ?? app
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
  body?: BodyInit,
  type = "application/json",
) {
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": type,
      Accept: "application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json",
    },
    body,
    ...(body instanceof ReadableStream ? { duplex: "half" as const } : {}),
  }
  return fetch(`${registry}${path}`, init)
}

function uploadLocation(response: Response) {
  const header = response.headers.get("location")
  assert.ok(header, "Upload response must include a Location header")
  assert.ok(header.startsWith("/v2/"), "Upload Location must stay relative to the ingress origin")
  const location = new URL(header, registry)
  assert.equal(location.origin, new URL(registry).origin)
  assertions += 3
  return location
}

async function uploadBlob(name: string, bearer: string, body: string) {
  const digest = `sha256:${createHash("sha256").update(body).digest("hex")}`
  const upload = await registryCall(`/v2/${name}/blobs/uploads/`, bearer, "POST")
  await check(upload.clone(), 202, "Start blob upload through ingress")
  const location = uploadLocation(upload)
  location.searchParams.set("digest", digest)
  await check(
    await registryCall(
      `${location.pathname}${location.search}`,
      bearer,
      "PUT",
      body,
      "application/octet-stream",
    ),
    201,
    "Finalize blob upload through ingress",
  )
  return digest
}

async function main() {
  await check(await browser("/api/health"), 200, "Stack health")
  const challenge = await fetch(`${registry}/v2/`)
  await check(challenge.clone(), 401, "Registry challenge through public ingress")
  assert.equal(challenge.headers.get("Docker-Distribution-Api-Version"), "registry/2.0")
  assert.ok(
    challenge.headers.get("WWW-Authenticate")?.includes(`realm="${app}/api/registry/token"`),
    "Registry must advertise the web token endpoint on the public origin",
  )
  assertions += 2
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
    await fetch(`${registry}/v2/`, { headers: { Cookie: adminCookie } }),
    401,
    "A web admin session cannot bypass registry token authentication",
  )
  const session = await check(await browser("/api/auth/me"), 200, "Public registry hostname")
  assert.equal(session.registryHost, new URL(registry).host)
  assertions++
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
  const parts = guestToken.split(".")
  guestClaims.access[0].actions.push("push")
  const forged = `${parts[0]}.${Buffer.from(JSON.stringify(guestClaims)).toString("base64url")}.${parts[2]}`
  await check(
    await registryCall(`/v2/${repo}/blobs/uploads/`, forged, "POST"),
    401,
    "Ingress preserves signatures: a forged push grant is rejected",
  )
  const pushToken = await token(`repository:${repo}:pull,push,delete`, maintainer)
  const config = JSON.stringify({
    architecture: "arm64",
    os: "linux",
    created: new Date().toISOString(),
    config: {},
    rootfs: { type: "layers", diff_ids: [] },
  })
  const digest = await uploadBlob(repo, pushToken, config)
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

  // Exercise streaming request bodies, PATCH/PUT continuation, HEAD, and range responses.
  const bytes = randomBytes(8 * 1024 * 1024)
  const largeDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`
  const started = await registryCall(`/v2/${repo}/blobs/uploads/`, pushToken, "POST")
  await check(started.clone(), 202, "Start large streaming upload")
  let location = uploadLocation(started)
  let offset = 0
  const stream = new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      controller.enqueue(bytes.subarray(offset, offset + 64 * 1024))
      offset += 64 * 1024
    },
  })
  const patched = await registryCall(
    `${location.pathname}${location.search}`,
    pushToken,
    "PATCH",
    stream,
    "application/octet-stream",
  )
  await check(patched.clone(), 202, "Stream an 8 MiB blob through ingress")
  location = uploadLocation(patched)
  location.searchParams.set("digest", largeDigest)
  await check(
    await registryCall(
      `${location.pathname}${location.search}`,
      pushToken,
      "PUT",
      undefined,
      "application/octet-stream",
    ),
    201,
    "Complete streamed upload",
  )
  const downloaded = await registryCall(`/v2/${repo}/blobs/${largeDigest}`, guestToken)
  assert.equal(downloaded.status, 200)
  assert.equal(
    `sha256:${createHash("sha256")
      .update(new Uint8Array(await downloaded.arrayBuffer()))
      .digest("hex")}`,
    largeDigest,
  )
  assertions += 2
  const head = await registryCall(`/v2/${repo}/blobs/${largeDigest}`, guestToken, "HEAD")
  await check(head, 200, "HEAD through registry ingress")
  assert.equal(Number(head.headers.get("content-length")), bytes.length)
  const range = await fetch(`${registry}/v2/${repo}/blobs/${largeDigest}`, {
    headers: { Authorization: `Bearer ${guestToken}`, Range: "bytes=0-1023" },
  })
  assert.equal(range.status, 206)
  assert.equal(range.headers.get("content-range"), `bytes 0-1023/${bytes.length}`)
  assert.deepEqual(
    new Uint8Array(await range.arrayBuffer()),
    new Uint8Array(bytes.subarray(0, 1024)),
  )
  assertions += 4

  const privatePush = await token(`repository:${privateRepo}:pull,push,delete`, maintainer)
  await uploadBlob(privateRepo, privatePush, config)
  await check(
    await registryCall(
      `/v2/${privateRepo}/manifests/latest`,
      privatePush,
      "PUT",
      manifest,
      "application/vnd.oci.image.manifest.v1+json",
    ),
    201,
    "Push a private image through ingress",
  )
  const privatePull = await token(`repository:${privateRepo}:pull`, viewer)
  await check(
    await registryCall(`/v2/${privateRepo}/manifests/latest`, privatePull),
    200,
    "Viewer pulls a private image through ingress",
  )
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
  await check(
    await registryCall(`/v2/${privateRepo}/manifests/latest`, privateGuest),
    401,
    "Guest private image pull is blocked through ingress",
  )
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
