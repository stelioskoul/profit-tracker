import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  createStore: vi.fn(),
  upsertProcessingFeesConfig: vi.fn(),
  getStoresByUserId: vi.fn(),
  getStoreById: vi.fn(),
  updateStore: vi.fn(),
}));
vi.mock("./db", async importOriginal => ({
  ...(await importOriginal<typeof import("./db")>()),
  ...mocks,
}));

import { appRouter } from "./routers";

function context(userId = 1): TrpcContext {
  return {
    user: { id: userId, role: "user", email: `user${userId}@example.invalid` } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {}, cookie: () => {} } as TrpcContext["res"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createStore.mockResolvedValue({ id: 42 });
  mocks.upsertProcessingFeesConfig.mockResolvedValue(undefined);
  mocks.getStoresByUserId.mockResolvedValue([{ id: 42, userId: 1, name: "Test Store", platform: "shopify" }]);
  mocks.getStoreById.mockResolvedValue({ id: 42, userId: 1, name: "Test Store", platform: "shopify" });
  mocks.updateStore.mockResolvedValue(undefined);
});

describe("stores procedures", () => {
  it("creates a store using the current user ID and configures its returned ID", async () => {
    const result = await appRouter.createCaller(context()).stores.create({
      name: "Test Store", platform: "shopify", currency: "USD", timezone: "Europe/Athens",
    });
    expect(result).toEqual({ success: true });
    expect(mocks.createStore).toHaveBeenCalledWith(expect.objectContaining({ userId: 1, timezoneOffset: 120 }));
    expect(mocks.upsertProcessingFeesConfig).toHaveBeenCalledWith(expect.objectContaining({ storeId: 42 }));
  });
  it("only lists the authenticated user's stores", async () => {
    const stores = await appRouter.createCaller(context()).stores.list();
    expect(stores).toHaveLength(1);
    expect(mocks.getStoresByUserId).toHaveBeenCalledWith(1);
  });
  it("rejects a different user's store ID", async () => {
    await expect(appRouter.createCaller(context(2)).stores.getById({ id: 42 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("updates the canonical IANA zone and a signed UTC-compatible fallback", async () => {
    await appRouter.createCaller(context()).stores.update({ id: 42, timezone: "Europe/Athens" });
    expect(mocks.updateStore).toHaveBeenCalledWith(42, expect.objectContaining({
      timezone: "Europe/Athens", timezoneOffset: 120,
    }));
  });
  it("rejects an offset-only update that would leave the reporting zone unchanged", async () => {
    await expect(appRouter.createCaller(context()).stores.update({ id: 42, timezoneOffset: -480 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
