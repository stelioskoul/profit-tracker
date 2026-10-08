import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
const mocks = vi.hoisted(() => ({getStoreById:vi.fn(),getFacebookConnectionById:vi.fn(),upsertFacebookConnection:vi.fn(),prepareFacebookToken:vi.fn(),verifyFacebookAdAccount:vi.fn()}));
vi.mock("./db",async original=>({...await original<typeof import("./db")>(),getStoreById:mocks.getStoreById,getFacebookConnectionById:mocks.getFacebookConnectionById,upsertFacebookConnection:mocks.upsertFacebookConnection}));
vi.mock("./facebook-oauth",async original=>({...await original<typeof import("./facebook-oauth")>(),prepareFacebookToken:mocks.prepareFacebookToken,verifyFacebookAdAccount:mocks.verifyFacebookAdAccount}));
import {appRouter} from "./routers";
const ctx = {user:{id:20,role:"user"},req:{headers:{}},res:{}} as TrpcContext;
beforeEach(()=>{
  vi.clearAllMocks(); mocks.getStoreById.mockImplementation(async id=>({id,userId:20}));
  mocks.getFacebookConnectionById.mockResolvedValue({id:1,storeId:14,adAccountId:"act_123",accessToken:"private-token"});
  mocks.prepareFacebookToken.mockResolvedValue({accessToken:"verified-token",type:"SYSTEM_USER",expiresAt:null});
  mocks.verifyFacebookAdAccount.mockResolvedValue({id:"act_123",name:"Minicubez",currency:"EUR",timezone_offset_hours_utc:3});
});
describe("Facebook connection isolation and actual expiry",()=>{
  it("only shares an account between profiles owned by the authenticated user",async()=>{
    mocks.getStoreById.mockImplementation(async id=>({id,userId:id===14?30:20}));
    await expect(appRouter.createCaller(ctx).facebook.connectExisting({storeId:10,connectionId:1})).rejects.toMatchObject({code:"NOT_FOUND"});
    expect(mocks.prepareFacebookToken).not.toHaveBeenCalled(); expect(mocks.upsertFacebookConnection).not.toHaveBeenCalled();
  });
  it("verifies access and stores the selected account's real metadata and no-expiry verdict",async()=>{
    expect(await appRouter.createCaller(ctx).facebook.connectExisting({storeId:10,connectionId:1})).toEqual({success:true});
    expect(mocks.verifyFacebookAdAccount).toHaveBeenCalledWith("verified-token","act_123");
    expect(mocks.upsertFacebookConnection).toHaveBeenCalledWith(expect.objectContaining({storeId:10,adAccountId:"act_123",adAccountName:"Minicubez",tokenExpiresAt:null,tokenType:"SYSTEM_USER",timezoneOffset:180}));
  });
  it("does not invent a one-year expiry for manual tokens",async()=>{
    const expiresAt = new Date("2030-01-01T00:00:00Z"); mocks.prepareFacebookToken.mockResolvedValue({accessToken:"verified-token",type:"USER",expiresAt});
    await appRouter.createCaller(ctx).facebook.connectManual({storeId:10,adAccountId:"123",accessToken:"fixture"});
    expect(mocks.upsertFacebookConnection).toHaveBeenCalledWith(expect.objectContaining({tokenExpiresAt:expiresAt,tokenType:"USER"}));
  });
  it("does not save a connection if Insights access is denied",async()=>{
    mocks.verifyFacebookAdAccount.mockRejectedValue(new Error("Insights denied"));
    await expect(appRouter.createCaller(ctx).facebook.connectExisting({storeId:10,connectionId:1})).rejects.toThrow("Insights denied");
    expect(mocks.upsertFacebookConnection).not.toHaveBeenCalled();
  });
});
