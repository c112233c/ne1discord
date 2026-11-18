# ne1discord-be Helm Chart

This chart is deployed by the Argo CD Application manifest
`ne1discord-gitops/argocd/ne1discord-be.yaml`, which points to
`ne1discord-gitops/be`.

## Image

GitHub Actions builds `ne1discord-be/` and publishes:

- `ghcr.io/<github-owner>/ne1discord-be:sha-<commit-sha>`
- `ghcr.io/<github-owner>/ne1discord-be:latest`

The workflow writes the immutable `sha-<commit-sha>` tag into this chart's `values.yaml`.
The initial `pending` tag is only a bootstrap placeholder; do not sync it before the first
successful image build.

If the GHCR package is private, create a Kubernetes image pull Secret in namespace `boat`
and configure `image.pullSecrets` in values.yaml. Alternatively, make the package readable
by the cluster without credentials.

## Runtime secrets

External Secrets Operator reads Vault key `apps/ne1discord-be-30096` using
`ClusterSecretStore/vault-backend` and creates Secret `ne1discord-be-30096-secret`.

The Vault KV entry must contain every required variable in `ne1discord-be/.env.example`,
including the DB, session, Keycloak and Discord OAuth/Bot settings. Confirm that
`vault-backend` is a ClusterSecretStore; change `secretStoreRef.kind` if it is a namespaced
SecretStore. Confirm the Vault mount/key convention with the installed ESO provider.

## Networking and database

The Service remains NodePort 30096 and forwards to container port 3000.
The app expects HTTPS public URLs for Keycloak in production. Configure the public URL,
Keycloak redirect URI, and Discord redirect URI to match the actual ingress/proxy endpoint.
Database migrations in `ne1discord-be/migrations` must be applied before the app is marked ready.

## Phase 4 safety hold

Nightly restriction is not included in this chart and must remain disabled until the
post-deployment Phase 4 test is explicitly approved.
