import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateRuntimeConfiguration } from "./runtime-config";

describe("server startup configuration", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgresql://app:private@db.example:5432/beprofit");
    vi.stubEnv("JWT_SECRET", "j".repeat(48));
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("APP_URL", undefined);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SHOPIFY_CLIENT_ID", undefined);
    vi.stubEnv("SHOPIFY_CLIENT_CREDENTIALS", undefined);
    vi.stubEnv("FACEBOOK_APP_ID", undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("accepts a configured database, session key and token key", () => {
    expect(() => validateRuntimeConfiguration()).not.toThrow();
  });
  it("rejects a missing database URL", () => {
    vi.stubEnv("DATABASE_URL", undefined);
    expect(() => validateRuntimeConfiguration()).toThrow("DATABASE_URL");
  });
  it("rejects a weak JWT secret", () => {
    vi.stubEnv("JWT_SECRET", "short");
    expect(() => validateRuntimeConfiguration()).toThrow("JWT_SECRET");
  });
  it("rejects an invalid provider-token encryption key", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "not-a-valid-key");
    expect(() => validateRuntimeConfiguration()).toThrow("TOKEN_ENCRYPTION_KEY");
  });
  it("requires a safe HTTPS origin when provider OAuth is enabled in production", () => {
    vi.stubEnv("SHOPIFY_CLIENT_ID", "configured-provider");
    expect(() => validateRuntimeConfiguration()).toThrow("APP_URL");
    vi.stubEnv("APP_URL", "https://beprofit.example");
    expect(() => validateRuntimeConfiguration()).not.toThrow();
  });
  it("allows a local HTTP origin only for local development", () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    expect(() => validateRuntimeConfiguration()).not.toThrow();
    vi.stubEnv("APP_URL", "http://remote.example");
    expect(() => validateRuntimeConfiguration()).toThrow("APP_URL");
  });
});
