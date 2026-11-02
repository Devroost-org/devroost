import { defineStack } from "../definition.js";
import { generatorPins, runtimeImagePins } from "../pins.js";

export const rails7HotwireStack = defineStack({
  id: "rails7-hotwire", definitionVersion: 2, legacyScaffoldVersions: ["2", "rails-7.1.5-hotwire"], assetPath: "rails7-hotwire/templates", scaffoldVersion: "2",
  generator: {
    kind: "command", image: runtimeImagePins.ruby3312, package: "rails", version: generatorPins.rails,
    command: ["sh", "-c", `gem install bundler -v ${generatorPins.bundler} --no-document && gem install {package} -v {version} --no-document && /usr/local/bundle/bin/rails _{version}_ new . --skip-test --skip-system-test`],
    execution: {
      kind: "container", context: "Rails 7 + Hotwire project with Podman", mountTarget: "/workspace", workdir: "/workspace", environment: []
    }
  },
  runtimeImages: [{ env: "RUBY_IMAGE", reference: runtimeImagePins.ruby3312 }], install: ["bundle install"],
  start: ["bin/rails server -b 0.0.0.0 -p 3008"], readiness: { kind: "port", value: "127.0.0.1:3008", timeoutSeconds: 610 },
  hostWrites: ["log", "tmp", "vendor/bundle"], verification: [{ service: "app", command: ["ruby", "-rsocket", "-e", "TCPSocket.new('127.0.0.1', 3008).close"] }],
  devroostOwnedFiles: [".env.example", "devroost.yaml"], generatedPaths: [{ path: "log", category: "cache" }, { path: "tmp", category: "cache" }, { path: "vendor/bundle", category: "dependency" }],
  protectedPaths: ["app", "config", "db", "lib"], compatibility: { architectures: ["arm", "arm64", "x64"], runtime: "podman-rootless" }
});
