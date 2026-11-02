# Spring Boot Template

This template gives you a Spring Boot application running on Java 21 (Eclipse Temurin), served from local project files.

## Quickstart

```bash
devroost init spring-boot --dir my-app
cd my-app
devroost start
devroost status
```

## Services

- `app`
  - Runtime: `${JAVA_IMAGE:-ghcr.io/devroost-org/devroost-java-21@sha256:dd2c87a716b9f86d94cacc5db4b7b44ec3ba864f33ca3d6823461f84522dbe7e}`
  - Port: `8080`
  - Purpose: Spring Boot application server with Maven wrapper

## Route

- App: `https://spring-boot.devroost.local`

## Image overrides

- `JAVA_IMAGE`

## Healthcheck

The container healthcheck hits `/api/health`. The template includes `spring-boot-starter-actuator` so you can opt into full Actuator endpoints by configuring `application.properties`.

## File permissions

The container runs with `userns: keep-id` and `execUser` set to the host UID:GID so `mvn spring-boot:run` writes generated files (`.m2` cache, build output) with host-aligned ownership on Linux rootless Podman.
