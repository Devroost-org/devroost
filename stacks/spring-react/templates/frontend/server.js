import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, "dist");
const apiOrigin = process.env.API_ORIGIN ?? "http://backend:8080";

function contentType(filePath) {
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }

  if (filePath.endsWith(".js")) {
    return "application/javascript; charset=utf-8";
  }

  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }

  if (filePath.endsWith(".svg")) {
    return "image/svg+xml";
  }

  return "text/html; charset=utf-8";
}

async function sendFile(response, requestPath) {
  try {
    const urlPath = decodeURIComponent(requestPath.split("?")[0]);
    const root = await fs.promises.realpath(distDir);
    const candidate = path.resolve(root, `.${urlPath === "/" ? "/index.html" : urlPath}`);
    const relative = path.relative(root, candidate);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("Path outside public directory");
    }
    const filePath = await fs.promises.realpath(candidate);
    const realRelative = path.relative(root, filePath);
    if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
      throw new Error("Symlink outside public directory");
    }
    const data = await fs.promises.readFile(filePath);
    response.writeHead(200, {
      "content-type": contentType(filePath),
      "cache-control": "no-store"
    });
    response.end(data);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

function proxyRequest(request, response) {
  const upstream = new URL(request.url, apiOrigin);
  const proxy = http.request(
    upstream,
    {
      method: request.method,
      headers: request.headers
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    }
  );

  proxy.on("error", (error) => {
    response.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ status: "bad_gateway", message: error.message }));
  });

  request.pipe(proxy);
}

http
  .createServer((request, response) => {
    if (request.url.startsWith("/api/")) {
      proxyRequest(request, response);
      return;
    }

    void sendFile(response, request.url);
  })
  .listen(5175, "0.0.0.0", () => {
    process.stdout.write("Spring React frontend listening on 5175\n");
  });