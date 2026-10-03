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
const protectedProject = `protected-${suffix}`
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

async function rejectedKey(username: string, secret: string, label: string) {
  return check(
    await fetch(`${app}/api/registry/token?service=dockyard-registry`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${secret}`).toString("base64")}`,
      },
    }),
    401,
    label,
  )
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
  const projectList = await check(await browser("/api/projects"), 200, "Guest project list")
  assert.ok(
    projectList.projects.some(
      (project: { name: string; imageCount: number }) =>
        project.name === `smoke-${suffix}` && project.imageCount === 1,
    ),
  )
  assertions++
  await check(
    await browser(
      "/api/projects",
      "POST",
      { name: "viewer-cannot-create", visibility: "public" },
      viewerCookie,
    ),
    403,
    "Viewer project creation blocked",
  )
  await check(
    await browser(
      "/api/projects",
      "POST",
      { name: protectedProject, visibility: "private", description: "Private project test" },
      maintainerCookie,
    ),
    201,
    "Create private project",
  )
  await check(
    await browser(`/api/projects/${protectedProject}`),
    404,
    "Private project hidden from guests",
  )
  await check(
    await browser(`/api/projects/${protectedProject}`, "GET", undefined, viewerCookie),
    200,
    "Viewer can browse private project",
  )
  await check(
    await browser(
      "/api/repositories",
      "POST",
      { name: `${protectedProject}/init`, visibility: "public" },
      maintainerCookie,
    ),
    400,
    "Private projects cannot expose public child images",
  )
  await check(
    await browser(
      "/api/repositories",
      "POST",
      { name: `${protectedProject}/init`, visibility: "private" },
      maintainerCookie,
    ),
    201,
    "Reserve image under private project",
  )
  await check(await browser("/api/keys"), 401, "Guest key management blocked")
  await check(
    await browser(
      "/api/keys",
      "POST",
      { name: "viewer-write", grants: [{ type: "image", target: repo, actions: ["push"] }] },
      viewerCookie,
    ),
    403,
    "Viewer cannot mint write keys",
  )
  await check(
    await browser(
      "/api/keys",
      "POST",
      {
        name: "unknown-project",
        grants: [{ type: "project", target: `missing-${suffix}`, actions: ["pull"] }],
      },
      maintainerCookie,
    ),
    404,
    "Unknown project key grant rejected",
  )
  await check(
    await browser(
      "/api/keys",
      "POST",
      {
        name: "already-expired",
        grants: [{ type: "image", target: repo, actions: ["pull"] }],
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
      maintainerCookie,
    ),
    400,
    "Past key expiry rejected",
  )
  const imageKey = await check(
    await browser(
      "/api/keys",
      "POST",
      {
        name: `image-build-${suffix}`,
        grants: [{ type: "image", target: repo, actions: ["pull", "push"] }],
      },
      maintainerCookie,
    ),
    201,
    "Create exact-image build key",
  )
  const viewerKey = await check(
    await browser(
      "/api/keys",
      "POST",
      {
        name: `viewer-deploy-${suffix}`,
        grants: [{ type: "image", target: privateRepo, actions: ["pull"] }],
      },
      viewerCookie,
    ),
    201,
    "Viewer creates a private-image pull key",
  )
  const projectKey = await check(
    await browser(
      "/api/keys",
      "POST",
      {
        name: `project-release-${suffix}`,
        grants: [{ type: "project", target: `smoke-${suffix}`, actions: ["pull", "push"] }],
      },
      maintainerCookie,
    ),
    201,
    "Create project release key",
  )
  const adminKey = await check(
    await browser(
      "/api/keys",
      "POST",
      {
        name: `admin-scoped-${suffix}`,
        grants: [{ type: "image", target: repo, actions: ["pull"] }],
      },
      adminCookie,
    ),
    201,
    "Admin key remains resource scoped",
  )
  const viewerKeys = await check(
    await browser("/api/keys", "GET", undefined, viewerCookie),
    200,
    "Viewer lists own key metadata",
  )
  assert.ok(viewerKeys.keys.some((key: { id: string }) => key.id === viewerKey.id))
  assert.ok(!viewerKeys.keys.some((key: { id: string }) => key.id === imageKey.id))
  assert.ok(
    viewerKeys.keys.every(
      (key: Record<string, unknown>) => !("secret" in key) && !("secretHash" in key),
    ),
  )
  assertions += 3
  await check(
    await browser(`/api/keys/${imageKey.id}`, "DELETE", {}, viewerCookie),
    404,
    "Other user's key cannot be revoked",
  )
  await check(
    await fetch(`${app}/api/keys`, { headers: { Authorization: `Bearer ${imageKey.secret}` } }),
    401,
    "Registry keys cannot mint or list keys through web APIs",
  )
  await check(
    await browser("/api/auth/login", "POST", {
      username: imageKey.username,
      password: imageKey.secret,
    }),
    401,
    "Registry key cannot create a browser session",
  )
  const imageKeyToken = await token(
    `repository:${repo}:pull,push,delete`,
    imageKey.username,
    imageKey.secret,
  )
  assert.deepEqual(
    JSON.parse(Buffer.from(imageKeyToken.split(".")[1], "base64url").toString()).access[0].actions,
    ["pull", "push"],
  )
  assertions++
  const outsideImage = await token(
    `repository:${privateRepo}:pull,push`,
    imageKey.username,
    imageKey.secret,
  )
  assert.deepEqual(
    JSON.parse(Buffer.from(outsideImage.split(".")[1], "base64url").toString()).access[0].actions,
    [],
  )
  assertions++
  await check(
    await registryCall(`/v2/${privateRepo}/blobs/uploads/`, outsideImage, "POST"),
    401,
    "Image key cannot push a sibling image",
  )
  const outsidePublic = await token(
    `repository:mixed-project/api:pull`,
    imageKey.username,
    imageKey.secret,
  )
  assert.deepEqual(
    JSON.parse(Buffer.from(outsidePublic.split(".")[1], "base64url").toString()).access[0].actions,
    [],
  )
  assertions++
  const futureToken = await token(
    `repository:smoke-${suffix}/future:pull,push`,
    projectKey.username,
    projectKey.secret,
  )
  await check(
    await registryCall(`/v2/smoke-${suffix}/future/blobs/uploads/`, futureToken, "POST"),
    202,
    "Project key can push a future image",
  )
  const otherProject = await token(
    `repository:${protectedProject}/other:push`,
    projectKey.username,
    projectKey.secret,
  )
  await check(
    await registryCall(`/v2/${protectedProject}/other/blobs/uploads/`, otherProject, "POST"),
    401,
    "Project key cannot cross namespaces",
  )
  const keyCatalog = await token("registry:catalog:*", adminKey.username, adminKey.secret)
  await check(
    await registryCall("/v2/_catalog", keyCatalog),
    401,
    "Admin-owned keys cannot obtain raw catalog privileges",
  )
  await rejectedKey(imageKey.username, `${imageKey.secret}wrong`, "Wrong key secret rejected")
  const expiringKey = await check(
    await browser(
      "/api/keys",
      "POST",
      {
        name: `short-lived-${suffix}`,
        grants: [{ type: "image", target: repo, actions: ["pull"] }],
        expiresAt: new Date(Date.now() + 4000).toISOString(),
      },
      maintainerCookie,
    ),
    201,
    "Create expiring key",
  )
  const expiringToken = await token(
    `repository:${repo}:pull`,
    expiringKey.username,
    expiringKey.secret,
  )
  const expiryClaims = JSON.parse(Buffer.from(expiringToken.split(".")[1], "base64url").toString())
  assert.ok(expiryClaims.exp <= Math.floor(new Date(expiringKey.expiresAt).getTime() / 1000))
  assert.ok(expiryClaims.exp - expiryClaims.iat < 300)
  assertions += 2
  await new Promise((resolve) => setTimeout(resolve, 4500))
  await rejectedKey(expiringKey.username, expiringKey.secret, "Expired key authentication rejected")
  await check(
    await browser(`/api/keys/${adminKey.id}`, "DELETE", {}, adminCookie),
    200,
    "Revoke scoped admin key",
  )
  await rejectedKey(adminKey.username, adminKey.secret, "Revoked key authentication rejected")
  await check(
    await browser(
      "/api/repositories",
      "POST",
      { name: `smoke-${suffix}/nested/image`, visibility: "public" },
      maintainerCookie,
    ),
    400,
    "New API images require exactly project/image",
  )
  await check(
    await browser(
      "/api/repositories",
      "POST",
      { name: `unscoped-${suffix}`, visibility: "public" },
      maintainerCookie,
    ),
    400,
    "New unscoped API images rejected",
  )
  const nestedToken = await token(`repository:smoke-${suffix}/nested/image:push`, maintainer)
  await check(
    await registryCall(`/v2/smoke-${suffix}/nested/image/blobs/uploads/`, nestedToken, "POST"),
    401,
    "New deeply nested Docker images cannot bypass naming policy",
  )
  const flatToken = await token(`repository:unscoped-${suffix}:push`, maintainer)
  await check(
    await registryCall(`/v2/unscoped-${suffix}/blobs/uploads/`, flatToken, "POST"),
    401,
    "New unscoped Docker images cannot bypass naming policy",
  )
  const protectedGuest = await token(`repository:${protectedProject}/new-image:pull`)
  assert.deepEqual(
    JSON.parse(Buffer.from(protectedGuest.split(".")[1], "base64url").toString()).access[0].actions,
    [],
  )
  assertions++
  await check(
    await browser(
      `/api/projects/smoke-${suffix}`,
      "PATCH",
      { description: "Updated project", visibility: "private" },
      viewerCookie,
    ),
    403,
    "Viewer project settings blocked",
  )
  await check(
    await browser(
      `/api/projects/smoke-${suffix}`,
      "PATCH",
      { description: "Updated project", visibility: "private" },
      maintainerCookie,
    ),
    200,
    "Maintainer can make an existing project private",
  )
  await check(
    await browser(`/api/repositories/${repo}`),
    404,
    "Project privacy hides previously public images",
  )
  const hidden = await token(`repository:${repo}:pull`)
  assert.deepEqual(
    JSON.parse(Buffer.from(hidden.split(".")[1], "base64url").toString()).access[0].actions,
    [],
  )
  assertions++
  await check(
    await browser(
      `/api/projects/smoke-${suffix}`,
      "PATCH",
      { description: "Updated project", visibility: "public" },
      maintainerCookie,
    ),
    200,
    "Project can be reopened without rewriting image paths",
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
  await check(
    await registryCall(`/v2/${repo}/manifests/latest`, imageKeyToken),
    200,
    "Image key pulls its authorized image",
  )
  await uploadBlob(repo, imageKeyToken, config)
  await check(
    await registryCall(
      `/v2/${repo}/manifests/key-push`,
      imageKeyToken,
      "PUT",
      manifest,
      "application/vnd.oci.image.manifest.v1+json",
    ),
    201,
    "Image key performs a real manifest push",
  )

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
  const viewerKeyToken = await token(
    `repository:${privateRepo}:pull,push`,
    viewerKey.username,
    viewerKey.secret,
  )
  await check(
    await registryCall(`/v2/${privateRepo}/manifests/latest`, viewerKeyToken),
    200,
    "Viewer-owned key pulls the exact private image",
  )
  await check(
    await registryCall(`/v2/${privateRepo}/blobs/uploads/`, viewerKeyToken, "POST"),
    401,
    "Viewer key cannot push",
  )
  const protectedPush = await token(`repository:${protectedProject}/web:pull,push`, maintainer)
  await uploadBlob(`${protectedProject}/web`, protectedPush, config)
  await check(
    await registryCall(
      `/v2/${protectedProject}/web/manifests/latest`,
      protectedPush,
      "PUT",
      manifest,
      "application/vnd.oci.image.manifest.v1+json",
    ),
    201,
    "CLI push inherits an existing private project",
  )
  const protectedRead = await token(`repository:${protectedProject}/web:pull`, viewer)
  await check(
    await registryCall(`/v2/${protectedProject}/web/manifests/latest`, protectedRead),
    200,
    "Authenticated viewer reads a project-private CLI image",
  )
  const noProtectedRead = await token(`repository:${protectedProject}/web:pull`)
  await check(
    await registryCall(`/v2/${protectedProject}/web/manifests/latest`, noProtectedRead),
    401,
    "Guest cannot pull a newly pushed project-private image",
  )
  const detail = await check(
    await browser(`/api/repositories/${repo}`),
    200,
    "UI reads live image metadata",
  )
  assert.equal(detail.images[0].platforms[0], "linux/arm64")
  assertions++
  await check(
    await registryCall(`/v2/${repo}/manifests/${detail.images[0].digest}`, imageKeyToken, "DELETE"),
    401,
    "Push permission does not implicitly allow deletion",
  )
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
    await browser(`/api/users/${created.id}`, "PATCH", { role: "viewer" }, adminCookie),
    200,
    "Demote key owner",
  )
  const demoted = await token(
    `repository:${repo}:pull,push,delete`,
    imageKey.username,
    imageKey.secret,
  )
  assert.deepEqual(
    JSON.parse(Buffer.from(demoted.split(".")[1], "base64url").toString()).access[0].actions,
    ["pull"],
  )
  assertions++
  await check(
    await browser(`/api/users/${created.id}`, "PATCH", { enabled: false }, adminCookie),
    200,
    "Disable maintainer",
  )
  await rejectedKey(imageKey.username, imageKey.secret, "Disabled owner blocks existing keys")
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
