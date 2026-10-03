import { expect, test } from "@playwright/test"

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

test("automation key secret is shown once and the key can be revoked", async ({ page }) => {
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
  await page.getByRole("button", { name: "I saved the secret", exact: true }).click()
  await page.reload()
  await expect(page.getByRole("heading", { name: keyName, exact: true })).toBeVisible()
  await expect(page.getByLabel("Key secret", { exact: true })).toHaveCount(0)
  const card = page
    .locator("div.rounded-xl.border.bg-card")
    .filter({ has: page.getByRole("heading", { name: keyName, exact: true }) })
  await card.getByRole("button", { name: "Revoke", exact: true }).click()
  await page.getByRole("button", { name: "Revoke key", exact: true }).click()
  await expect(card.getByText("Revoked", { exact: true })).toBeVisible()
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
