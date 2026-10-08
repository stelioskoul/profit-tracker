import { cp } from "node:fs/promises";

// public/ is generated and ignored; original assets remain in client/public/.
await cp(new URL("../dist/public/", import.meta.url), new URL("../public/", import.meta.url), { recursive: true });
