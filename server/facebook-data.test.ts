import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFacebookAdSpend } from "./facebook-data";

const originalFetch = globalThis.fetch;
afterEach(() => vi.stubGlobal("fetch", originalFetch));
const range = { fromDate: "2026-10-01", toDate: "2026-10-02" };

function response(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("Facebook ad-account currency validation", () => {
  it("uses the retrieved account currency without assuming EUR", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) =>
      input.includes("insights") ? response({ data: [{ spend: "10.25" }] }) : response({ currency: "USD" })));
    await expect(fetchFacebookAdSpend("123", "token", range)).resolves.toEqual({ spend: 10.25, currency: "USD" });
  });

  it("rejects a missing currency rather than silently converting USD spend as EUR", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) =>
      input.includes("insights") ? response({ data: [{ spend: "10" }] }) : response({ error: "denied" }, 403)));
    await expect(fetchFacebookAdSpend("123", "token", range)).rejects.toThrow("Facebook API request failed (HTTP 403)");
  });
});
