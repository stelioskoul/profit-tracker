import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import indexHtml from "./public/index.html";
import { users } from "./drizzle/schema";
import { getDb } from "./server/db";
import { registerOAuthRoutes } from "./server/_core/oauth";
import { createContext } from "./server/_core/context";
import { appRouter } from "./server/routers";
import { validateRuntimeConfiguration } from "./server/runtime-config";

// Vercel owns the HTTP listener and serves files in public/ from its CDN.
// Never import server/_core/index here: its standalone listener is for Manus Preview.
validateRuntimeConfiguration();
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.get("/health", async (_req, res) => {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not configured");
    await database.select({ id: users.id }).from(users).limit(1);
    res.status(200).json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

registerOAuthRoutes(app);
app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

// React client routes need index.html, but missing API and asset paths must remain 404s.
app.use((req, res) => {
  if (!["GET", "HEAD"].includes(req.method) ||
      req.path === "/api" || req.path.startsWith("/api/") ||
      req.path === "/assets" || req.path.startsWith("/assets/") ||
      /\.[^/]+$/.test(req.path)) {
    return res.status(404).end();
  }
  res.setHeader("Cache-Control", "no-store");
  return res.type("html").send(indexHtml);
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Beprofit request failed:", error instanceof Error ? error.message : "unknown error");
  if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
});

export default app;
