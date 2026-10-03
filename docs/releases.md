# CI/CD and releases

GitHub Actions publishes four Docker/OCI images to the Dockyard instance at `cr.guneet.dev`:

- `cr.guneet.dev/dockyard/init`
- `cr.guneet.dev/dockyard/migrate`
- `cr.guneet.dev/dockyard/web`
- `cr.guneet.dev/dockyard/ingress`

Every published tag is a multi-architecture image index containing **`linux/amd64` and `linux/arm64`**. All four images share the same source revision and release version. Buildx produces OCI provenance and SBOM attestations and uses separate GitHub Actions build-cache scopes per Dockerfile target. CI does not publish PostgreSQL or Distribution images, deploy the running registry, or push npm packages.

## One-time GitHub and registry setup

1. In the `cr.guneet.dev` Dockyard UI, create the `dockyard` project. Create an automation key owned by an enabled maintainer/admin, with a **Project** grant targeting `dockyard` and actions **pull + push**. No delete or administration grant is needed. A project grant covers all four images and their first pushes; with exact-image grants, reserve each image and grant access to all four instead.
2. In **GitHub → guneet-xyz/dockyard → Settings → Environments**, create/select the **`release`** environment and add its environment secrets:

   | Secret            | Value                                             |
   | ----------------- | ------------------------------------------------- |
   | `DOCKER_USERNAME` | The generated `_key_<uuid>` Docker username.      |
   | `DOCKER_PASSWORD` | Its `dk_…` secret, not the owner's user password. |

   Each image-publishing matrix job declares `environment: release` directly in **Release and publish**, so GitHub resolves the secrets in that job after any environment approvals/protection rules are satisfied. Registry secrets are not passed across a reusable-workflow boundary or inherited by CI. If deployment-branch restrictions are enabled for this environment, allow **main** (the workflow runs on main even when rebuilding a release tag). Release preparation and CI jobs remain outside this environment.

3. Under **Settings → Actions → General → Workflow permissions**, enable **Allow GitHub Actions to create and approve pull requests**. If the repository's organization restricts Actions, allow the pinned official Docker actions and Google's Release Please action. The release preparation job requests narrowly scoped contents, issue/label, pull-request, and workflow-dispatch permissions; test/build jobs only need contents read.
4. Push this configuration to `main`. Pull requests and other branches run quality/integration checks without registry secrets or publishing rights. The release/publishing workflow is restricted to `main` in `guneet-xyz/dockyard`; forks must deliberately change that guard and configure their own secrets before publishing.

The registry must be reachable from GitHub-hosted runners over HTTPS with a publicly trusted certificate. Keep its existing Dockyard Basic-to-bearer authentication and forward `Authorization` through its proxy unchanged. This pipeline uses ordinary `docker/login-action` credentials, not browser sessions, proxy bypass credentials, or an internal service token. Secrets are used for registry login only, never as Docker build arguments, image labels, or committed files. Rotate the key from Dockyard and update `DOCKER_PASSWORD` when needed; the username stays unchanged.

Before building, each publication job requests a scoped token and checks that the registry grants both `pull` and `push` for its exact `dockyard/<image>` path. This check uploads nothing and never prints credentials or bearer tokens. Successful Docker login alone does not prove write access. If preflight reports insufficient permissions, create a replacement key with a `dockyard` project **pull + push** grant owned by an enabled maintainer/admin, then update both secrets in the `release` environment and retry. Changing the workflow cannot expand a key's grants or its owner's role.

## Automatic versions from conventional commits

Release Please maintains one release PR for the whole application, updating `package.json`, `.release-please-manifest.json`, and `CHANGELOG.md`. There are no independent component versions or npm publication. Generated `CHANGELOG.md` and `.release-please-manifest.json` are excluded from Prettier so their generated formatting does not fail CI; the manifest is still parsed and checked against the package version in unit tests.

| Commit example                                       | Version impact               |
| ---------------------------------------------------- | ---------------------------- |
| `fix: handle interrupted image uploads`              | Patch                        |
| `feat: add retention policies`                       | Minor                        |
| `feat!: change registry authentication`              | Major                        |
| Any conventional commit with `BREAKING CHANGE:`      | Major                        |
| `docs:`, `test:`, `chore:` without a breaking change | No release bump on their own |

