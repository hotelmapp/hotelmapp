import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { FrontDeskError } from "./store.js";

const COOKIE = "__Host-front_desk";
const SESSION_SECONDS = 12 * 60 * 60;
const digest = value => createHash("sha256").update(value).digest();
export function assertDeskConfiguration(env) {
  if (typeof env.FRONT_DESK_ADMIN_KEY !== "string" || env.FRONT_DESK_ADMIN_KEY.trim().length < 32 || env.FRONT_DESK_ADMIN_KEY.length > 256) throw new FrontDeskError("front_desk_not_configured", 503);
}
export function assertDeskOrigin(req, env) {
  const allowed = [env.FRONT_DESK_ORIGIN, env.VERCEL_URL && "https://" + env.VERCEL_URL, env.VERCEL_BRANCH_URL && "https://" + env.VERCEL_BRANCH_URL].filter(Boolean);
  const origin = req.headers?.origin;
  if (typeof origin !== "string" || !allowed.some(value => {
    try { const url = new URL(value); return url.protocol === "https:" && url.origin === value && origin === url.origin; } catch { return false; }
  })) throw new FrontDeskError("origin_rejected", 403);
}
export function deskCookie(value, maxAge = SESSION_SECONDS) {
  return COOKIE + "=" + value + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + maxAge;
}
function sessionToken(req) {
  const cookie = typeof req.headers?.cookie === "string" ? req.headers.cookie : "";
  const token = cookie.split(";").map(x => x.trim()).find(x => x.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token || "") ? token : null;
}
function sessionKey(store, token, env) {
  // Rotating the admin key revokes old sessions too.
  return store.key("session", store.digest(env.FRONT_DESK_ADMIN_KEY + ":" + token));
}
export async function authenticateDesk(req, store, env) {
  assertDeskConfiguration(env);
  const token = sessionToken(req);
  if (!token || !await store.command(["GET", sessionKey(store, token, env)])) throw new FrontDeskError("login_required", 401);
  return token;
}
export async function loginDesk(password, store, env) {
  assertDeskConfiguration(env);
  // An atomic expiring counter limits guesses without retaining IP addresses.
  const count = await store.command(["EVAL", "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],300) end; return n", "1", store.key("login_attempts")]);
  if (Number(count) > 30) throw new FrontDeskError("login_rate_limited", 429);
  if (typeof password !== "string" || password.length > 256 || !timingSafeEqual(digest(password), digest(env.FRONT_DESK_ADMIN_KEY))) throw new FrontDeskError("login_failed", 401);
  const token = randomBytes(32).toString("base64url");
  await store.command(["SET", sessionKey(store, token, env), "admin", "EX", String(SESSION_SECONDS)]);
  return token;
}
export async function logoutDesk(req, store, env) {
  const token = sessionToken(req);
  if (token) await store.command(["DEL", sessionKey(store, token, env)]);
}
