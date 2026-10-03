import { allowedActions } from "./permissions"
import type { KeyGrant, Role, Visibility } from "./types"

export function allowedKeyActions(
  grants: KeyGrant[],
  role: Role,
  visibility: Visibility,
  repository: string,
  requested: string[],
) {
  return allowedActions(role, visibility, requested).filter((action) =>
    grants.some((grant) => {
      const matches =
        grant.type === "image"
          ? grant.target === repository
          : repository.startsWith(`${grant.target}/`)
      return matches && grant.actions.some((permitted) => permitted === action)
    }),
  )
}
