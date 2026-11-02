const features = [
  {
    id: "http-api",
    title: "HTTP API routes",
    summary: "Local function endpoints served by a small FaaS-style router with stable URLs."
  },
  {
    id: "spa-frontend",
    title: "Static frontend",
    summary: "A static SPA consumes the backend functions through the same local host."
  },
  {
    id: "local-invoke",
    title: "Local function invoke",
    summary: "Scripts for invoking handlers directly during development and CI smoke checks."
  },
  {
    id: "webhooks",
    title: "Webhook-ready",
    summary: "An example POST endpoint for content ingestion, automations, or event fan-in."
  }
];

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify(payload)
  };
}

module.exports.health = async () =>
  json(200, {
    stack: process.env.LOOM_STACK ?? "serverless",
    status: "ok",
    runtime: "nodejs22.x",
    local: true,
    updatedFor: process.env.LOOM_UPDATED_FOR ?? "2026"
  });

module.exports.feed = async () =>
  json(200, {
    title: "Devroost FaaS + SPA template",
    subtitle: "A 2026 local workflow for function endpoints, webhook ingestion, and static frontend delivery.",
    endpoints: ["GET /api/health", "GET /api/feed", "POST /api/webhooks/content"],
    features,
    updatedFor: process.env.LOOM_UPDATED_FOR ?? "2026"
  });

module.exports.ingest = async (event) => {
  const body = event?.body ? JSON.parse(event.body) : {};

  return json(202, {
    accepted: true,
    requestId: event?.requestContext?.requestId ?? null,
    receivedType: body.type ?? "content.updated",
    receivedKeys: Object.keys(body)
  });
};
