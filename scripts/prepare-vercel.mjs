import { cp, rm } from "node:fs/promises";

await rm(new URL("../public/", import.meta.url), { recursive: true, force: true });
await cp(new URL("../dist/public/", import.meta.url), new URL("../public/", import.meta.url), {
  recursive: true,
});
