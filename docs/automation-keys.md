# Automation keys

Automation keys are scoped registry credentials for CI/CD, deployments, and other unattended Docker/OCI flows. Use them instead of putting a user's account password in a pipeline.

Keys authenticate to the existing registry token endpoint. They **do not** create browser sessions or authorize web administration/API management requests. Manage keys through an authenticated web session.

## Create a key

1. Sign in and open **Automation keys → Create key**.
2. Give the key a descriptive name, such as `GitHub Actions — release`.
3. Choose expiration (90 days is the default recommendation).
4. Add one or more resource grants. Choose **Project** or **Image**, select the resource from its dropdown, and select operations. Changing the grant type clears its previous selection.
5. Save the generated Docker username and secret in your CI secret manager. The secret is shown **once** and cannot be retrieved from the list later.

| Grant type | Target example  | Applies to                                                                                                                 |
| ---------- | --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Project    | `dockyard`      | Every image under `dockyard/`, including future images and existing deeper legacy paths. Does not match `dockyard-tools/`. |
| Image      | `dockyard/init` | Only this exact image, including its tags. Does not match `dockyard/web` or `dockyard/init-extra`.                         |

Allowed operations are `pull`, `push`, and `delete`. Grants are additive: a project pull grant plus an image push grant permits pulling that project's images but pushing only the selected image. There are no wildcard/admin/catalog grants.

Project targets must already exist. The UI dropdown lists existing projects and configured/discovered images, including reserved images without tags and existing legacy repository paths. To select an exact image before its first push, create/reserve it from its project page first, or choose a project grant for future images. The management API also permits an exact `project/image` grant for a future image in an existing project. Nonconforming legacy image grants must target an existing repository. The `project/image` creation policy remains enforced.

For typical Docker builds, grant **pull + push** to the intended resource. Cross-repository blob mounting may request pull access to a source image; add that source grant if your workflow needs it. Delete is separate and should be reserved for intentional cleanup jobs.

## Docker login

The generated username has the form `_key_<uuid>` and the secret has the prefix `dk_`. Use the key username, **not** the owner's username:

```sh
# Inject these variables from your CI secret manager.
printf '%s' "$DOCKYARD_KEY" | docker login cr.guneet.dev \
  --username "$DOCKYARD_KEY_USERNAME" --password-stdin

docker build -t cr.guneet.dev/dockyard/init:"$IMAGE_TAG" .
docker push cr.guneet.dev/dockyard/init:"$IMAGE_TAG"
docker logout cr.guneet.dev
```

Use your public registry hostname/port, shared with the UI. Require HTTPS over untrusted networks. Do not commit key secrets, place them in Docker build arguments, put them directly in shell commands, or enable shell tracing while handling them. Prefer isolated Docker credential storage on shared runners.

## GitHub Actions example

Create repository/environment secrets named `DOCKYARD_KEY_USERNAME` and `DOCKYARD_KEY`. A release workflow can use them as follows:

```yaml
steps:
  - uses: actions/checkout@v4
  - name: Login, build, and push
    env:
      DOCKYARD_KEY_USERNAME: ${{ secrets.DOCKYARD_KEY_USERNAME }}
      DOCKYARD_KEY: ${{ secrets.DOCKYARD_KEY }}
      IMAGE_TAG: ${{ github.sha }}
    run: |
      printf '%s' "$DOCKYARD_KEY" | docker login cr.guneet.dev --username "$DOCKYARD_KEY_USERNAME" --password-stdin
      docker build --target init -t "cr.guneet.dev/dockyard/init:$IMAGE_TAG" .
      docker push "cr.guneet.dev/dockyard/init:$IMAGE_TAG"
  - name: Logout
    if: always()
    run: docker logout cr.guneet.dev
```

Grant only the exact image or project this workflow publishes. Use separate keys for build, deployment, and cleanup jobs rather than sharing a broad key across unrelated workflows.

## Ownership and role limits

- Every key belongs to the user who created it. That owner can list/revoke their keys; admins can list/revoke all keys. Secrets and secret hashes are never returned in key listings.
- Viewers can create only pull keys. Maintainers/admins can create pull/push/delete grants, but the key never gains browser/admin privileges.
- Effective registry actions are the intersection of **requested actions**, **key resource grants**, and the owner's **current role**. A demoted owner cannot keep write access through a previously created key.
- Disabling the owner prevents future authentication with all their keys. Deleting an owner deletes their keys through the database foreign key.
- A scoped key does not fall back to anonymous public-read permissions outside its grants. Anonymous public pulls are a separate client flow.
- Private projects/images remain private to anonymous clients; an authorized scoped key can read them because its active owner has authenticated read access.

Project/image settings and account roles are checked when issuing tokens. Caddy continues to forward the client's bearer token unchanged; it does not insert an internal service credential.

## Expiration, revocation, and rotation

Keys can expire or be explicitly revoked. Creation defaults to 90 days; the API permits a future expiry up to one year, or `null` for no expiration. Use finite expiry wherever possible. The list shows the key owner, granted resources/actions, last successful authentication, and status.

Revocation blocks **new token requests** immediately. Distribution validates already-issued JWTs without calling back to the app, so previously issued authorization can remain valid for up to five minutes. JWT expiry is also capped at the key's expiry: it cannot outlive an expiring key. Previously downloaded images cannot be revoked.

To rotate a key:

1. Create a replacement with the same or narrower grants.
2. Update the CI secret manager and confirm the workflow succeeds.
3. Revoke the old key from the UI.
4. Allow the token-expiry window before assuming all old authorization is gone.

Changing a user's password does not rotate their automation keys. Revoke those separately if a key or account is compromised. Key creation/revocation is recorded in audit history; registry pushes identify the key username in the actor field.

## Management API

These routes require a normal browser session; keys cannot use them to mint more keys:

- `GET /api/keys`: own key metadata, or all keys for an admin.
- `POST /api/keys`: create an owner-bound key and return the secret once.
- `DELETE /api/keys/<uuid>`: revoke an owned key, or any key for an admin.

Creation accepts:

```json
{
  "name": "release-init",
  "grants": [{ "type": "image", "target": "dockyard/init", "actions": ["pull", "push"] }],
  "expiresAt": "2027-01-01T00:00:00Z"
}
```

Choose an actual future expiration when using the API. Browser writes require an exact `Origin` match with `APP_URL`, and raw registry automation uses Docker's Basic-to-bearer token exchange rather than session cookies.

## Upgrade

The migration job creates the `access_keys` table before web startup. Only SHA-256 hashes of cryptographically random secrets are stored. The signing keys from `init` remain separate from automation credentials and TLS certificates.

Back up the database along with registry data and signing material, protect CI secrets, and never delete data volumes to revoke a key.

[Documentation index](README.md) · [Projects and images](projects.md) · [Authentication](reference.md#access-model)
