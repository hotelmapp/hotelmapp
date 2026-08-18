import { createHmac, timingSafeEqual } from "node:crypto";

function safeEqual(left, right) {
  const a = Buffer.from(left || "", "utf8");
  const b = Buffer.from(right || "", "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function validMetaSignature(rawBody, signature, appSecret) {
  if (!Buffer.isBuffer(rawBody) || !appSecret || !signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return safeEqual(expected, signature);
}

export function verifyMetaChallenge(query, verifyToken) {
  if (!verifyToken || query?.["hub.mode"] !== "subscribe" || !safeEqual(query?.["hub.verify_token"], verifyToken)) return null;
  const challenge = query?.["hub.challenge"];
  return typeof challenge === "string" ? challenge : null;
}
