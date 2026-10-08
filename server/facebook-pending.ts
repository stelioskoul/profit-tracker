import { SignJWT, jwtVerify } from "jose";
import { parse } from "cookie";
import type { Request, Response } from "express";
import { getSessionSecret } from "./_core/sdk";
import { getSessionCookieOptions } from "./_core/cookies";
import { decryptToken, encryptToken } from "./token-crypto";

export const FACEBOOK_PENDING_COOKIE = "facebook_connection_pending";
const audience = "profit-tracker-facebook-selection";

export async function stageFacebookToken(res: Response, req: Request, userId: number, storeId: number, token: string) {
  const grant = await new SignJWT({ storeId, token: encryptToken(token) })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("beprofit").setAudience(audience)
    .setSubject(String(userId)).setIssuedAt().setExpirationTime("10m").sign(getSessionSecret());
  res.cookie(FACEBOOK_PENDING_COOKIE, grant, { ...getSessionCookieOptions(req), sameSite: "lax", maxAge: 600_000 });
}

export async function readPendingFacebookToken(req: Request, userId: number, storeId: number) {
  const cookie = parse(req.headers.cookie || "")[FACEBOOK_PENDING_COOKIE];
  if (!cookie) return undefined;
  try {
    const { payload } = await jwtVerify(cookie, getSessionSecret(), { issuer: "beprofit", audience, algorithms: ["HS256"] });
    if (payload.sub !== String(userId) || payload.storeId !== storeId || typeof payload.token !== "string") return undefined;
    return decryptToken(payload.token);
  } catch { return undefined; }
}
export function clearPendingFacebookToken(res: Response, req: Request) {
  res.clearCookie(FACEBOOK_PENDING_COOKIE, { ...getSessionCookieOptions(req), sameSite: "lax" });
}
