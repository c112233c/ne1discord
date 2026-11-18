# ne1discord

Monorepo for the ne1discord application and its Kubernetes GitOps configuration.

## Repository layout

- `.github/workflows/build-push.yml` — backend CI, GHCR image build/publish, and GitOps image-tag update
- `ne1discord-be/` — Node.js backend, migrations, tests, and Dockerfile
- `ne1discord-gitops/fe/` — reserved location for the frontend Helm chart
- `ne1discord-gitops/be/` — backend Helm chart consumed by Argo CD
- `ne1discord-gitops/argocd/` — one Argo CD Application manifest per deployable component

## Standard layout for projects

Use the same pattern for every project, whether it currently has one component or both:

```text
<project>/
├── .github/workflows/
│   ├── build-fe.yml
│   └── build-be.yml
├── <project>-fe/
├── <project>-be/
└── <project>-gitops/
    ├── argocd/
    │   ├── <project>-fe.yaml
    │   └── <project>-be.yaml
    ├── fe/
    └── be/
```

Only create the FE directories, workflow, Helm chart, and Argo CD Application when the frontend is implemented. The reserved GitOps directory documents the intended location without creating an invalid Application.

## CI/CD flow

1. A push to `main` that changes `ne1discord-be/**` runs syntax checks, unit tests, and npm audit.
2. On success, GitHub Actions builds `ne1discord-be/Dockerfile` using `ne1discord-be/` as its build context.
3. The image is pushed to `ghcr.io/<github-owner>/ne1discord-be` with an immutable `sha-<commit>` tag and a `latest` tag.
4. The workflow updates `ne1discord-gitops/be/values.yaml` with the image repository and immutable tag, then commits that change to `main`.
5. Argo CD detects the Git change and syncs the backend Helm chart at `ne1discord-gitops/be`.

The workflow is scoped to backend and workflow changes. Its GitOps commit does not trigger another image build.

## Initial setup

1. Create one GitHub repository named `ne1discord`.
2. Push this directory's contents to the repository's `main` branch.
3. In GitHub, allow Actions to use a `GITHUB_TOKEN` with read/write repository contents and package write permissions. A branch-protection rule must permit the workflow bot to push the GitOps tag update, or that rule must be adjusted.
4. After the first successful workflow run, confirm the GHCR package `ne1discord-be` exists.
5. If the GHCR package is private, create an imagePullSecret in Kubernetes namespace `boat` and configure `image.pullSecrets` in `ne1discord-gitops/be/values.yaml`.
6. Replace the GitHub owner placeholder in `ne1discord-gitops/argocd/ne1discord-be.yaml`, then apply that Application manifest or create the equivalent Argo CD Application in the UI.

Do not sync the Helm chart while `image.tag` is still `pending`; wait for the first successful image publication and tag update.

## Production prerequisites

- Configure Vault key `apps/ne1discord-be-30096` with every required key in `ne1discord-be/.env.example`.
- Confirm `vault-backend` is a `ClusterSecretStore`; adjust the ExternalSecret kind if it is a namespaced `SecretStore`.
- Apply database migrations before the application rollout.
- Configure public HTTPS URL and exact Keycloak/Discord callback URLs.
- Confirm NodePort 30096 is available, or change the Helm values before deployment.

## Phase 4 hold

Nightly restriction is intentionally not included in the Helm chart. Keep Phase 4 deferred until the backend has been deployed and the separate controlled test is explicitly approved.
