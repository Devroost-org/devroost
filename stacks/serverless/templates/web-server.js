const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const publicDir = path.join(__dirname, "web");
const apiOrigin = process.env.API_ORIGIN ?? "http://127.0.0.1:3007";

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

  return "text/html; charset=utf-8";
}

function proxyRequest(request, response) {
  const upstreamPath = request.url.replace(/^\/api/, "") || "/";
  let upstream;
  try {
    upstream = new URL(upstreamPath, apiOrigin);
    if (upstream.origin !== new URL(apiOrigin).origin) {
      throw new Error("Invalid proxy destination");
    }
  } catch {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("Invalid API path");
    return;
  }
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

function serveFile(response, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, { "content-type": contentType(filePath), "cache-control": "no-store" });
    response.end(data);
  });
}

http
  .createServer((request, response) => {
    if (request.url.startsWith("/api/")) {
      proxyRequest(request, response);
      return;
    }

    const urlPath = request.url === "/" ? "/index.html" : request.url;
    const normalizedPath = path.normalize(urlPath).replace(/^\.(\.\/|\\)+/, "");
    const filePath = path.join(publicDir, normalizedPath);
    serveFile(response, filePath);
  })
  .listen(3008, "0.0.0.0", () => {
    process.stdout.write("Static serverless frontend listening on 3008\n");
  });