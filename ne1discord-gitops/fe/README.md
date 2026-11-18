# Frontend GitOps

This directory is reserved for the ne1discord frontend Helm chart.

When a frontend is added, place its Helm chart here:

- `Chart.yaml`
- `values.yaml`
- `templates/deployment.yaml`
- `templates/service.yaml`
- `templates/externalsecret.yaml` (only if the frontend requires runtime secrets)

Then add a separate Argo CD Application manifest at
`ne1discord-gitops/argocd/ne1discord-fe.yaml`, with source path
`ne1discord-gitops/fe`.

No placeholder chart or Argo CD Application is created yet, so Argo CD will not try to
deploy a frontend that does not exist.
