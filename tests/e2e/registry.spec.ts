import { expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"

test("guest can browse without login and has no write controls", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "A home for your containers." })).toBeVisible()
  await expect(page.getByText("Guest access", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "New image" })).toHaveCount(0)
  await page.getByRole("link", { name: "Browse projects" }).click()
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
  await page.getByRole("link", { name: "Images", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Images", exact: true })).toBeVisible()
  await page.getByRole("textbox", { name: "Search images" }).fill("no-such-repository-123456789")
  await expect(page.getByText("No matching images")).toBeVisible()
  await page.getByRole("button", { name: "Clear search" }).click()
  await page.getByRole("button", { name: "Grid view" }).click()
  await expect(page.getByRole("button", { name: "Grid view" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  expect(errors).toEqual([])
})

test("mobile navigation closes on selection and layout does not overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await page.getByRole("button", { name: "Open navigation" }).click()
  await page.getByRole("dialog").getByRole("link", { name: "Projects", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.goto("/login")
  await expect(page.getByRole("heading", { name: "Sign in to Dockyard" })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})

test("login form rejects invalid credentials", async ({ page }) => {
  await page.goto("/login")
  await page.getByLabel("Username", { exact: true }).fill("unknown-e2e-user")
  await page.getByLabel("Password", { exact: true }).fill("not-a-real-password")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(
    page.getByRole("alert").filter({ hasText: "Incorrect username or password" }),
  ).toBeVisible()
})

test("admin signs in, creates a private repository, and sees administration", async ({ page }) => {
  test.skip(
    !process.env.TEST_ADMIN_PASSWORD,
    "Set TEST_ADMIN_PASSWORD to enable admin browser checks",
  )
  await page.goto("/login")
  await page
    .getByLabel("Username", { exact: true })
    .fill(process.env.TEST_ADMIN_USERNAME ?? "admin")
  await page.getByLabel("Password", { exact: true }).fill(process.env.TEST_ADMIN_PASSWORD!)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page.getByRole("heading", { name: "A home for your containers." })).toBeVisible()
  await page.getByRole("button", { name: "New project" }).click()
  const project = `browser-${Date.now().toString(36)}`
  const name = `${project}/private-app`
  await page.getByLabel("Project name", { exact: true }).fill(project)
  await page.getByLabel("Visibility", { exact: true }).click()
  await page.getByRole("option", { name: "Private — all images require sign-in" }).click()
  await page.getByRole("button", { name: "Create project", exact: true }).click()
  await expect(page.getByRole("heading", { name: project, exact: true })).toBeVisible()
  await page.getByRole("button", { name: "New image" }).click()
  await page.getByLabel("Image name", { exact: true }).fill("private-app")
  await page.getByRole("button", { name: "Create image", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${project}/images/private-app$`))
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
  await expect(page.getByText("Ready for your first image")).toBeVisible()
  await page.getByRole("tab", { name: "Settings" }).click()
  await page.getByLabel("Description", { exact: true }).fill("Created by browser verification")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("Repository settings saved.")).toBeVisible()
  await page.getByRole("link", { name: "Access control", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Access control", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Add user" })).toBeVisible()
  await page.getByRole("link", { name: "Activity log", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Activity log", exact: true })).toBeVisible()
  await expect(page.getByText(name).first()).toBeVisible()
})

test("automation key can be rotated, downloaded once, and revoked", async ({ page }) => {
  test.skip(
    !process.env.TEST_ADMIN_PASSWORD,
    "Set TEST_ADMIN_PASSWORD to enable key browser checks",
  )
  await page.goto("/login")
  await page
    .getByLabel("Username", { exact: true })
    .fill(process.env.TEST_ADMIN_USERNAME ?? "admin")
  await page.getByLabel("Password", { exact: true }).fill(process.env.TEST_ADMIN_PASSWORD!)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page.getByRole("heading", { name: "A home for your containers." })).toBeVisible()
  await page.getByRole("button", { name: "New project" }).click()
  const suffix = Date.now().toString(36)
  const project = `key-browser-${suffix}`
  const keyName = `browser-build-${suffix}`
  await page.getByLabel("Project name", { exact: true }).fill(project)
  await page.getByRole("button", { name: "Create project", exact: true }).click()
  await expect(page.getByRole("heading", { name: project, exact: true })).toBeVisible()
  await page.getByRole("button", { name: "New image", exact: true }).click()
  await page.getByLabel("Image name", { exact: true }).fill("init")
  await page.getByRole("button", { name: "Create image", exact: true }).click()
  await expect(page.getByRole("heading", { name: `${project}/init`, exact: true })).toBeVisible()
  await page.getByRole("link", { name: "Automation keys", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Automation keys", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Create key", exact: true }).click()
  await page.getByLabel("Key name", { exact: true }).fill(keyName)
  await expect(page.getByRole("textbox", { name: "Grant 1 target", exact: true })).toHaveCount(0)
  await page.getByRole("combobox", { name: "Grant 1 target", exact: true }).click()
  await page.getByRole("option", { name: `${project}/init`, exact: true }).click()
  await page.getByRole("combobox", { name: "Grant 1 type", exact: true }).click()
  await page.getByRole("option", { name: "Project", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "Grant 1 target", exact: true })).toContainText(
    "Select project",
  )
  await page.getByRole("combobox", { name: "Grant 1 target", exact: true }).click()
  await page.getByRole("option", { name: project, exact: true }).click()
  await page.getByRole("button", { name: "Add grant", exact: true }).click()
  await page.getByRole("combobox", { name: "Grant 2 target", exact: true }).click()
  await page.getByRole("option", { name: `${project}/init`, exact: true }).click()
  await page.getByRole("checkbox", { name: "Push", exact: true }).last().check()
  await page.getByRole("button", { name: "Create key", exact: true }).last().click()
  await expect(page.getByRole("heading", { name: "Save your key secret" })).toBeVisible()
  await expect(page.getByLabel("Key secret", { exact: true })).toHaveAttribute("type", "password")
  await expect(page.getByLabel("Docker username", { exact: true })).toHaveValue(/^_key_/)
  const keyUsername = await page.getByLabel("Docker username", { exact: true }).inputValue()
  const keySecret = await page.getByLabel("Key secret", { exact: true }).inputValue()
  const downloading = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download JSON", exact: true }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^dockyard-key-[0-9a-f-]+\.json$/)
  const file = test.info().outputPath("downloaded-key.json")
  await download.saveAs(file)
  const exported = JSON.parse(await readFile(file, "utf8"))
  expect(exported.version).toBe(1)
  expect(exported.name).toBe(keyName)
  expect(exported.username).toBe(keyUsername)
  // Assert equality without including a credential in assertion failure output.
  expect(exported.secret === keySecret).toBe(true)
  expect(exported.grants).toEqual([
    { type: "project", target: project, actions: ["pull"] },
    { type: "image", target: `${project}/init`, actions: ["pull", "push"] },
  ])
  expect(exported.expiresAt).toBeTruthy()
  expect(exported).not.toHaveProperty("secretHash")
  const secretDialog = page.getByRole("dialog", { name: "Save your key secret" })
  await page.getByRole("button", { name: "Show key secret", exact: true }).click()
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await expect
      .poll(() =>
        secretDialog.evaluate((element) => {
          const dialog = element as HTMLElement
          const bounds = dialog.getBoundingClientRect()
          const style = getComputedStyle(dialog)
          const left = bounds.left + parseFloat(style.paddingLeft)
          const right = bounds.right - parseFloat(style.paddingRight)
          return (
            bounds.left >= 0 &&
            bounds.right <= window.innerWidth + 1 &&
            dialog.scrollWidth <= dialog.clientWidth + 1 &&
            [...dialog.querySelectorAll("input, [data-slot='button']")].every((control) => {
              const rectangle = control.getBoundingClientRect()
              return rectangle.left >= left - 1 && rectangle.right <= right + 1
            })
          )
        }),
      )
      .toBe(true)
  }
  await page.getByRole("button", { name: "Hide key secret", exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole("button", { name: "I saved the secret", exact: true }).click()
  await page.reload()
  await expect(page.getByRole("heading", { name: keyName, exact: true })).toBeVisible()
  await expect(page.getByLabel("Key secret", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Download JSON", exact: true })).toHaveCount(0)
  const card = page
    .locator("div.rounded-xl.border.bg-card")
    .filter({ has: page.getByRole("heading", { name: keyName, exact: true }) })
  await card.getByRole("button", { name: "Rotate", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "Rotate this key?" })).toContainText(
    "old secret stops authenticating immediately",
  )
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await card.getByRole("button", { name: "Rotate", exact: true }).click()
  // A failed rotation must not show credentials or silently dismiss the confirmation.
  await page.route(`**/api/keys/${exported.id}/rotate`, (route) =>
    route.fulfill({ status: 409, json: { error: "Rotation temporarily blocked for test" } }),
  )
  await page.getByRole("button", { name: "Rotate key", exact: true }).click()
  await expect(
    page.getByText("Rotation temporarily blocked for test", { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole("dialog", { name: "Rotate this key?" })).toBeVisible()
  await expect(page.getByLabel("Key secret", { exact: true })).toHaveCount(0)
  await page.unroute(`**/api/keys/${exported.id}/rotate`)
  await page.getByRole("button", { name: "Rotate key", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Save your key secret" })).toBeVisible()
  await expect(page.getByLabel("Key secret", { exact: true })).toHaveAttribute("type", "password")
  await expect(page.getByLabel("Docker username", { exact: true })).toHaveValue(keyUsername)
  const replacementSecret = await page.getByLabel("Key secret", { exact: true }).inputValue()
  expect(replacementSecret !== keySecret).toBe(true)
  const rotationDownloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download JSON", exact: true }).click()
  const rotationDownload = await rotationDownloadPromise
  const rotationFile = test.info().outputPath("rotated-key.json")
  await rotationDownload.saveAs(rotationFile)
  const replacement = JSON.parse(await readFile(rotationFile, "utf8"))
  expect(replacement.secret === replacementSecret).toBe(true)
  const { secret: omittedOriginal, ...originalMetadata } = exported
  const { secret: omittedReplacement, ...replacementMetadata } = replacement
  expect(Boolean(omittedOriginal && omittedReplacement)).toBe(true)
  expect(replacementMetadata).toEqual(originalMetadata)
  await page.setViewportSize({ width: 320, height: 844 })
  await expect(secretDialog).toBeVisible()
  expect(
    await secretDialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true)
  await page.getByRole("button", { name: "I saved the secret", exact: true }).click()
  await expect(card.getByText(/^Last rotated /)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.reload()
  await expect(page.getByLabel("Key secret", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Download JSON", exact: true })).toHaveCount(0)
  await card.getByRole("button", { name: "Revoke", exact: true }).click()
  await page.getByRole("button", { name: "Revoke key", exact: true }).click()
  await expect(card.getByText("Revoked", { exact: true })).toBeVisible()
  await expect(card.getByRole("button", { name: "Rotate", exact: true })).toHaveCount(0)
  await page.goto("/activity")
  await expect(page.getByText("Rotated automation key", { exact: true }).first()).toBeVisible()
})

test("image and project deletion require typed confirmation, survive errors, and stay deleted", async ({
  page,
}) => {
  test.skip(
    !process.env.TEST_ADMIN_PASSWORD,
    "Set TEST_ADMIN_PASSWORD to enable deletion browser checks",
  )
  const base = process.env.TEST_APP_URL ?? "http://localhost:3000"
  const headers = { Origin: new URL(base).origin }
  const login = await page.request.post(`${base}/api/auth/login`, {
    headers,
    data: {
      username: process.env.TEST_ADMIN_USERNAME ?? "admin",
      password: process.env.TEST_ADMIN_PASSWORD!,
    },
  })
  expect(login.status()).toBe(200)
  const project = `delete-browser-${Date.now().toString(36)}`
  const image = `${project}/app`
  expect(
    (
      await page.request.post(`${base}/api/projects`, {
        headers,
        data: { name: project, visibility: "public" },
      })
    ).status(),
  ).toBe(201)
  expect(
    (
      await page.request.post(`${base}/api/repositories`, {
        headers,
        data: { name: image, visibility: "public" },
      })
    ).status(),
  ).toBe(201)
  await page.goto(`/projects/${project}/images/app`)
  await page.getByRole("tab", { name: "Settings", exact: true }).click()
  await page.getByRole("button", { name: "Delete image", exact: true }).click()
  const imageDialog = page.getByRole("dialog", { name: "Delete this image?" })
  const deleteImage = imageDialog.getByRole("button", { name: "Delete image", exact: true })
  await expect(deleteImage).toBeDisabled()
  await imageDialog.getByLabel("Confirm image name", { exact: true }).fill("wrong")
  await expect(deleteImage).toBeDisabled()
  await imageDialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.getByRole("button", { name: "Delete image", exact: true }).click()
  await expect(imageDialog.getByLabel("Confirm image name", { exact: true })).toHaveValue("")
  await imageDialog.getByLabel("Confirm image name", { exact: true }).fill(image)
  await expect(deleteImage).toBeEnabled()
  await page.setViewportSize({ width: 320, height: 844 })
  expect(
    await imageDialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true)
  await page.route(`**/api/repositories/${image}`, (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({ status: 503, json: { error: "Deletion test registry unavailable" } })
      : route.continue(),
  )
  await deleteImage.click()
  await expect(page.getByText("Deletion test registry unavailable", { exact: true })).toBeVisible()
  await expect(imageDialog).toBeVisible()
  await expect(imageDialog.getByLabel("Confirm image name", { exact: true })).toHaveValue(image)
  await page.unroute(`**/api/repositories/${image}`)
  await deleteImage.click()
  await expect(page).toHaveURL(new RegExp(`/projects/${project}$`))
  await expect(page.getByRole("link", { name: "app", exact: true })).toHaveCount(0)
  expect((await page.request.get(`${base}/api/repositories/${image}`)).status()).toBe(404)
  await page.getByRole("tab", { name: "Project settings", exact: true }).click()
  await page.getByRole("button", { name: "Delete project", exact: true }).click()
  const projectDialog = page.getByRole("dialog", { name: "Delete this project?" })
  const deleteProject = projectDialog.getByRole("button", { name: "Delete project", exact: true })
  await expect(deleteProject).toBeDisabled()
  await projectDialog.getByLabel("Confirm project name", { exact: true }).fill(project)
  await deleteProject.click()
  await expect(page).toHaveURL(/\/projects$/)
  await page.reload()
  await expect(page.getByRole("heading", { name: project, exact: true })).toHaveCount(0)
  expect((await page.request.get(`${base}/api/projects/${project}`)).status()).toBe(404)
})

test("image and tag pull counts appear in detail, project lists, and image grids without counting UI reads", async ({
  page,
}) => {
  test.skip(
    !process.env.TEST_ADMIN_PASSWORD || !process.env.REGISTRY_WEBHOOK_SECRET,
    "Set test admin and registry webhook credentials for pull-count browser checks",
  )
  const base = process.env.TEST_APP_URL ?? "http://localhost:3000"
  const origin = { Origin: new URL(base).origin }
  const username = process.env.TEST_ADMIN_USERNAME ?? "admin"
  expect(
    (
      await page.request.post(`${base}/api/auth/login`, {
        headers: origin,
        data: { username, password: process.env.TEST_ADMIN_PASSWORD! },
      })
    ).status(),
  ).toBe(200)
  const project = `pull-browser-${Date.now().toString(36)}`
  const image = `${project}/app`
  expect(
    (
      await page.request.post(`${base}/api/projects`, {
        headers: origin,
        data: { name: project, visibility: "public" },
      })
    ).status(),
  ).toBe(201)
  expect(
    (
      await page.request.post(`${base}/api/repositories`, {
        headers: origin,
        data: { name: image, visibility: "public" },
      })
    ).status(),
  ).toBe(201)
  const issuing = await page.request.get(
    `${base}/api/registry/token?service=dockyard-registry&scope=${encodeURIComponent(`repository:${image}:pull,push`)}`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${process.env.TEST_ADMIN_PASSWORD!}`).toString("base64")}`,
      },
    },
  )
  expect(issuing.status()).toBe(200)
  const registryHeaders = { Authorization: `Bearer ${(await issuing.json()).token}` }
  const config = JSON.stringify({
    architecture: "arm64",
    os: "linux",
    config: {},
    rootfs: { type: "layers", diff_ids: [] },
  })
  const configDigest = `sha256:${createHash("sha256").update(config).digest("hex")}`
  const upload = await page.request.post(`${base}/v2/${image}/blobs/uploads/`, {
    headers: registryHeaders,
  })
  expect(upload.status()).toBe(202)
  const location = new URL(upload.headers().location, base)
  location.searchParams.set("digest", configDigest)
  expect(
    (
      await page.request.put(location.toString(), {
        headers: { ...registryHeaders, "Content-Type": "application/octet-stream" },
        data: config,
      })
    ).status(),
  ).toBe(201)
  const mediaType = "application/vnd.oci.image.manifest.v1+json"
  const manifest = JSON.stringify({
    schemaVersion: 2,
    mediaType,
    config: {
      mediaType: "application/vnd.oci.image.config.v1+json",
      digest: configDigest,
      size: Buffer.byteLength(config),
    },
    layers: [],
  })
  const digest = `sha256:${createHash("sha256").update(manifest).digest("hex")}`
  for (const tag of ["latest", "stable"])
    expect(
      (
        await page.request.put(`${base}/v2/${image}/manifests/${tag}`, {
          headers: { ...registryHeaders, "Content-Type": mediaType },
          data: manifest,
        })
      ).status(),
    ).toBe(201)
  const events = [
    ...Array.from({ length: 5 }, () => "latest"),
    ...Array.from({ length: 7 }, () => "stable"),
  ].map((tag) => ({
    id: randomUUID(),
    action: "pull",
    timestamp: new Date().toISOString(),
    request: { method: "GET", useragent: "Docker/browser-test" },
    target: { repository: image, tag, digest, mediaType },
  }))
  expect(
    (
      await page.request.post(`${base}/api/registry/events`, {
        headers: { Authorization: `Bearer ${process.env.REGISTRY_WEBHOOK_SECRET!}` },
        data: { events },
      })
    ).status(),
  ).toBe(200)
  await page.goto(`/projects/${project}/images/app`)
  await expect(page.getByLabel("Image pull count", { exact: true })).toHaveText("12 pulls")
  await expect(page.getByLabel("Pulls for tag latest", { exact: true })).toHaveText("5 pulls")
  await expect(page.getByLabel("Pulls for tag stable", { exact: true })).toHaveText("7 pulls")
  await page.goto(`/projects/${project}`)
  await expect(page.getByLabel(`Pulls for image ${image}`, { exact: true })).toHaveText("12 pulls")
  await page.goto("/repositories")
  await page.getByRole("textbox", { name: "Search images" }).fill(image)
  await expect(page.getByLabel(`Pulls for image ${image}`, { exact: true })).toHaveText("12 pulls")
  await page.getByRole("button", { name: "Grid view" }).click()
  await expect(page.getByLabel(`Pulls for image ${image}`, { exact: true })).toHaveText("12 pulls")
  await page.getByRole("combobox", { name: "Sort images" }).click()
  await page.getByRole("option", { name: "Most pulls", exact: true }).click()
  await page.setViewportSize({ width: 320, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  const afterBrowsing = await page.request.get(`${base}/api/repositories/${image}`)
  expect(afterBrowsing.status()).toBe(200)
  expect((await afterBrowsing.json()).repository.pullCount).toBe(12)
})

test("automation resource selects handle fetch failures and empty collections", async ({
  page,
}) => {
  test.skip(
    !process.env.TEST_ADMIN_PASSWORD,
    "Set TEST_ADMIN_PASSWORD to enable key browser checks",
  )
  const base = process.env.TEST_APP_URL ?? "http://localhost:3000"
  const login = await page.request.post(`${base}/api/auth/login`, {
    headers: { Origin: new URL(base).origin },
    data: {
      username: process.env.TEST_ADMIN_USERNAME ?? "admin",
      password: process.env.TEST_ADMIN_PASSWORD!,
    },
  })
  expect(login.status()).toBe(200)
  await page.route("**/api/projects", (route) =>
    route.fulfill({
      json: {
        projects: [],
        ungroupedCount: 0,
        registryHost: new URL(base).host,
        defaultVisibility: "public",
        canWrite: true,
      },
    }),
  )
  let attempts = 0
  await page.route("**/api/repositories", (route) => {
    attempts++
    return attempts <= 2
      ? route.fulfill({ status: 503, json: { error: "Test unavailable" } })
      : route.fulfill({
          json: {
            repositories: [],
            registryHost: new URL(base).host,
            defaultVisibility: "public",
            canWrite: true,
          },
        })
  })
  await page.goto("/keys")
  await page.getByRole("button", { name: "Create key", exact: true }).click()
  await page.getByLabel("Key name", { exact: true }).fill("empty-resource-test")
  await expect(page.getByRole("alert").filter({ hasText: "Unable to load images" })).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Grant 1 target", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Retry resources", exact: true }).click()
  await expect(page.getByText("No images available.", { exact: false })).toBeVisible()
  await expect(page.getByRole("button", { name: "Create key", exact: true }).last()).toBeDisabled()
  await page.getByRole("combobox", { name: "Grant 1 type", exact: true }).click()
  await page.getByRole("option", { name: "Project", exact: true }).click()
  await expect(page.getByText("No projects available.", { exact: false })).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Grant 1 target", exact: true })).toBeDisabled()
})
