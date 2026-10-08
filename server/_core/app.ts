import express, { type Express } from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { validateRuntimeConfiguration } from "../runtime-config";

export function configureApp(app: Express) {
  validateRuntimeConfiguration();
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
}
