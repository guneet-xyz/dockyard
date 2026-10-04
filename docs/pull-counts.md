# Image and tag pull counts

Dockyard shows **Pulls** for every image in the image list/grid and project image tables, plus a total on the image detail page and a separate count on every tag card. **Most pulls** sorts the image browser by its total. Counters refresh with registry metadata (once per minute while the page is active); reload to see a newly delivered event sooner.

## What a pull means

A counted pull is one authenticated registry notification for an **external GET of a manifest by tag**. Anonymous public pulls, user-account pulls, and scoped-key pulls use the same definition. The registry's notification `target.tag` identifies the requested tag.

This is an observed fetch metric, **not a verified completed Docker/OCI download**, unique-user count, or billing-grade analytics:

- A client may fetch a tag more than once for one workflow; those are separate observed events. Notifications do not report whether every layer was downloaded successfully.
- **HEAD checks do not count.** Docker, Buildx, and deployment tools can probe manifests while checking versions or pushing images.
- **Blob/config/layer transfers do not count.** Cached images do not need to download every blob anyway.
- **Digest-only manifest requests do not count**, including the platform-specific child manifests fetched after a multi-platform index. A typical tagged multi-platform pull therefore counts its tagged index lookup once, rather than adding every child. Workflows pinned only to `@sha256:…` are not included in this metric.
- Dockyard marks its internal registry requests with `User-Agent: Dockyard/internal`. Browsing the UI, inspecting image sizes/platforms, and deletion planning do not count as client pulls.
- Only the four supported OCI/Docker manifest/index media types are eligible. Missing method/tag/digest data and invalid names are ignored rather than guessed.

Two tags that share a digest have independent counts: pulling `latest` does not increment `0.1.0`, and vice versa. A tag's count belongs to its **name**, so republishing that tag with different content keeps its history. Image totals include all counted tag names, even tags that were later removed; the total can exceed the sum of currently visible tag cards.

## Collection and upgrade

The migration job creates `image_tag_pulls` for counters and `registry_pull_events` for notification receipts, plus nullable reset timestamps on images/projects. Existing images, projects, credentials, and deletion markers remain unchanged. Existing counters start at **zero**: historical pulls were not recorded and cannot be reconstructed from Distribution's catalog.

The base Compose configuration now enables pull notifications to the existing internal `/api/registry/events` endpoint, authenticated with `REGISTRY_WEBHOOK_SECRET`. Common octet-stream blob notifications are filtered by Distribution, and the receiver filters remaining non-countable events. **No new secret, public endpoint, external analytics service, or proxy authorization substitution is required.**

Deploy the matching web/migration changes and **recreate the registry container** to apply the new notification environment; restarting an existing container does not change its environment. For a source deployment:

```sh
docker compose --env-file .env \
  -f deploy/compose.yaml -f deploy/compose.build.yaml \
  up --build --wait --wait-timeout 240
```

For prebuilt deployments, use a version containing this feature, run the normal pull/upgrade procedure, and let the migration job finish before web starts. Keep existing secrets and volumes.

If using a separately managed Distribution service, keep the existing Dockyard notification endpoint and authentication header but remove any `ignore.actions: [pull]` setting. The registry must send the request method/user agent and manifest tag/digest information supported by the bundled Distribution version. Internal Dockyard requests must reach Distribution without a proxy replacing their user-agent marker.

## Reliability and privacy

Counter increments use an atomic PostgreSQL upsert. A registry event ID is recorded in the **same transaction** as its counter update, so retrying the same event (including concurrent deliveries or duplicate IDs within a batch) increments only once. A failed transaction can be safely retried.

Notifications are asynchronous and retried by Distribution, so displayed counts may lag behind requests. Distribution's queue is in memory; events can be lost during registry restarts or prolonged outages. There is no backfill for missed events. Do not interpret these counters as an exact number of completed downloads.

Receipts store only the event UUID and receipt time; counters store the image path, tag, and aggregate number. Client IPs, user agents, account identities, credentials, and bearer tokens are not retained for pull analytics. Receipt IDs are retained for deduplication; pull events do not flood the activity audit log.

Counts follow the existing visibility rules. Guest users cannot discover private image/project counts. Deleted images/projects remain hidden, and late pulls while a resource is retired do not update or revive it. Explicitly recreating an image clears its old tag counters; reset timestamps reject delayed pre-recreation events, and old event IDs remain deduplicated. Coordinate clocks across registry/web nodes when operating multiple machines.

[Documentation index](README.md) · [Projects, privacy, and deletion](projects.md) · [Deployment reference](reference.md)
