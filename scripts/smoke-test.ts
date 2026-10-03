import assert from "node:assert/strict"
import { createHash, randomBytes, randomUUID } from "node:crypto"

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
  await check(
    await browser(`/api/keys/${imageKey.id}/rotate`, "POST"),
    401,
    "Guests cannot rotate keys",
  )
  await check(
    await browser(`/api/keys/${imageKey.id}/rotate`, "POST", undefined, viewerCookie),
    404,
    "Other users cannot rotate keys",
  )
  await check(
    await browser(
      `/api/keys/${imageKey.id}/rotate`,
      "POST",
      undefined,
      maintainerCookie,
      "http://evil.example",
    ),
    403,
    "Cross-origin rotation blocked",
  )
  await check(
    await fetch(`${app}/api/keys/${imageKey.id}/rotate`, {
      method: "POST",
      headers: { Cookie: maintainerCookie },
    }),
    403,
    "Rotation requires Origin",
  )
  await check(
    await browser("/api/keys/not-a-uuid/rotate", "POST", undefined, maintainerCookie),
    400,
    "Invalid rotation ID rejected",
  )
  await check(
    await browser(`/api/keys/${randomUUID()}/rotate`, "POST", undefined, maintainerCookie),
    404,
    "Missing rotation key rejected",
  )
  await check(
    await fetch(`${app}/api/keys/${imageKey.id}/rotate`, {
      method: "POST",
      headers: {
        Origin: app,
        Authorization: `Basic ${Buffer.from(`${imageKey.username}:${imageKey.secret}`).toString("base64")}`,
      },
    }),
    401,
    "Keys cannot rotate themselves",
  )
  const keysBeforeRotation = await check(
    await browser("/api/keys", "GET", undefined, maintainerCookie),
    200,
    "Key metadata before rotation",
  )
  const originalMetadata = keysBeforeRotation.keys.find(
    (key: { id: string }) => key.id === imageKey.id,
  )
  const originalSecret = imageKey.secret
  const rotationResponse = await browser(
    `/api/keys/${imageKey.id}/rotate`,
    "POST",
    undefined,
    maintainerCookie,
  )
  assert.equal(rotationResponse.headers.get("cache-control"), "no-store")
  assertions++
  const rotated = await check(rotationResponse, 200, "Owner rotates image key")
  assert.deepEqual({ ...rotated, secret: undefined }, { ...imageKey, secret: undefined })
  assert.ok(rotated.secret !== originalSecret, "Rotation must produce a different secret")
  assert.ok(!("secretHash" in rotated), "Rotation must not return the stored hash")
  assertions += 3
  const keysAfterRotation = await check(
    await browser("/api/keys", "GET", undefined, maintainerCookie),
    200,
    "Key metadata after rotation",
  )
  const rotatedMetadata = keysAfterRotation.keys.find(
    (key: { id: string }) => key.id === imageKey.id,
  )
  assert.ok(rotatedMetadata.rotatedAt)
  assert.equal(rotatedMetadata.lastUsedAt, null)
  assert.deepEqual(
    { ...rotatedMetadata, rotatedAt: null, lastUsedAt: originalMetadata.lastUsedAt },
    originalMetadata,
  )
  assert.ok(!("secret" in rotatedMetadata) && !("secretHash" in rotatedMetadata))
  assertions += 4
  await rejectedKey(imageKey.username, originalSecret, "Old secret rejected after rotation")
  imageKey.secret = rotated.secret
  const replacementToken = await token(
    `repository:${repo}:pull,push,delete`,
    imageKey.username,
    imageKey.secret,
  )
  const replacementClaims = JSON.parse(
    Buffer.from(replacementToken.split(".")[1], "base64url").toString(),
  )
  assert.deepEqual(replacementClaims.access[0].actions, ["pull", "push"])
  assert.equal(replacementClaims.sub, imageKey.username)
  assertions += 2
  await check(
    await registryCall(`/v2/${repo}/blobs/uploads/`, replacementToken, "POST"),
    202,
    "Replacement secret can push through registry ingress",
  )
  // Rotation is also an authenticated recovery path for a locked-out active credential.
  for (let attempt = 0; attempt < 20; attempt++)
    await rejectedKey(viewerKey.username, "dk_wrong", "Wrong viewer secret rejected")
  await check(
    await fetch(`${app}/api/registry/token?service=dockyard-registry`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${viewerKey.username}:${viewerKey.secret}`).toString("base64")}`,
      },
    }),
    429,
    "Key authentication rate limit enforced",
  )
  const rotatedViewerKey = await check(
    await browser(`/api/keys/${viewerKey.id}/rotate`, "POST", undefined, viewerCookie),
    200,
    "Viewer rotates own key and clears attempt limit",
  )
  assert.deepEqual({ ...rotatedViewerKey, secret: undefined }, { ...viewerKey, secret: undefined })
  assertions++
  viewerKey.secret = rotatedViewerKey.secret
  await token(`repository:${privateRepo}:pull`, viewerKey.username, viewerKey.secret)
  const rotatedProjectKey = await check(
    await browser(
      `/api/keys/${projectKey.id.toUpperCase()}/rotate`,
      "POST",
      undefined,
      adminCookie,
    ),
    200,
    "Admin rotates another user's project key",
  )
  assert.deepEqual(
    { ...rotatedProjectKey, secret: undefined },
    { ...projectKey, secret: undefined },
  )
  assertions++
  await rejectedKey(
    projectKey.username,
    projectKey.secret,
    "Admin rotation invalidates previous project secret",
  )
  projectKey.secret = rotatedProjectKey.secret
  await token(`repository:${repo}:pull,push`, projectKey.username, projectKey.secret)
  const concurrentKey = await check(
    await browser(
      "/api/keys",
      "POST",
      {
        name: `concurrent-${suffix}`,
        grants: [{ type: "image", target: repo, actions: ["pull"] }],
        expiresAt: null,
      },
      maintainerCookie,
    ),
    201,
    "Create non-expiring concurrent rotation key",
  )
  const parallelRotations = await Promise.all(
    [0, 1].map(async () =>
      check(
        await browser(`/api/keys/${concurrentKey.id}/rotate`, "POST", undefined, maintainerCookie),
        200,
        "Concurrent rotation commits atomically",
      ),
    ),
  )
  assert.ok(
    parallelRotations.every(
      (key) => key.expiresAt === null && key.username === concurrentKey.username,
    ),
  )
  const parallelAuthentication = await Promise.all(
    parallelRotations.map((key) =>
      fetch(`${app}/api/registry/token?service=dockyard-registry`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${key.username}:${key.secret}`).toString("base64")}`,
        },
      }),
    ),
  )
  assert.deepEqual(
    parallelAuthentication.map((response) => response.status).sort(),
    [200, 401],
    "Only the last committed rotation secret remains usable",
  )
  assertions += 2
  const racingResponses = await Promise.all([
    browser(`/api/keys/${concurrentKey.id}/rotate`, "POST", undefined, maintainerCookie),
    browser(`/api/keys/${concurrentKey.id}`, "DELETE", undefined, adminCookie),
  ])
  assert.ok([200, 409].includes(racingResponses[0].status))
  await check(racingResponses[1], 200, "Concurrent revocation commits")
  const racingCredentials =
    racingResponses[0].status === 200 ? await racingResponses[0].json() : null
  if (racingCredentials)
    await rejectedKey(
      racingCredentials.username,
      racingCredentials.secret,
      "Concurrent rotation cannot revive a revoked key",
    )
  await check(
    await browser(`/api/keys/${concurrentKey.id}/rotate`, "POST", undefined, maintainerCookie),
    409,
    "Revoked concurrent key remains unrotatable",
  )
  assertions++
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
    await browser(`/api/keys/${expiringKey.id}/rotate`, "POST", undefined, maintainerCookie),
    409,
    "Expired keys cannot rotate",
  )
  await check(
    await browser(`/api/keys/${adminKey.id}`, "DELETE", {}, adminCookie),
    200,
    "Revoke scoped admin key",
  )
  await rejectedKey(adminKey.username, adminKey.secret, "Revoked key authentication rejected")
  await check(
    await browser(`/api/keys/${adminKey.id}/rotate`, "POST", undefined, adminCookie),
    409,
    "Revoked keys cannot rotate",
  )
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
  const deletionProject = `delete_${suffix}`
  const siblingProject = `${deletionProject}-other`
  const deletingImage = `${deletionProject}/api`
  const indexImage = `${deletionProject}/multi`
  await check(
    await browser(
      "/api/projects",
      "POST",
      { name: deletionProject, visibility: "private" },
      maintainerCookie,
    ),
    201,
    "Create deletion fixture project",
  )
  await check(
    await browser(
      "/api/projects",
      "POST",
      { name: siblingProject, visibility: "public" },
      maintainerCookie,
    ),
    201,
    "Create prefix-sharing neighboring project",
  )
  for (const name of [deletingImage, indexImage, `${deletionProject}/reserved`]) {
    await check(
      await browser("/api/repositories", "POST", { name, visibility: "private" }, maintainerCookie),
      201,
      "Reserve deletion fixture image",
    )
  }
  await check(
    await browser(
      "/api/repositories",
      "POST",
      { name: `${siblingProject}/safe`, visibility: "public" },
      maintainerCookie,
    ),
    201,
    "Reserve unaffected neighbor",
  )
  const deletionKey = await check(
    await browser(
      "/api/keys",
      "POST",
      {
        name: `deletion-key-${suffix}`,
        grants: [{ type: "project", target: deletionProject, actions: ["pull", "push", "delete"] }],
      },
      maintainerCookie,
    ),
    201,
    "Create key for deletion access checks",
  )
  const deletingToken = await token(`repository:${deletingImage}:pull,push,delete`, maintainer)
  await uploadBlob(deletingImage, deletingToken, config)
  for (const tag of ["latest", "stable", "previous"]) {
    const body =
      tag === "previous"
        ? JSON.stringify({
            ...JSON.parse(manifest),
            annotations: { "org.opencontainers.image.version": "previous" },
          })
        : manifest
    await check(
      await registryCall(
        `/v2/${deletingImage}/manifests/${tag}`,
        deletingToken,
        "PUT",
        body,
        "application/vnd.oci.image.manifest.v1+json",
      ),
      201,
      "Push root manifest and alias deletion fixtures",
    )
  }
  const multiToken = await token(`repository:${indexImage}:pull,push,delete`, maintainer)
  await uploadBlob(indexImage, multiToken, config)
  const childDigest = `sha256:${createHash("sha256").update(manifest).digest("hex")}`
  await check(
    await registryCall(
      `/v2/${indexImage}/manifests/${childDigest}`,
      multiToken,
      "PUT",
      manifest,
      "application/vnd.oci.image.manifest.v1+json",
    ),
    201,
    "Push untagged index child manifest",
  )
  const indexManifest = JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [
      {
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        digest: childDigest,
        size: Buffer.byteLength(manifest),
        platform: { os: "linux", architecture: "arm64" },
      },
    ],
  })
  for (const tag of ["latest", "release"])
    await check(
      await registryCall(
        `/v2/${indexImage}/manifests/${tag}`,
        multiToken,
        "PUT",
        indexManifest,
        "application/vnd.oci.image.index.v1+json",
      ),
      201,
      "Push OCI index alias fixture",
    )
  await check(
    await browser(`/api/repositories/${deletingImage}`, "DELETE", { confirmName: deletingImage }),
    401,
    "Guests cannot delete image repositories",
  )
  await check(
    await browser(
      `/api/repositories/${deletingImage}`,
      "DELETE",
      { confirmName: deletingImage },
      viewerCookie,
    ),
    403,
    "Viewers cannot delete image repositories",
  )
  await check(
    await browser(
      `/api/projects/${deletionProject}`,
      "DELETE",
      { confirmName: deletionProject },
      viewerCookie,
    ),
    403,
    "Viewers cannot delete projects",
  )
  await check(
    await browser(
      `/api/projects/${deletionProject}`,
      "DELETE",
      { confirmName: deletionProject },
      undefined,
    ),
    401,
    "Guests cannot delete projects",
  )
  await check(
    await browser(
      `/api/repositories/${deletingImage}`,
      "DELETE",
      { confirmName: deletingImage },
      maintainerCookie,
      "http://evil.example",
    ),
    403,
    "Cross-origin image deletion rejected",
  )
  await check(
    await browser(
      `/api/projects/${deletionProject}`,
      "DELETE",
      { confirmName: deletionProject },
      maintainerCookie,
      "http://evil.example",
    ),
    403,
    "Cross-origin project deletion rejected",
  )
  await check(
    await browser(
      `/api/repositories/${deletingImage}`,
      "DELETE",
      { confirmName: "wrong" },
      maintainerCookie,
    ),
    400,
    "Image deletion requires exact path confirmation",
  )
  await check(
    await browser(
      `/api/projects/${deletionProject}`,
      "DELETE",
      { confirmName: "wrong" },
      maintainerCookie,
    ),
    400,
    "Project deletion requires exact name confirmation",
  )
  await check(
    await browser(`/api/repositories/${deletingImage}`, "DELETE", {}, maintainerCookie),
    400,
    "Empty deletion body is not a bulk delete",
  )
  await check(
    await fetch(`${app}/api/projects/${deletionProject}`, {
      method: "DELETE",
      headers: {
        Origin: app,
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${deletionKey.username}:${deletionKey.secret}`).toString("base64")}`,
      },
      body: JSON.stringify({ confirmName: deletionProject }),
    }),
    401,
    "Registry keys cannot delete projects through browser APIs",
  )
  const removedImage = await check(
    await browser(
      `/api/repositories/${deletingImage}`,
      "DELETE",
      { confirmName: deletingImage },
      maintainerCookie,
    ),
    200,
    "Maintainer deletes complete image repository",
  )
  assert.equal(
    removedImage.deletedManifests,
    2,
    "Alias tags must not cause duplicate digest deletion",
  )
  assertions++
  await check(
    await browser(`/api/repositories/${deletingImage}`, "GET", undefined, adminCookie),
    404,
    "Deleted image details remain hidden from admins",
  )
  const afterImageDeletion = await check(
    await browser("/api/repositories", "GET", undefined, adminCookie),
    200,
    "Catalog after complete image deletion",
  )
  assert.ok(
    !afterImageDeletion.repositories.some(
      (image: { name: string }) => image.name === deletingImage,
    ),
  )
  assertions++
  for (const name of [undefined, username, deletionKey.username]) {
    const scoped = await token(
      `repository:${deletingImage}:pull,push,delete`,
      name,
      name === deletionKey.username
        ? deletionKey.secret
        : name === username
          ? password!
          : testPassword,
    )
    assert.deepEqual(
      JSON.parse(Buffer.from(scoped.split(".")[1], "base64url").toString()).access[0].actions,
      [],
    )
    assertions++
  }
  await check(
    await browser(`/api/projects/${deletionProject}`, "GET", undefined, maintainerCookie),
    200,
    "Deleting one image leaves its project intact",
  )
  await check(
    await registryCall(
      `/v2/${deletingImage}/manifests/cached-token-push`,
      deletingToken,
      "PUT",
      manifest,
      "application/vnd.oci.image.manifest.v1+json",
    ),
    201,
    "Previously issued token retains its documented short-lived rights",
  )
  const webhookSecret = process.env.REGISTRY_WEBHOOK_SECRET
  async function pushNotification(name: string) {
    if (!webhookSecret) return
    await check(
      await fetch(`${app}/api/registry/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${webhookSecret}` },
        body: JSON.stringify({
          events: [
            {
              id: randomUUID(),
              action: "push",
              timestamp: new Date().toISOString(),
              actor: { name: maintainer },
              target: {
                repository: name,
                mediaType: "application/vnd.oci.image.manifest.v1+json",
                digest: childDigest,
                tag: "cached-token-push",
              },
            },
          ],
        }),
      }),
      200,
      "Deliver delayed registry push notification",
    )
  }
  await pushNotification(deletingImage)
  const afterLatePush = await check(
    await browser("/api/repositories", "GET", undefined, adminCookie),
    200,
    "Deleted image stays hidden after cached-token push and webhook",
  )
  assert.ok(
    !afterLatePush.repositories.some((image: { name: string }) => image.name === deletingImage),
  )
  assertions++
  await check(
    await browser(
      `/api/repositories/${deletingImage}`,
      "DELETE",
      { confirmName: deletingImage },
      maintainerCookie,
    ),
    200,
    "Re-deletion cleans late cached-token manifests without reviving the image",
  )
  if (webhookSecret) {
    for (const legacy of [deletionProject, `${deletionProject}/legacy/deep`]) {
      await pushNotification(legacy)
      const legacyToken = await token(`repository:${legacy}:pull,push`, maintainer)
      await uploadBlob(legacy, legacyToken, config)
      await check(
        await registryCall(
          `/v2/${legacy}/manifests/latest`,
          legacyToken,
          "PUT",
          manifest,
          "application/vnd.oci.image.manifest.v1+json",
        ),
        201,
        "Push discovered legacy deletion fixture",
      )
    }
  }
  const futureName = `${deletionProject}/late`
  const futureDeletionToken = await token(`repository:${futureName}:pull,push`, maintainer)
  const deletedProject = await check(
    await browser(
      `/api/projects/${deletionProject}`,
      "DELETE",
      { confirmName: deletionProject },
      maintainerCookie,
    ),
    200,
    "Maintainer deletes project, OCI index, aliases, reservations, and nested legacy images",
  )
  assert.ok(deletedProject.deletedImages >= 3)
  assert.ok(deletedProject.deletedManifests >= 1)
  assertions += 2
  await check(
    await browser(`/api/projects/${deletionProject}`, "GET", undefined, adminCookie),
    404,
    "Deleted project detail is gone",
  )
  const projectCatalog = await check(
    await browser("/api/projects", "GET", undefined, adminCookie),
    200,
    "Deleted projects do not reappear from Distribution catalog names",
  )
  assert.ok(
    !projectCatalog.projects.some((project: { name: string }) => project.name === deletionProject),
  )
  assertions++
  await check(
    await browser(`/api/repositories/${siblingProject}/safe`, "GET", undefined, maintainerCookie),
    200,
    "Prefix-sharing neighbor is not deleted",
  )
  if (webhookSecret)
    await check(
      await browser(`/api/repositories/${deletionProject}`, "GET", undefined, maintainerCookie),
      200,
      "Flat legacy image with matching project word is not a project member",
    )
  await check(
    await browser(
      "/api/repositories",
      "POST",
      { name: `${deletionProject}/new`, visibility: "public" },
      maintainerCookie,
    ),
    409,
    "Deleted project cannot be silently recreated by creating an image",
  )
  for (const name of [indexImage, futureName]) {
    const closed = await token(`repository:${name}:pull,push,delete`, username, password!)
    assert.deepEqual(
      JSON.parse(Buffer.from(closed.split(".")[1], "base64url").toString()).access[0].actions,
      [],
    )
    assertions++
  }
  await uploadBlob(futureName, futureDeletionToken, config)
  await check(
    await registryCall(
      `/v2/${futureName}/manifests/latest`,
      futureDeletionToken,
      "PUT",
      manifest,
      "application/vnd.oci.image.manifest.v1+json",
    ),
    201,
    "Cached token can finish a previously authorized project push",
  )
  await pushNotification(futureName)
  await check(
    await browser(`/api/repositories/${futureName}`, "GET", undefined, adminCookie),
    404,
    "Late child notification cannot restore a deleted project",
  )
  await check(
    await browser(
      `/api/projects/${deletionProject}`,
      "DELETE",
      { confirmName: deletionProject },
      maintainerCookie,
    ),
    200,
    "Project deletion is retryable after late pushes",
  )
  await check(
    await browser(
      "/api/projects",
      "POST",
      { name: deletionProject, visibility: "private" },
      maintainerCookie,
    ),
    201,
    "Explicitly recreate deleted project",
  )
  const recreated = await check(
    await browser(`/api/projects/${deletionProject}`, "GET", undefined, maintainerCookie),
    200,
    "Recreated project does not restore its deleted images",
  )
  assert.deepEqual(recreated.images, [])
  assertions++
  await check(
    await browser(
      "/api/repositories",
      "POST",
      { name: indexImage, visibility: "private" },
      maintainerCookie,
    ),
    201,
    "Explicitly recreate one deleted image",
  )
  await check(
    await browser(`/api/repositories/${indexImage}`, "GET", undefined, maintainerCookie),
    200,
    "Recreated image becomes readable again",
  )
  await check(
    await browser(`/api/repositories/${indexImage}`),
    404,
    "Recreated private image is not leaked to guests",
  )
  const reopened = await token(
    `repository:${indexImage}:pull,push`,
    deletionKey.username,
    deletionKey.secret,
  )
  assert.deepEqual(
    JSON.parse(Buffer.from(reopened.split(".")[1], "base64url").toString()).access[0].actions,
    ["pull", "push"],
  )
  assertions++
  if (webhookSecret) {
    await check(
      await browser(
        "/api/repositories",
        "POST",
        { name: `${deletionProject}/legacy/deep`, visibility: "private" },
        maintainerCookie,
      ),
      201,
      "Explicitly recreate a retired nested legacy path",
    )
    await check(
      await browser(
        `/api/repositories/${deletionProject}`,
        "DELETE",
        { confirmName: deletionProject },
        maintainerCookie,
      ),
      200,
      "Delete the independent flat legacy image",
    )
    await check(
      await browser(
        "/api/repositories",
        "POST",
        { name: deletionProject, visibility: "private" },
        maintainerCookie,
      ),
      201,
      "Explicitly recreate a retired flat legacy path without permitting new flat names",
    )
  }
  await check(
    await browser(
      "/api/projects",
      "POST",
      { name: `empty-${suffix}`, visibility: "public" },
      maintainerCookie,
    ),
    201,
    "Create empty project deletion fixture",
  )
  await check(
    await browser(
      `/api/projects/empty-${suffix}`,
      "DELETE",
      { confirmName: `empty-${suffix}` },
      maintainerCookie,
    ),
    200,
    "Delete empty configured project",
  )
  await check(
    await browser(
      `/api/projects/does-not-exist-${suffix}`,
      "DELETE",
      { confirmName: `does-not-exist-${suffix}` },
      maintainerCookie,
    ),
    404,
    "Missing project deletion returns 404",
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
    await browser(`/api/keys/${imageKey.id}/rotate`, "POST", undefined, adminCookie),
    409,
    "Disabled owner's key cannot rotate even for admin",
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
  const activity = await check(
    await browser("/api/activity", "GET", undefined, adminCookie),
    200,
    "Admin audit log",
  )
  const rotationEvents = activity.events.filter(
    (event: { action: string }) => event.action === "key.rotate",
  )
  assert.ok(
    rotationEvents.some(
      (event: { actor: string; target: string }) =>
        event.actor === username && event.target === projectKey.name,
    ),
  )
  assert.ok(
    rotationEvents.some(
      (event: { actor: string; target: string }) =>
        event.actor === maintainer && event.target === imageKey.name,
    ),
  )
  assert.ok(
    !JSON.stringify(activity).includes(imageKey.secret) &&
      !JSON.stringify(activity).includes(originalSecret),
  )
  assertions += 3
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
