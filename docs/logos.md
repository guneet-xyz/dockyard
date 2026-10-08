# Photos, logos, and descriptions

Projects and container-image repositories can have a **photo/logo**. This is a visual picture for the UI, not an upload of container layers or a Docker archive. Continue using Docker/OCI clients to publish container content.

## Upload, replace, or remove a picture

1. Sign in as a maintainer/admin and open the project or repository detail page.
2. Choose **Upload photo/logo**, or **Change photo/logo** when one is already present.
3. Select a static **PNG, JPEG, or WebP** file up to **5 MiB**. The dialog shows a preview.
4. Choose **Save photo/logo**. The saved picture appears in the detail header and in project cards, repository tables, dashboard lists, and repository grids.
5. Use **Change photo/logo → Remove logo** to return to the default folder/box icon.

Pictures preserve their aspect ratio and transparency, are auto-oriented, resized to fit inside **512 × 512**, stripped of metadata, and re-encoded as WebP. Small pictures are not enlarged. The server verifies actual file contents, not the filename or claimed content type. SVG, GIF/animation, archives, corrupt data, and images over **16 megapixels** are rejected.

The upload changes only the picture: descriptions, visibility, container tags, manifests, pull counters, and automation-key grants are unchanged. Logo edits/removals are recorded in the activity audit log.

## Persistence and privacy

The bounded, normalized pictures are stored in PostgreSQL's `resource_logos` table, separately from resource metadata. The migration creates this table without changing existing projects, repositories, user accounts, keys, or descriptions. Existing resources retain their default icons until a picture is uploaded.

Pictures survive container recreation and work across web replicas using the shared database. **No additional volume or external storage service is required.** Include PostgreSQL in your normal backups.

The logo-serving API checks current resource visibility on every request. Guests can view logos on public resources, while private project ceilings also protect child repository pictures. Private, removed, or deleted resource logos return 404 to unauthorized requests. Responses use `private, no-store`, `image/webp`, and `nosniff`; the UI loads them directly with browser cookies instead of routing authenticated pictures through an image optimizer or public static directory.

Deleting a repository/project removes its stored picture in the same database transaction that retires its metadata. Recreating a resource does not resurrect its old logo. Previously downloaded/captured pictures cannot be revoked.

Logo upload/removal requires an enabled maintainer/admin browser session and the same-origin write protections as other management routes. Registry automation keys do not grant picture-management privileges. There is no remote URL import and no server-side fetching of external pictures.

## Descriptions

Descriptions remain available in **New project**, **New image**, and their settings pages. Detail pages also expose **Add description / Edit description**.

- Up to **5,000 characters** of multiline plain text.
- Leading/trailing whitespace is trimmed; internal line breaks are preserved on detail pages.
- Empty text clears a description. HTML is escaped, and Markdown is not interpreted.
- Description-only edits do **not** change visibility, including a public child underneath a private project's ceiling.
- Existing descriptions are preserved; their length improvement needs no schema change.

The earlier container-archive upload feature was based on a misunderstanding and has been removed. Its endpoint, archive parser, UI, temporary-file limits, and archive-only dependencies are not part of this feature.

[Documentation index](README.md) · [Projects, privacy, and deletion](projects.md) · [Deployment reference](reference.md)
