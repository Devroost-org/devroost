import express from "express";

const app = express();

const features = [
  {
    slug: "javascript",
    title: "JavaScript",
    summary: "Small client-side behavior layered onto a mostly static page."
  },
  {
    slug: "apis",
    title: "APIs",
    summary: "Content and dynamic data fetched from a separate service boundary."
  },
  {
    slug: "markup",
    title: "Markup",
    summary: "Fast page delivery centered on HTML, content, and predictable rendering."
  }
];

app.get("/health", (_req, res) => {
  res.json({ stack: "JAMstack", status: "ok" });
});

app.get("/api/content", (_req, res) => {
  res.json({
    title: "Devroost JAMstack template",
    subtitle: "JavaScript, APIs, Markup for a modern static-first workflow.",
    updatedFor: "2026",
    features
  });
});

app.listen(3006, () => {
  process.stdout.write("JAMstack API listening on 3006\n");
});