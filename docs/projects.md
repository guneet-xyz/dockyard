# Projects and images

Dockyard groups new images into a two-level namespace:

```text
cr.guneet.dev/dockyard/init:latest
│             │        │    └── tag
│             │        └─────── image: init
│             └──────────────── project: dockyard
└────────────────────────────── registry host
```

For example, project `dockyard` can contain images `init`, `migrate`, `web`, and `ingress`. Tags and manifest digests belong to each image.

## Naming policy

New image repository names must be exactly **`project/image`**. Both components follow lowercase Docker naming rules. Registry hostnames and tags are not part of the project/image name supplied to the UI/API.

- Accepted: `dockyard/init`, `team/api`, `my-project/my-app`.
- Rejected for new images: `init`, `team/backend/api`, `dockyard/init:latest`, or `cr.guneet.dev/dockyard/init` as a UI/API image name.
- The full repository path is limited to 255 characters. Project names cannot contain `/`.

Distribution itself supports more than two path components; this is Dockyard's application-level policy. It is enforced by image creation APIs and by the Docker token endpoint before granting push access to a new nonconforming repository.

## Create a project and publish images

1. Sign in as a maintainer or admin.
2. Open **Projects → New project**, choose a name, description, and visibility.
3. Open the project and choose **New image**. Enter only the image name, such as `init`.
4. Use the same registry endpoint for web and Docker:

   ```sh
   docker login cr.guneet.dev
   docker tag my-init:latest cr.guneet.dev/dockyard/init:latest
   docker push cr.guneet.dev/dockyard/init:latest
   docker pull cr.guneet.dev/dockyard/init:latest
   ```

The project/image prefix stays intact through ingress and Distribution. Image pages display tags, digests, platforms, sizes, and pull commands. Their canonical UI path is `/projects/dockyard/images/init`.

Creating an image using the full `project/image` path can create an unconfigured project with the registry's default visibility. A successful CLI manifest push also records its project if it is not yet configured. To avoid any public exposure, create a private project **before** the first push, or use a private registry default.

## Visibility and roles

- **Public project:** guests can see its public images; individually private images stay hidden.
- **Private project:** guests cannot browse the project or pull any child image, even if an image was previously public. Newly pushed images inherit the project default. The UI/API does not allow a public image to be created in a private project.
- Making a project private does not rewrite image paths or destroy blobs. Making it public again restores each image's own stored visibility; images marked private remain private.
- Counts shown to guests include only their visible images and tags.
- Viewer, maintainer, and admin roles are still **registry-wide**. All active authenticated users can read private projects/images. This does not introduce per-project membership ACLs.
- Maintainers/admins create projects/images, edit settings, and delete images/projects. Only admins manage users and audit access.

Docker permissions are encoded in signed repository-scoped tokens, not inferred from the UI route. Tokens issued before a privacy change can remain valid for up to five minutes; downloaded images cannot be revoked.

## Delete an image or project

Sign in as a maintainer/admin and use the deletion section under **image → Settings** or **project → Project settings**. Type the exact full image path (for example `dockyard/init`) or project name to confirm. Canceling clears the confirmation; failed requests keep the dialog open so you can retry.

- **Delete image** removes every currently tagged manifest and its alias tags, then retires the repository from browsing, counts, detail pages, and automation-key resource dropdowns. Empty reserved images can also be deleted. It leaves the containing project intact.
- **Delete project** removes the tagged manifests of every child image, including reserved images and deeper legacy paths, then retires the project and all its images. Membership uses the exact first path segment: deleting `team` never deletes `team-other/api`, and an unscoped legacy image named `team` is not a member of project `team`.
- The existing tag-card **Delete manifest** remains available. It removes that digest and every tag pointing to it, but does not delete the image repository or project.

**Pause publishers before deleting.** New registry tokens cannot read, push, or delete retired images/projects, including for admins and scoped automation keys. Already-issued JWTs may remain valid for up to five minutes, so an in-flight push can finish after deletion. Delayed push notifications do not revive retired resources. A repeated DELETE can clean up late pushes without making the resource visible again. Already-downloaded images are unaffected.

Distribution retains repository directory names in its catalog, so Dockyard keeps deletion markers and the original visibility/description instead of dropping metadata rows. This prevents deleted resources from reappearing through catalog discovery or private resources falling back to public defaults. These markers are not a content-recovery mechanism. The raw admin-only Distribution catalog can still contain empty/retired names; Dockyard's UI/API filters them.

Deletion removes tagged manifests, not every stored blob or untagged child manifest. Multi-platform indexes, SBOM/provenance children, and previously untagged manifests may leave unreferenced data. Reclaim disk space with Distribution garbage collection during a maintenance window with **all writers stopped**; consult its `--delete-untagged` guidance. Never remove registry data volumes to delete one image or project.

Registry deletion and PostgreSQL cannot commit atomically. If the registry fails or new tags appear mid-operation, some manifests may already be gone, but Dockyard retains the active metadata and its visibility, records an incomplete deletion when possible, and returns an error rather than claiming success. Pause writes and retry. Namespace-level PostgreSQL locks coordinate deletion, creation/settings changes, notifications, and token permission reads across web replicas.

To reuse a deleted name, explicitly create the project again, then explicitly create each required image. Recreating a project does **not** restore its deleted images. New names must still be exactly `project/image`; the API can explicitly recreate a previously recorded, retired legacy path without permitting new nonconforming paths. Stop old publishers and let their JWTs expire before reusing paths; garbage collection is needed to remove leftover untagged content. Automation grants are name-based and can apply again when that same name is deliberately recreated; revoke obsolete keys when decommissioning resources permanently.

### Deletion API

These endpoints require an enabled maintainer/admin browser session, JSON content, and an exact matching `Origin`. Registry keys cannot authorize these management APIs.

```text
DELETE /api/repositories/dockyard/init
{ "confirmName": "dockyard/init" }

DELETE /api/projects/dockyard
{ "confirmName": "dockyard" }
```

The repository endpoint also accepts the existing `{ "digest": "sha256:…" }` shape for a single-manifest deletion. The two forms cannot be combined; an empty or incorrect confirmation never starts bulk deletion. Missing resources return 404, viewers return 403, and anonymous requests return 401. Whole-resource deletion is retryable and records `repository.delete` / `project.delete` audit events; partial removal failures use corresponding `_failed` events.

## Existing images and migration

The migration introduces project records from existing namespaced metadata without renaming repositories or moving registry storage. Projects containing only private images are backfilled as private; mixed/public projects remain public, with each child's existing visibility retained.

- Existing `team/backend/api` remains at the same Docker path. It appears under project `team` with the legacy relative image path `backend/api`, and its detail page remains accessible through `/repositories/team/backend/api`.
- Existing unscoped `alpine` remains unscoped and appears in **Images**. It is not silently moved into a project.
- Existing nonconforming repositories can still be pulled, updated, pushed, or deleted according to their normal role/visibility permissions. Only creation of **new** nonconforming paths is blocked.
- Namespaced images already present in Distribution but not yet recorded in the database are discovered from its catalog. Normal registry authentication remains mandatory.

The migration job must complete before web starts; deletion support adds nullable `deleted_at` fields without changing existing images, projects, users, or keys. Keep the database, registry blobs, and signing-key volumes when upgrading. Project names are immutable in the current UI; renaming registry paths requires a deliberate Docker retag/push workflow rather than a metadata-only rename.

[Documentation index](README.md) · [Authentication and roles](reference.md#access-model)
