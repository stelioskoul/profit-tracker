import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({ getStoreById: vi.fn(), upsertCogsConfig: vi.fn() }));
vi.mock("./db", async original => ({ ...(await original<typeof import("./db")>()), ...mocks }));
import { appRouter } from "./routers";

const context = {
  user: { id: 20, role: "user", email: "owner@example.invalid" },
  req: { protocol: "https", headers: {} },
  res: { clearCookie() {}, cookie() {} },
} as TrpcContext;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStoreById.mockResolvedValue({ id: 14, userId: 20, currency: "USD" });
  mocks.upsertCogsConfig.mockResolvedValue(undefined);
});

describe("COGS values entered in the USD product field", () => {
  it("preserves the entered amount as USD so reporting does not convert it again", async () => {
    await appRouter.createCaller(context).config.setCogs({ storeId: 14, variantId: "variant-1", cogsValue: "4.60" });
    expect(mocks.upsertCogsConfig).toHaveBeenCalledWith(expect.objectContaining({ cogsValue: "4.60", currency: "USD" }));
  });

  it("does not save a cost for another account's store", async () => {
    mocks.getStoreById.mockResolvedValue({ id: 14, userId: 21 });
    await expect(appRouter.createCaller(context).config.setCogs({ storeId: 14, variantId: "variant-1", cogsValue: "4.60" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.upsertCogsConfig).not.toHaveBeenCalled();
  });
});
