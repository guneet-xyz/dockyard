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
- Maintainers/admins create projects/images and edit settings. Only admins manage users and audit access.

Docker permissions are encoded in signed repository-scoped tokens, not inferred from the UI route. Tokens issued before a privacy change can remain valid for up to five minutes; downloaded images cannot be revoked.

## Existing images and migration

The migration introduces project records from existing namespaced metadata without renaming repositories or moving registry storage. Projects containing only private images are backfilled as private; mixed/public projects remain public, with each child's existing visibility retained.

- Existing `team/backend/api` remains at the same Docker path. It appears under project `team` with the legacy relative image path `backend/api`, and its detail page remains accessible through `/repositories/team/backend/api`.
- Existing unscoped `alpine` remains unscoped and appears in **Images**. It is not silently moved into a project.
- Existing nonconforming repositories can still be pulled, updated, pushed, or deleted according to their normal role/visibility permissions. Only creation of **new** nonconforming paths is blocked.
- Namespaced images already present in Distribution but not yet recorded in the database are discovered from its catalog. Normal registry authentication remains mandatory.

The migration job must complete before web starts. Keep the database, registry blobs, and signing-key volumes when upgrading. Project names are immutable in the current UI; renaming registry paths requires a deliberate Docker retag/push workflow rather than a metadata-only rename.

[Documentation index](README.md) · [Authentication and roles](reference.md#access-model)
