import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { serveStatic, setupVite } from "./vite";
import { configureApp } from "./app";

async function startServer() {
  const app = express();
  configureApp(app);
  const server = createServer(app);

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
