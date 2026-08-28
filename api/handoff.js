import { performAuthorizedHandoff } from "../ai-core/handoff-service.js";
import { answerWithConversation, configuredConversationService } from "../ai-core/conversation/runtime.js";

export const config = { maxDuration: 20 };

export async function processVoiceHandoff({ conversationId, message }, {
  service = configuredConversationService(),
  answer,
  route,
  handoffService = performAuthorizedHandoff,
  claimDelivery
} = {}) {
  if (!conversationId || !message) throw new Error("invalid_voice_handoff");
  const record = await service.store.get(conversationId);
  if (!record || record.channel !== "voice") throw new Error("conversation_not_found");
  return answerWithConversation({
    id: conversationId, channel: "voice", message, service,
    ...(answer ? { answer } : {}),
    ...(route ? { route } : {}),
    handoffService,
    ...(claimDelivery ? { claimDelivery } : {})
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const message = typeof req.body?.message === "string" ? req.body.message.trim().slice(0, 2_000) : "";
  const channel = req.body?.channel === "voice" ? "voice" : "";
  if (!message) return res.status(400).json({ error: "Invalid message" });
  if (!channel) return res.status(400).json({ error: "Invalid channel" });
  const id = typeof req.body?.conversationId === "string" && /^voice_[A-Za-z0-9_-]{20,80}$/.test(req.body.conversationId) ? req.body.conversationId : "";
  try {
    if (!id) throw new Error("missing_conversation_identity");
    const result = await processVoiceHandoff({ conversationId: id, message });
    return res.status(200).json({
      attempted: ["sent", "failed", "delivery_uncertain"].includes(result.handoff?.state),
      delivered: result.handoff?.state === "sent",
      answer: result.answer
    });
  } catch {
    return res.status(503).json({ attempted: false, delivered: false, answer: "目前無法安全確認語音對話狀態，因此尚未執行轉接。請直接聯絡櫃檯。" });
  }
}