Use conventional commit messages when committing directly, or use a conventional **PR title** when squash-merging. For a breaking-change footer, preserve it in the squash commit body. A batch of commits takes the highest applicable bump, not one release per commit.

The first public release starts at **`0.1.0`**, matching the bootstrap package version; there is no prior Git release/tag to seed. The empty manifest bootstraps the first release from existing conventional history. After that, Release Please tracks the last released version automatically. Do not manually change the manifest or package version for normal releases.

**Merge the release PR to approve a stable release.** Release Please then creates the Git tag `vMAJOR.MINOR.PATCH` and a GitHub release with generated notes. Stable publication runs in the same workflow using Release Please's exact release SHA, not whatever happens to be the latest branch head. Quality, unit, registry integration, Docker CLI, and browser checks must pass for that source before any image is pushed.

Only the built-in `GITHUB_TOKEN` is used for GitHub release operations; no PAT or third secret is required. Bot-created PRs and tags normally do not trigger more workflows. To avoid that trap, the release workflow explicitly dispatches the **Quality and integration** workflow on newly created/updated release-PR branches, and starts its environment-bound publication jobs after checks. Manual CI dispatch is also available on a release-PR branch if a check needs rerunning. Choose the resulting quality-check status when configuring branch protection.

## Published tags

For a stable `v1.2.3` release, each of the four images receives:

| Image tag                            | Meaning                                                               |
| ------------------------------------ | --------------------------------------------------------------------- |
| `1.2.3`                              | Full stable version; use the same tag for every Dockyard service.     |
| `1.2`                                | Latest stable patch in that minor line.                               |
| `1`                                  | Latest stable release in that major line (no `0` alias is generated). |
| `latest`                             | Most recently published stable release.                               |
| `sha-<full-40-character-commit-sha>` | Traceable source revision.                                            |

Successful development runs on `main` receive `edge` and the full SHA tag, **not** `latest` or the package's not-yet-released version. `edge` is updated only for the tested commit that triggered that main run, never for an older release discovered by Release Please. No PR, feature-branch, `local`, or prerelease image tags are published by this workflow.

The four target builds run as a matrix, with at most two in parallel; each target builds both architectures. Publication is serialized across release runs and is not canceled halfway through. A registry cannot atomically update tags across four repositories, so **wait for the entire workflow to succeed** before upgrading, and pin a full version or per-image digest rather than treating floating aliases as an atomic deployment.

## Use published images with Compose

Preserve existing secrets and data. Set these non-secret values in your deployment `.env`:

```dotenv
DOCKYARD_IMAGE_PREFIX=cr.guneet.dev/dockyard
# Replace with a version whose entire publication workflow has succeeded.
DOCKYARD_IMAGE_TAG=0.1.0
```

Then omit the local-build override:

```sh
# Login first if the project/images are private; use a separate pull-only key.
docker login cr.guneet.dev
docker compose --env-file .env -f deploy/compose.yaml pull
docker compose --env-file .env -f deploy/compose.yaml up --wait --wait-timeout 240
```

`DOCKYARD_IMAGE_PREFIX` affects only image locations, not your deployment's public `APP_URL`, registry token issuer, or persistent volume names. `init` and `migrate` still run as one-off startup jobs before web. Local source builds remain available with `deploy/compose.build.yaml` and `DOCKYARD_IMAGE_TAG=local`.

## Failed publication and recovery

A GitHub release/tag may already exist when a build or push fails. Fix the cause (key expiry/grants, registry availability, build failure), then **rerun failed jobs** in that workflow; do not rerun its successful release-preparation job or create another version just to retry an upload. The run summary records each successfully pushed image's index digest and tags.

For a later retry, run **Release and publish → Run workflow** on **main**, set `release_tag` to the existing GitHub release (for example `v0.1.0`), and leave `update_latest` off. This validates the release tag, its ancestry on `main`, and its package version, tests that exact source, then republishes the full version and SHA tags without moving `edge`, `latest`, or major/minor aliases. Only turn `update_latest` on when intentionally restoring the current stable release; enabling it for an older release moves those aliases backwards. Recovery takes workflow definitions from main while building the selected release's source.

This setup does not upload anything locally or modify GitHub repository settings/secrets automatically. Add the secrets, enable PR creation, and push the committed workflow configuration to activate it.

[Documentation index](README.md) · [Build setup](deployment/build.md) · [Automation keys](automation-keys.md)
