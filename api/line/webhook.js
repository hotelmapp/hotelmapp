import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { answerGuestMessage } from "../../ai-core/index.js";
import { OpenAIResponseError } from "../../ai-core/response-service.js";
import { lineConversationId } from "../../ai-core/conversation/record.js";
import { answerWithConversation, configuredConversationService } from "../../ai-core/conversation/runtime.js";

const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const MAX_BODY_BYTES = 1_000_000;
const DEDUPE_TTL_MS = 10 * 60_000;

export const config = { api: { bodyParser: false }, maxDuration: 30 };

function safeEqual(left, right) {
  const a = Buffer.from(left || "", "utf8");
  const b = Buffer.from(right || "", "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function validLineSignature(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || !signature || !secret) return false;
  return safeEqual(createHmac("sha256", secret).update(rawBody).digest("base64"), signature);
}

async function rawRequestBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === "string") return Buffer.from(req.rawBody);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new Error("body_too_large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function eventKey(event) {
  if (typeof event?.webhookEventId === "string" && event.webhookEventId) return `id:${event.webhookEventId}`;
  return `hash:${createHash("sha256").update(JSON.stringify(event)).digest("hex")}`;
}

async function replyText(replyToken, text, accessToken, fetchImpl = fetch) {
  const response = await fetchImpl(LINE_REPLY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] })
  });
  if (!response.ok) {
    const error = new Error("line_reply_failed");
    error.status = response.status;
    error.requestId = response.headers.get("x-line-request-id") || undefined;
    throw error;
  }
}

export async function processLineEvent(event, { accessToken, fetchImpl = fetch, conversationService, hmacSecret, answer = answerGuestMessage } = {}) {
  const key = eventKey(event);
  if (conversationService) {
    try {
      if (!await conversationService.store.claimIdempotencyKey("line", key, DEDUPE_TTL_MS)) return { outcome: "duplicate" };
    } catch {
      // Continue only through answerWithConversation's stateless/fail-closed
      // path; Redis failure must not become an implicit email handoff.
      conversationService = { history: async () => { throw new Error("redis_unavailable"); } };
    }
  }
    if (event?.type !== "message" || event?.message?.type !== "text") {
      return { outcome: "ignored" };
    }
    if (typeof event.replyToken !== "string" || !event.replyToken) throw new Error("missing_reply_token");
    let response;
    if (conversationService && hmacSecret) {
      const id = lineConversationId(event.source, hmacSecret);
      const conversation = createHash("sha256").update(id).digest("hex").slice(0, 16);
      response = (await answerWithConversation({ id, channel: "line", message: event.message.text, service: conversationService, answer,
        onDiagnostic: diagnostic => console.info("[conversation]", { channel: "line", conversation, ...diagnostic })
      })).answer;
    } else {
      response = await answer(event.message.text, { channel: "line", handoffService: async () => ({ attempted: false }) });
    }
    await replyText(event.replyToken, response, accessToken, fetchImpl);
    return { outcome: "replied" };
}

function json(res, status, body) { return res.status(status).json(body); }

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed", diagnostic: { source: "line", code: "method_not_allowed" } });
  }
  const secret = process.env.LINE_CHANNEL_SECRET?.trim();
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  const hmacSecret = process.env.CONVERSATION_HMAC_SECRET?.trim();
  const redisConfigured = Boolean((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)?.trim()
    && (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)?.trim());
  if (!secret || !accessToken || !hmacSecret || !redisConfigured) {
    console.error("[api/line/webhook] LINE production configuration is incomplete", { line: Boolean(secret && accessToken), conversationHmac: Boolean(hmacSecret), redis: redisConfigured });
    return json(res, 500, { error: "LINE adapter is not configured", diagnostic: { source: "line", code: "missing_configuration" } });
  }

  let rawBody;
  try { rawBody = await rawRequestBody(req); } catch {
    return json(res, 413, { error: "Invalid request body", diagnostic: { source: "line", code: "invalid_body" } });
  }
  const signature = req.headers?.["x-line-signature"];
  if (!validLineSignature(rawBody, Array.isArray(signature) ? signature[0] : signature, secret)) {
    return json(res, 401, { error: "Invalid signature", diagnostic: { source: "line", code: "invalid_signature" } });
  }

  let payload;
  try { payload = JSON.parse(rawBody.toString("utf8")); } catch {
    return json(res, 400, { error: "Invalid JSON", diagnostic: { source: "line", code: "invalid_json" } });
  }
  const events = Array.isArray(payload?.events) ? payload.events : [];
  if (!events.length) return json(res, 200, { ok: true, processed: 0 });

  const outcomes = [];
  try {
    let conversationService;
    try { conversationService = configuredConversationService(); } catch { conversationService = null; }
    for (const event of events) outcomes.push(await processLineEvent(event, { accessToken, conversationService, hmacSecret }));
  } catch (error) {
    const diagnostic = error instanceof OpenAIResponseError
      ? { source: "openai", code: error.code, status: error.status }
      : { source: "line", code: error?.message === "line_reply_failed" ? "reply_failed" : "event_failed", ...(error?.status ? { status: error.status } : {}), ...(error?.requestId ? { requestId: error.requestId } : {}) };
    console.error("[api/line/webhook] Event processing failed", diagnostic);
    return json(res, 502, { error: "Unable to process webhook event", diagnostic });
  }
  return json(res, 200, {
    ok: true,
    processed: outcomes.filter(item => item.outcome === "replied").length,
    ignored: outcomes.filter(item => item.outcome === "ignored").length,
    duplicates: outcomes.filter(item => item.outcome === "duplicate").length
  });
}
