import type { Visibility } from "./types"

export const config = {
  get appUrl() {
    return process.env.APP_URL ?? "http://localhost:3000"
  },
  get registryUrl() {
    return process.env.REGISTRY_INTERNAL_URL ?? "http://registry:5000"
  },
  get registryHost() {
    return process.env.REGISTRY_PUBLIC_HOST ?? "localhost:5000"
  },
  get issuer() {
    return process.env.REGISTRY_TOKEN_ISSUER ?? "dockyard"
  },
  get service() {
    return process.env.REGISTRY_TOKEN_SERVICE ?? "dockyard-registry"
  },
  get defaultVisibility(): Visibility {
    return process.env.DEFAULT_REPOSITORY_VISIBILITY === "private" ? "private" : "public"
  },
  get secureCookies() {
    return new URL(this.appUrl).protocol === "https:"
  },
}
