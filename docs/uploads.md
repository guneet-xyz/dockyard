# Browser image uploads and descriptions

Maintainers/admins can upload saved container images from the browser. Guests and viewers can browse allowed images, but cannot upload or edit descriptions. Automation keys remain registry-only credentials; these web management routes require a normal browser session.

## Upload an image

1. Create/select a project, then use **New image** to reserve the `project/image` path and its visibility. Existing legacy repositories can also receive uploads; this feature does not create new nonconforming paths or revive deleted resources implicitly.
2. Open the image detail page and choose **Upload image**.
3. Select a Docker-save or OCI-layout archive (`.tar`, `.tar.gz`, or `.tgz`). Enter the **destination tag**; `latest` is the default.
4. If replacing a tag, explicitly select **Replace existing tag**. Dockyard checks its current digest before transfer and again before the final tag publication. A stale digest causes a conflict instead of silently overwriting a version you did not inspect.
5. Choose **Upload archive**. The progress bar measures transfer to Dockyard; once transfer reaches 100%, the server still validates and publishes the image. Wait for the success message before pulling it.

The archive's original repository/tag names are ignored: only the image path and tag selected in Dockyard are published. Uploading does not change the image's existing description or visibility. Private project visibility remains a ceiling for every child image.

### Docker-save archives

Export **one image**, not a container filesystem:

```sh
docker image save --output image.tar your-local-image:tag
# Optional compression of the outer archive:
gzip -c image.tar > image.tar.gz
```

Classic Docker-save exports contain `manifest.json`, image configuration, and uncompressed `layer.tar` files. Dockyard validates layer hashes against the configuration's `rootfs.diff_ids` and publishes the content as an OCI image using uncompressed layer media types. A modern Docker-save export that contains an OCI layout uses the OCI importer instead.

Do not use `docker export`; it omits image configuration/history. Archives containing multiple unrelated Docker images are rejected. Export the desired image separately.

### OCI archives and multi-platform images

For example, export a Buildx build as an OCI archive:

```sh
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --output type=oci,dest=image.tar .
```

OCI archives contain `oci-layout`, `index.json`, and `blobs/sha256/…`. Dockyard verifies referenced content digests and sizes, publishes child manifests by digest, and publishes the root manifest/index under the selected tag last. Multi-platform indexes and included supporting manifests are preserved. All referenced content must be in the archive; remote/foreign blob URLs are not fetched. Multiple unrelated OCI references, unsupported manifest types, and artifact-only archives without a container image configuration are rejected.

Dockerfiles, source-code ZIPs, photos, arbitrary TARs, and filesystem exports are not container-image archives. Dockyard does **not** run Docker builds, execute image commands, or extract the contents of layer TAR files on the server.

## Permissions, safety, and partial failures

- Upload preflight and transfer require an enabled maintainer/admin session; POST also requires an exact matching `Origin`. Permissions are rechecked after receiving the archive and immediately before registry writes. The destination must already exist or be reserved and must not be deleted.
- Registry writes use a short-lived server-held JWT with **only pull + push on the selected image**, attributed to the signed-in user. No privileged service token or registry password is exposed to the browser, and proxies do not substitute client authorization.
- Only the outer archive is unpacked into a private temporary directory. Absolute/traversal paths, duplicate paths, symlinks, hardlinks, devices, and other special outer entries are rejected. Files are created with private permissions; archived ownership/mode attributes are not applied.
- Default limits are **1 GiB transfer**, **4 GiB expanded outer archive**, **10,000 outer entries**, bounded manifest JSON/graph sizes, and **two simultaneous uploads per web instance**. Temporary files are removed after success, failure, or cancellation when the process remains running. Temporary data is not a resumable upload store; a crash may leave files for normal temporary-directory maintenance.
- Publishing coordinates with Dockyard deletion/settings changes through namespace locks. Already-issued CLI tokens can still write during their lifetime, and Distribution has no atomic compare-and-swap for tags. Pause competing publishers when replacing a tag.
- Registry and PostgreSQL cannot commit atomically. Blobs/untagged child manifests may already be stored when a later step fails. A lost response or cancellation during the final manifest PUT may have published the tag. **Inspect the destination tags before retrying.** Unreferenced data can be reclaimed by registry garbage collection with all writers stopped; do not delete storage volumes.

Uploads are audited as `image.upload` with the destination tag/digest, archive format, platforms, and replaced digest. Registry push notifications also retain their usual audit behavior.

## Deployment limits

The feature is intended for the self-hosted Node.js/Docker deployment. Hosts or proxies with small request-body limits, execution limits, or short timeouts can reject a large archive even if Dockyard allows it. Configure the external proxy and available web-container temporary disk appropriately. With both default limits and two simultaneous uploads, allow roughly **10 GiB** of temporary disk headroom plus normal application storage.

In `.env`, these optional non-secret settings are passed to web by Compose:

```dotenv
IMAGE_UPLOAD_MAX_BYTES=1073741824
IMAGE_UPLOAD_MAX_EXPANDED_BYTES=4294967296
```

Values must be positive safe integers. Recreate web to apply changed environment values; merely restarting a container does not replace its environment. Increase limits deliberately and account for compressed archives expanding on disk. File-based browser uploads are not resumable; keep using Docker CLI pushes for large pipelines or unattended publishing.

## Image and project descriptions

Descriptions are available in **New project**, **New image**, and their existing settings pages. Detail pages also expose **Add description / Edit description** directly to maintainers/admins.

- Descriptions support **up to 5,000 characters** of plain text, including multiple lines. Leading/trailing whitespace is trimmed; internal line breaks are preserved on detail pages.
- A description-only update does not change visibility. For example, describing a public child beneath a private project does not silently change that child's stored visibility.
- Empty text clears a description. HTML is displayed as escaped text, not rendered; Markdown is not interpreted.
- Existing descriptions remain stored unchanged by this feature; no database migration is needed for description length or browser-upload staging.

The settings API accepts description-only or visibility-only updates (or both) through the existing session-authenticated PATCH routes. An empty update and unknown fields are rejected.

[Documentation index](README.md) · [Projects, images, and deletion](projects.md) · [Deployment reference](reference.md)
