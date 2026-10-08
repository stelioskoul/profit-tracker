import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { validateRuntimeConfiguration } from "../runtime-config";

async function startServer() {
  validateRuntimeConfiguration();
  const app = express();
  const server = createServer(app);
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

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid PORT");
  server.listen(port, "0.0.0.0", () => {
    console.log(`Beprofit ready on port ${port}`);
  });
}

startServer().catch(error => {
  console.error("Unable to start Beprofit server:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
