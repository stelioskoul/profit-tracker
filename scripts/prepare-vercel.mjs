import { cp } from "node:fs/promises";
import { build } from "esbuild";

// public/ is generated and ignored; original assets remain in client/public/.
await cp(new URL("../dist/public/", import.meta.url), new URL("../public/", import.meta.url), { recursive: true });
await build({
  entryPoints: [new URL("../vercel/server.ts", import.meta.url).pathname],
  outfile: new URL("../dist/vercel-api.cjs", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  format: "cjs",
  footer: { js: "module.exports = module.exports.default;" },
  target: "node22",
  packages: "bundle",
  external: ["express"],
  loader: { ".html": "text" },
  logLevel: "warning",
});
