import { configuredConversationService } from "../../ai-core/conversation/runtime.js";
import { MetaSendError } from "./client.js";
import { metaMessagingEvents, processMetaEvent } from "./adapter.js";
import { validMetaSignature, verifyMetaChallenge } from "./security.js";

const MAX_BODY_BYTES = 1_000_000;
export const config = { api: { bodyParser: false }, maxDuration: 60 };

async function rawRequestBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === "string") return Buffer.from(req.rawBody);
  const chunks = []; let size = 0;
  for await (const chunk of req) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > MAX_BODY_BYTES) throw new Error("body_too_large"); chunks.push(bytes); }
  return Buffer.concat(chunks);
}
const json = (res, status, body) => res.status(status).json(body);
const firstHeader = value => Array.isArray(value) ? value[0] : value;
const log = (level, event, details = {}) => console[level]?.("[api/meta/webhook]", { event, ...details });

export function metaConfiguration(env = process.env) {
  const values = {
    verifyToken: env.META_WEBHOOK_VERIFY_TOKEN?.trim(), appSecret: env.META_APP_SECRET?.trim(),
    accessToken: env.META_PAGE_ACCESS_TOKEN?.trim(), instagramAccessToken: env.META_INSTAGRAM_ACCESS_TOKEN?.trim(), hmacSecret: env.CONVERSATION_HMAC_SECRET?.trim(),
    redisUrl: (env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL)?.trim(),
    redisToken: (env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN)?.trim(),
    graphVersion: env.META_GRAPH_API_VERSION?.trim() || "v26.0"
  };
  values.missing = Object.entries(values).filter(([key, value]) => !["graphVersion", "instagramAccessToken"].includes(key) && !value).map(([key]) => key);
  return values;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const env = metaConfiguration();
  if (req.method === "GET") {
    if (!env.verifyToken) {
      log("error", "verification_failed", { code: "missing_configuration" });
      return json(res, 500, { error: "Meta adapter is not configured", diagnostic: { source: "meta", code: "missing_configuration" } });
    }
    const challenge = verifyMetaChallenge(req.query, env.verifyToken);
    if (challenge === null) {
      log("warn", "verification_failed", { code: "invalid_verification" });
      return json(res, 403, { error: "Verification rejected", diagnostic: { source: "meta", code: "invalid_verification" } });
    }
    log("info", "verification_succeeded");
    return res.status(200).send(challenge);
  }
  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return json(res, 405, { error: "Method not allowed" }); }
  if (env.missing.length) {
    log("error", "request_rejected", { code: "missing_configuration", missing: env.missing });
    return json(res, 500, { error: "Meta adapter is not configured", diagnostic: { source: "meta", code: "missing_configuration", missing: env.missing } });
  }
  let rawBody;
  try { rawBody = await rawRequestBody(req); } catch (error) {
    log("warn", "request_rejected", { code: error?.message === "body_too_large" ? "body_too_large" : "invalid_body" });
    return json(res, 413, { error: "Invalid request body", diagnostic: { source: "meta", code: "invalid_body" } });
  }
  if (!validMetaSignature(rawBody, firstHeader(req.headers?.["x-hub-signature-256"]), env.appSecret)) {
    log("warn", "request_rejected", { code: "invalid_signature", bodyBytes: rawBody.length });
    return json(res, 401, { error: "Invalid signature", diagnostic: { source: "meta", code: "invalid_signature" } });
  }
  let payload;
  try { payload = JSON.parse(rawBody.toString("utf8")); } catch {
    log("warn", "request_rejected", { code: "invalid_json", bodyBytes: rawBody.length });
    return json(res, 400, { error: "Invalid JSON", diagnostic: { source: "meta", code: "invalid_json" } });
  }

  const outcomes = [];
  try {
    const service = configuredConversationService();
    const events = metaMessagingEvents(payload);
    log("info", "request_verified", { object: payload?.object || "unknown", entries: Array.isArray(payload?.entry) ? payload.entry.length : 0, events: events.length, bodyBytes: rawBody.length });
    for (const item of events) outcomes.push(await processMetaEvent(item, { conversationService: service, hmacSecret: env.hmacSecret, accessToken: item.channel === "instagram" ? env.instagramAccessToken : env.accessToken, graphVersion: env.graphVersion }));
  } catch (error) {
    const diagnostic = { source: "meta", code: error instanceof MetaSendError ? error.code : error?.message || "event_failed", ...(error?.status ? { status: error.status } : {}), ...(error?.requestId ? { requestId: error.requestId } : {}) };
    log("error", "event_processing_failed", diagnostic);
    return json(res, 503, { error: "Unable to process webhook event", diagnostic });
  }
  const summary = { processed: outcomes.filter(x => x.outcome === "replied").length, ignored: outcomes.filter(x => x.outcome === "ignored").length, duplicates: outcomes.filter(x => x.outcome === "duplicate").length };
  log("info", "request_completed", summary);
  return json(res, 200, { ok: true, ...summary });
}
