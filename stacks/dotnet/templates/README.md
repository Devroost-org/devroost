# .NET Template

This template gives you a small .NET application served from local project files.

## Quickstart

```bash
devroost init dotnet --dir my-dotnet
cd my-dotnet
devroost start
devroost status
```

## Services

- `app`
  - Runtime: `${DOTNET_IMAGE:-ghcr.io/devroost-org/devroost-dotnet-8@sha256:974fbadc459e0978702bf720e6a0ab184e61fe0ad9329e82c36e48fc4c7a8f42}`
  - Port: `5000`
  - Purpose: .NET development server

## Route

- App: `https://dotnet.devroost.local`

## Image overrides

- `DOTNET_IMAGE`

## File permissions

This template keeps the simpler `userns: keep-id` startup model because `dotnet restore` and `dotnet run` do not require privileged package installation during startup, but `devroost exec` and task runs now use a host-aligned UID:GID by default through `execUser`.
