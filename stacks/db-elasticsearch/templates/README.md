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
  - Runtime: `${ELASTICSEARCH_IMAGE:-ghcr.io/devroost-org/elasticsearch-8.19@sha256:e4797708584bd0df7c746b33a6640d243018a0ae8c8b088391c6f4675a3bef52}`
  - Ports: `9200`, `9300`

## Route

- None

## Image overrides

- `ELASTICSEARCH_IMAGE`
