import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { FACEBOOK_PENDING_COOKIE, readPendingFacebookToken, stageFacebookToken } from "./facebook-pending";
beforeEach(() => { vi.stubEnv("JWT_SECRET", "test-only-jwt-secret-of-at-least-32-characters"); vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32,4).toString("base64")); vi.stubEnv("APP_URL","https://example.com"); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe("Facebook account selection grant", () => {
  it("keeps the token encrypted in a signed HttpOnly cookie and binds it to the store and account", async () => {
    const res = { cookie: vi.fn() } as unknown as Response;
    const req = { headers: {}, protocol:"https" } as Request;
    await stageFacebookToken(res,req,20,14,"private-fixture-token");
    const [name,grant,options] = (res.cookie as any).mock.calls[0];
    expect(name).toBe(FACEBOOK_PENDING_COOKIE);
    expect(options).toMatchObject({httpOnly:true,secure:true,sameSite:"lax",maxAge:600000});
    expect(Buffer.from(grant.split(".")[1],"base64url").toString()).not.toContain("private-fixture-token");
    const withCookie = {headers:{cookie:`${name}=${grant}`}} as Request;
    expect(await readPendingFacebookToken(withCookie,20,14)).toBe("private-fixture-token");
    expect(await readPendingFacebookToken(withCookie,21,14)).toBeUndefined();
    expect(await readPendingFacebookToken(withCookie,20,10)).toBeUndefined();
    vi.useFakeTimers(); vi.setSystemTime(Date.now()+601000);
    expect(await readPendingFacebookToken(withCookie,20,14)).toBeUndefined();
  });
});
