# Documentation

Start with the deployment topology that matches your infrastructure. All commands in these guides are run from the **repository root** unless stated otherwise. Preserve an existing `.env`; do not regenerate secrets when changing proxy topology.

## Deployment guides

| Guide                                             | Traffic path                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [Build setup](deployment/build.md)                | Browser / Docker → Dockyard ingress → web or registry                              |
| [Two-proxy setup](deployment/two-proxies.md)      | Browser / Docker → your HTTPS edge proxy → Dockyard HTTP ingress → web or registry |
| [Your own proxy only](deployment/custom-proxy.md) | Browser / Docker → your proxy → web or registry; no Dockyard ingress               |

In every topology, the public hostname is shared by the UI, `/api/registry/token`, and `/v2/*`. Authentication is not delegated to an arbitrary proxy login page: Next.js checks credentials/roles and signs scoped tokens; Distribution validates those tokens on registry operations.

## Reference

Read [CI/CD and releases](releases.md) for GitHub Actions setup, registry secrets, conventional commits, multi-architecture image tags, and release recovery.

Read [Automation keys](automation-keys.md) for project/image-scoped CI credentials, Docker login, expiry, revocation, and workflow examples.

Read [Projects and images](projects.md) for the `project/image` naming policy, project visibility, confirmed image/project deletion, and legacy repository compatibility.

Read [URL, TLS, and port configuration](configuration.md) for the logic behind `APP_URL`, `INGRESS_PUBLIC_URL`, upstream URLs, network bindings, and redirect-loop diagnosis.

See [the reference guide](reference.md) for:

- [Compose modes](reference.md#compose-modes) and [startup jobs](reference.md#images-and-startup-jobs).
- [Ingress environment variables](reference.md#environment-configured-ingress-image).
- [Access control and authentication](reference.md#access-model).
- [Persistence, backups, garbage collection, and signing-key maintenance](reference.md#persistence-and-maintenance).
- [Local development](reference.md#local-development) and [quality checks](reference.md#quality-checks).
- [Architecture](reference.md#architecture).

[Back to the project README](../README.md)
