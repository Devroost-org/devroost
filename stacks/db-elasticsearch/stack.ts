import { defineStack } from "../definition.js";
import { runtimeImagePins } from "../pins.js";

export const dbElasticsearchStack = defineStack({
  id: "db-elasticsearch", definitionVersion: 2, legacyScaffoldVersions: ["1", "2"], assetPath: "db-elasticsearch/templates", scaffoldVersion: "2",
  generator: { kind: "none" }, runtimeImages: [{ env: "ELASTICSEARCH_IMAGE", reference: runtimeImagePins.elasticsearch819 }],
  install: [], start: [], readiness: { kind: "http", value: "http://127.0.0.1:9200/_cluster/health", timeoutSeconds: 300 },
  hostWrites: [], verification: [{ service: "db", command: ["curl", "--fail", "http://127.0.0.1:9200/_cluster/health"] }],
  devroostOwnedFiles: [".env.example", "devroost.yaml"], generatedPaths: [], protectedPaths: [],
  compatibility: { architectures: ["arm64", "x64"], runtime: "podman-rootless" }
});
