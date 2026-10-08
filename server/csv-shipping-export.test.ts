import { afterEach, expect, it, vi } from "vitest";
import { generateCogsTemplate, parseCogsCSV } from "./csv-helper";

vi.mock("./db", () => ({
  getStoreById: vi.fn(async () => ({ id: 14 })),
  getShopifyConnectionByStoreId: vi.fn(async () => ({ shopDomain: "example.myshopify.com", accessToken: "test-only" })),
  getCogsConfigByStoreId: vi.fn(async () => [{ variantId: "42", cogsValue: "4.60" }, { variantId: "43", cogsValue: "0.00" }]),
  getProductShippingProfilesByStoreId: vi.fn(async () => [{ variantId: "42", profileId: 7 }]),
  getShippingProfilesByStoreId: vi.fn(async () => [{ id: 7, name: "Catalogue $10 shipping (including customs)" }]),
}));

afterEach(() => vi.unstubAllGlobals());

it("exports saved shipping assignments with costs for a reusable product CSV", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ products: [
    { title: "Car", variants: [{ id: 42, sku: "CAR", title: "Default Title" }] },
    { title: "Gift Card", variants: [{ id: 43, title: "USD 50" }] },
  ] }), { status: 200 })));
  const csv = await generateCogsTemplate(14);
  const parsed = parseCogsCSV(csv);
  expect(parsed.success).toBe(true);
  expect(parsed.data?.map(row => [row["Variant ID"], row["Current COGS (USD)"], row["Shipping Profile Name"]])).toEqual([
    ["42", "4.60", "Catalogue $10 shipping (including customs)"], ["43", "0.00", ""],
  ]);
});
