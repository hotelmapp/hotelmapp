import { createHash } from "node:crypto";
import { answerGuestMessage } from "../../ai-core/index.js";
import { answerWithConversation } from "../../ai-core/conversation/runtime.js";
import { metaConversationId } from "../../ai-core/conversation/record.js";
import { performAuthorizedHandoff } from "../../ai-core/handoff-service.js";
import { sendInstagramText, sendMessengerText } from "./client.js";

const DEDUPE_TTL_MS = 24 * 60 * 60_000;
const safeId = value => createHash("sha256").update(String(value)).digest("hex").slice(0, 16);

export function messengerEvents(payload) {
  if (payload?.object !== "page" || !Array.isArray(payload.entry)) return [];
  return payload.entry.flatMap(entry => (entry.messaging || []).map(event => ({ channel: "messenger", event, accountId: String(entry.id || event?.recipient?.id || "") })));
}

export function instagramEvents(payload) {
  if (payload?.object !== "instagram" || !Array.isArray(payload.entry)) return [];
  return payload.entry.flatMap(entry => (entry.messaging || []).map(event => ({ channel: "instagram", event, accountId: String(entry.id || event?.recipient?.id || "") })));
}

export function metaMessagingEvents(payload) {
  return [...messengerEvents(payload), ...instagramEvents(payload)];
}

export async function processMetaEvent({ event, accountId, pageId, channel = "messenger" }, {
  conversationService, hmacSecret, accessToken, graphVersion, fetchImpl = fetch, handoffService = performAuthorizedHandoff,
  answer = answerGuestMessage, send = channel === "instagram" ? sendInstagramText : sendMessengerText, logger = console
} = {}) {
  const transportAccountId = accountId || pageId;
  if (!["messenger", "instagram"].includes(channel)) return { outcome: "ignored" };
  const message = event?.message;
  if (!message || message.is_echo === true || event?.sender?.id === transportAccountId || typeof message.text !== "string" || !message.text.trim() || typeof message.mid !== "string" || !message.mid) {
    return { outcome: "ignored" };
  }
  if (!event?.sender?.id || !transportAccountId) return { outcome: "ignored" };
  if (!conversationService?.store || !hmacSecret || !accessToken) throw new Error("meta_not_configured");

  const conversationId = metaConversationId({ platform: channel, pageId: transportAccountId, senderId: event.sender.id }, hmacSecret);
  const messageId = safeId(message.mid);
  let claimed;
  try { claimed = await conversationService.store.claimIdempotencyKey(`meta:${channel}`, messageId, DEDUPE_TTL_MS); }
  catch (cause) { throw new Error("meta_memory_unavailable", { cause }); }
  if (!claimed) {
    logger.info?.("[meta] event", { channel, eventType: "text", conversationId, messageId, dedupe: "hit" });
    return { outcome: "duplicate" };
  }

  logger.info?.("[meta] event", { channel, eventType: "text", conversationId, messageId, dedupe: "miss" });
  const result = await answerWithConversation({ id: conversationId, channel, message: message.text, service: conversationService, answer, handoffService });
  if (!result.durable) throw new Error("meta_memory_unavailable", { cause: result.memoryError });
  await send({ recipientId: event.sender.id, text: result.answer, accessToken, graphVersion, fetchImpl });
  logger.info?.("[meta] reply", { channel, conversationId, messageId, memoryWrite: true, send: "success" });
  return { outcome: "replied", conversationId };
}
