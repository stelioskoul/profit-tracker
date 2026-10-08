import "dotenv/config";
import express from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { configureApp } from "./server/_core/app";

const app = express();
configureApp(app);

// Vercel serves public assets through its CDN. Client-side routes need the SPA shell.
const indexHtml = readFileSync(path.join(process.cwd(), "public/index.html"), "utf8");
app.get("*", (_req, res) => {
  res.type("html").send(indexHtml);
});

export default app;
