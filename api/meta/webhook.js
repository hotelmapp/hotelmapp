import { configuredConversationService } from "../../ai-core/conversation/runtime.js";
import { MetaSendError } from "./client.js";
import { messengerEvents, processMetaEvent } from "./adapter.js";
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

export function metaConfiguration(env = process.env) {
  const values = {
    verifyToken: env.META_WEBHOOK_VERIFY_TOKEN?.trim(), appSecret: env.META_APP_SECRET?.trim(),
    accessToken: env.META_PAGE_ACCESS_TOKEN?.trim(), hmacSecret: env.CONVERSATION_HMAC_SECRET?.trim(),
    redisUrl: (env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL)?.trim(),
    redisToken: (env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN)?.trim(),
    graphVersion: env.META_GRAPH_API_VERSION?.trim() || "v26.0"
  };
  values.missing = Object.entries(values).filter(([key, value]) => key !== "graphVersion" && !value).map(([key]) => key);
  return values;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const env = metaConfiguration();
  if (req.method === "GET") {
    if (!env.verifyToken) return json(res, 500, { error: "Meta adapter is not configured", diagnostic: { source: "meta", code: "missing_configuration" } });
    const challenge = verifyMetaChallenge(req.query, env.verifyToken);
    if (challenge === null) return json(res, 403, { error: "Verification rejected", diagnostic: { source: "meta", code: "invalid_verification" } });
    return res.status(200).send(challenge);
  }
  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return json(res, 405, { error: "Method not allowed" }); }
  if (env.missing.length) {
    console.error("[api/meta/webhook] Meta configuration is incomplete", { code: "missing_configuration", missing: env.missing });
    return json(res, 500, { error: "Meta adapter is not configured", diagnostic: { source: "meta", code: "missing_configuration", missing: env.missing } });
  }
  let rawBody;
  try { rawBody = await rawRequestBody(req); } catch { return json(res, 413, { error: "Invalid request body", diagnostic: { source: "meta", code: "invalid_body" } }); }
  if (!validMetaSignature(rawBody, firstHeader(req.headers?.["x-hub-signature-256"]), env.appSecret)) {
    return json(res, 401, { error: "Invalid signature", diagnostic: { source: "meta", code: "invalid_signature" } });
  }
  let payload;
  try { payload = JSON.parse(rawBody.toString("utf8")); } catch { return json(res, 400, { error: "Invalid JSON", diagnostic: { source: "meta", code: "invalid_json" } }); }

  const outcomes = [];
  try {
    const service = configuredConversationService();
    for (const item of messengerEvents(payload)) outcomes.push(await processMetaEvent(item, { conversationService: service, hmacSecret: env.hmacSecret, accessToken: env.accessToken, graphVersion: env.graphVersion }));
  } catch (error) {
    const diagnostic = { source: "meta", code: error instanceof MetaSendError ? error.code : error?.message || "event_failed", ...(error?.status ? { status: error.status } : {}), ...(error?.requestId ? { requestId: error.requestId } : {}) };
    console.error("[api/meta/webhook] Event processing failed", diagnostic);
    return json(res, 503, { error: "Unable to process webhook event", diagnostic });
  }
  return json(res, 200, { ok: true, processed: outcomes.filter(x => x.outcome === "replied").length, ignored: outcomes.filter(x => x.outcome === "ignored").length, duplicates: outcomes.filter(x => x.outcome === "duplicate").length });
}
