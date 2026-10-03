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
