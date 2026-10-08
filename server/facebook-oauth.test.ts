import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFacebookAuthUrl, inspectFacebookToken, prepareFacebookToken, getFacebookAdAccounts, verifyFacebookAdAccount } from "./facebook-oauth";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const info = (overrides: object = {}) => ({ data: { app_id: "12345", is_valid: true, type: "SYSTEM_USER", scopes: ["ads_read"], expires_at: 0, data_access_expires_at: 0, ...overrides } });
beforeEach(() => { vi.stubEnv("FACEBOOK_APP_ID", "12345"); vi.stubEnv("FACEBOOK_APP_SECRET", "test-app-secret"); vi.stubEnv("FACEBOOK_LOGIN_CONFIG_ID", ""); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Facebook login and token verification", () => {
  it("fails clearly when login is not configured, instead of redirecting with undefined client_id", () => {
    vi.stubEnv("FACEBOOK_APP_ID", "");
    expect(() => getFacebookAuthUrl("https://example.com/callback", "state")).toThrow("not configured");
  });
  it("requests only read-only ads access or uses the exact Business Login configuration", () => {
    let url = new URL(getFacebookAuthUrl("https://example.com/callback", "state"));
    expect(url.searchParams.get("scope")).toBe("ads_read");
    expect(url.searchParams.get("response_type")).toBe("code");
    vi.stubEnv("FACEBOOK_LOGIN_CONFIG_ID", "67890");
    url = new URL(getFacebookAuthUrl("https://example.com/callback", "state"));
    expect(url.searchParams.get("config_id")).toBe("67890");
    expect(url.searchParams.get("scope")).toBe("ads_read");
    expect(url.searchParams.get("auth_type")).toBe("rerequest");
    expect(url.searchParams.has("client_secret")).toBe(false);
  });
  it("preserves a verified non-expiring system-user token without exchanging it", async () => {
    const fetch = vi.fn().mockResolvedValue(json(info())); vi.stubGlobal("fetch", fetch);
    expect(await prepareFacebookToken("system-fixture")).toEqual({ accessToken: "system-fixture", type: "SYSTEM_USER", expiresAt: null });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("uses the earlier real data-access expiration", async () => {
    const expiry = Math.floor(Date.now()/1000) + 86400;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(info({ expires_at: expiry + 100000, data_access_expires_at: expiry }))));
    expect((await inspectFacebookToken("fixture")).expiresAt?.getTime()).toBe(expiry*1000);
  });
  it("recognizes ads_read when Meta reports it as an asset-specific granular grant", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(info({ scopes: [], granular_scopes: [{ scope: "ads_read", target_ids: ["123"] }] }))));
    expect(await inspectFacebookToken("fixture")).toEqual({ type: "SYSTEM_USER", expiresAt: null });
  });
  it("rejects an unrelated granular grant and only logs safe permission names", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(info({ scopes: ["public_profile", "secret-value"], granular_scopes: [{ scope: "pages_read_engagement", target_ids: ["private-asset"] }], access_token: "private-provider-token" }))));
      await expect(inspectFacebookToken("private-input-token")).rejects.toThrow("did not grant ads_read");
      const log = JSON.stringify(warn.mock.calls);
      expect(log).toContain("public_profile");
      expect(log).not.toMatch(/private-|secret-value/);
    } finally { warn.mockRestore(); }
  });
  it.each([{is_valid:false}, {app_id:"different"}, {scopes:[]}, {expires_at:1}, {expires_at:undefined}])("rejects invalid, mismatched, unpermitted or expired tokens: %j", async overrides => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(info(overrides))));
    await expect(inspectFacebookToken("fixture")).rejects.toThrow();
  });
  it("exchanges a short-lived user token and validates the resulting expiry", async () => {
    const expires = Math.floor(Date.now()/1000);
    const fetch = vi.fn().mockResolvedValueOnce(json(info({ type:"USER", expires_at:expires+3600 })))
      .mockResolvedValueOnce(json({access_token:"long-fixture"}))
      .mockResolvedValueOnce(json(info({type:"USER", expires_at:expires+5184000})));
    vi.stubGlobal("fetch", fetch);
    const token = await prepareFacebookToken("short-fixture");
    expect(token.accessToken).toBe("long-fixture");
    expect(token.expiresAt?.getTime()).toBe((expires+5184000)*1000);
    const [url, init] = fetch.mock.calls[1];
    expect(String(url)).not.toContain("test-app-secret");
    expect(String(init.body)).toContain("grant_type=fb_exchange_token");
  });
  it("paginates ad accounts using cursors and never follows an arbitrary next URL", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({data:[{id:"act_1",name:"Other"}],paging:{next:"https://untrusted.example/",cursors:{after:"second"}}}))
      .mockResolvedValueOnce(json({data:[{id:"act_2",name:"Minicubez"}]}));
    vi.stubGlobal("fetch",fetch);
    expect((await getFacebookAdAccounts("fixture")).map(account=>account.id)).toEqual(["act_1","act_2"]);
    expect(String(fetch.mock.calls[1][0])).toContain("graph.facebook.com/v25.0/me/adaccounts");
    expect(String(fetch.mock.calls[1][0])).toContain("after=second");
  });
  it("verifies Insights permission for the selected account, rather than only metadata access", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({id:"act_123",name:"Minicubez",currency:"EUR"}))
      .mockResolvedValueOnce(json({error:{code:200,message:"secret-provider-detail"}},403));
    vi.stubGlobal("fetch",fetch);
    await expect(verifyFacebookAdAccount("fixture","123")).rejects.toThrow("HTTP 403");
    expect(String(fetch.mock.calls[0][0])).not.toContain("access_token=");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer fixture");
  });
  it("gives an actionable reconnect error without exposing provider response details", async () => {
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(json({error:{code:190,message:"secret-value"}},400)));
    await expect(verifyFacebookAdAccount("fixture","123")).rejects.toThrow("Reconnect this ad account");
  });
});
