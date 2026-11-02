const port = Number(process.env.PORT ?? 3004);

const features = [
  {
    title: "Bun runtime",
    detail: "Fast local TypeScript execution with Bun.serve()."
  },
  {
    title: "Built-in routing",
    detail: "One service handles HTML, JSON, and static responses."
  },
  {
    title: "Template-ready",
    detail: "A stronger starting point than a plain hello-world stub."
  }
];

function renderPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Devroost Bun Template</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        font-family: "Avenir Next", "Segoe UI", sans-serif;
        color: #1f1d1a;
        background: linear-gradient(180deg, #fff8ef 0%, #efe6d8 100%);
      }
      main {
        width: min(980px, calc(100% - 32px));
        margin: 0 auto;
        padding: 40px 0 64px;
      }
      .hero, .card {
        background: rgba(255,255,255,0.82);
        border: 1px solid rgba(31,29,26,0.1);
        border-radius: 24px;
        box-shadow: 0 18px 48px rgba(31,29,26,0.08);
      }
      .hero { padding: 28px; }
      .eyebrow { text-transform: uppercase; letter-spacing: .14em; font-size: .76rem; color: #756d62; }
      h1 { margin: 0; font-size: clamp(2.4rem, 6vw, 4.8rem); line-height: .96; }
      .lede { max-width: 54ch; color: #5f584f; }
      .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 20px; }
      .card { padding: 20px; }
      @media (max-width: 820px) { .grid { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <p class="eyebrow">Bun + Devroost</p>
        <h1>Bun template, updated for real use.</h1>
        <p class="lede">This example uses Bun's built-in HTTP server and serves both HTML and JSON from one fast runtime.</p>
      </section>
      <section class="grid">
        ${features.map((feature) => `<article class="card"><h2>${feature.title}</h2><p>${feature.detail}</p></article>`).join("")}
      </section>
    </main>
  </body>
</html>`;
}

const server = Bun.serve({
  port,
  routes: {
    "/health": () => Response.json({ runtime: "bun", status: "ok" }),
    "/api/features": () => Response.json({ features })
  },
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      return new Response(renderPage(), {
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }

    return new Response("Not Found", { status: 404 });
  }
});

console.log(`Bun app listening on http://0.0.0.0:${server.port}`);
