# Elasticsearch Template

This template gives you a standalone Elasticsearch environment for local development.

## Quickstart

```bash
devroost init db-elasticsearch --dir my-elasticsearch
cd my-elasticsearch
devroost start
devroost status
```

## Service

- `db`
  - Runtime: `${ELASTICSEARCH_IMAGE:-ghcr.io/devroost-org/elasticsearch-8.19@sha256:4d0724bb8d78d7a2330693623e26ca4d621079d062ecc8a30b3e1fc180ec14c1}`
  - Ports: `9200`, `9300`

## Route

- None

## Image overrides

- `ELASTICSEARCH_IMAGE`
