import { randomBytes } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"

const secret = () => randomBytes(32).toString("hex")
let text = await readFile(".env.example", "utf8")
const replacements = {
  "replace-with-a-random-url-safe-password": secret(),
  "replace-with-a-strong-admin-password": secret(),
  "replace-with-a-random-secret-at-least-32-characters": secret(),
  "replace-with-a-different-random-secret-at-least-32-characters": secret(),
}
for (const [placeholder, value] of Object.entries(replacements)) {
  text = text.replaceAll(placeholder, value)
}
try {
  await writeFile(".env", text, { flag: "wx", mode: 0o600 })
  console.log("Created .env with random secrets. Read ADMIN_PASSWORD in .env to sign in.")
  console.log("Next: docker compose up --build -d")
} catch (error) {
  if (error.code === "EEXIST") {
    console.error(".env already exists. It was not changed.")
    process.exitCode = 1
  } else {
    throw error
  }
}
