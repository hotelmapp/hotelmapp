import { createHash } from "node:crypto";
import { answerGuestMessage } from "../../ai-core/index.js";
import { answerWithConversation } from "../../ai-core/conversation/runtime.js";
import { metaConversationId } from "../../ai-core/conversation/record.js";
import { performAuthorizedHandoff } from "../../ai-core/handoff-service.js";
import { sendMessengerText } from "./client.js";

const DEDUPE_TTL_MS = 24 * 60 * 60_000;
const safeId = value => createHash("sha256").update(String(value)).digest("hex").slice(0, 16);

export function messengerEvents(payload) {
  if (payload?.object !== "page" || !Array.isArray(payload.entry)) return [];
  return payload.entry.flatMap(entry => (entry.messaging || []).map(event => ({ event, pageId: String(entry.id || event?.recipient?.id || "") })));
}

export async function processMetaEvent({ event, pageId }, {
  conversationService, hmacSecret, accessToken, graphVersion, fetchImpl = fetch,
  answer = answerGuestMessage, send = sendMessengerText, logger = console
} = {}) {
  const message = event?.message;
  if (!message || message.is_echo === true || event?.sender?.id === pageId || typeof message.text !== "string" || !message.text.trim() || typeof message.mid !== "string" || !message.mid) {
    return { outcome: "ignored" };
  }
  if (!event?.sender?.id || !pageId) return { outcome: "ignored" };
  if (!conversationService?.store || !hmacSecret || !accessToken) throw new Error("meta_not_configured");

  const conversationId = metaConversationId({ platform: "messenger", pageId, senderId: event.sender.id }, hmacSecret);
  const messageId = safeId(message.mid);
  let claimed;
  try { claimed = await conversationService.store.claimIdempotencyKey("meta:messenger", messageId, DEDUPE_TTL_MS); }
  catch (cause) { throw new Error("meta_memory_unavailable", { cause }); }
  if (!claimed) {
    logger.info?.("[meta] event", { channel: "messenger", eventType: "text", conversationId, messageId, dedupe: "hit" });
    return { outcome: "duplicate" };
  }

  logger.info?.("[meta] event", { channel: "messenger", eventType: "text", conversationId, messageId, dedupe: "miss" });
  const result = await answerWithConversation({ id: conversationId, channel: "messenger", message: message.text, service: conversationService, answer, handoffService: performAuthorizedHandoff });
  if (!result.durable) throw new Error("meta_memory_unavailable", { cause: result.memoryError });
  await send({ recipientId: event.sender.id, text: result.answer, accessToken, graphVersion, fetchImpl });
  logger.info?.("[meta] reply", { channel: "messenger", conversationId, messageId, memoryWrite: true, send: "success" });
  return { outcome: "replied", conversationId };
}
