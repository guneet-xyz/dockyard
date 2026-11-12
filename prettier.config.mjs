/** @type {import("prettier").Config & import("prettier-plugin-tailwindcss").PluginOptions & import("@ianvs/prettier-plugin-sort-imports").PluginConfig} */
const config = {
  semi: false,
  plugins: [
    "@ianvs/prettier-plugin-sort-imports",
    "prettier-plugin-packagejson",
    "prettier-plugin-tailwindcss",
  ],
  importOrder: [
    "<BUILTIN_MODULES>",
    "<THIRD_PARTY_MODULES>",
    "",
    "^@/(.*)$",
    "",
    "^[./]",
  ],
  tailwindStylesheet: "./src/app/globals.css",
}

export default config
