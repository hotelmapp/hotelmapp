import { performHandoff } from "../ai-core/handoff-service.js";
import { configuredConversationService } from "../ai-core/conversation/runtime.js";

export const config = { maxDuration: 20 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const message = typeof req.body?.message === "string" ? req.body.message.trim().slice(0, 2_000) : "";
  const channel = ["web", "line", "voice"].includes(req.body?.channel) ? req.body.channel : "web";
  if (!message) return res.status(400).json({ error: "Invalid message" });
  let history = req.body?.history;
  if (channel === "voice") {
    const id = typeof req.body?.conversationId === "string" && /^voice_[A-Za-z0-9_-]{20,80}$/.test(req.body.conversationId) ? req.body.conversationId : "";
    try {
      if (!id) throw new Error("missing_conversation_identity");
      const service = configuredConversationService();
      const record = await service.store.get(id);
      if (!record) throw new Error("conversation_not_found");
      history = record.turns;
    } catch {
      return res.status(503).json({ attempted: false, delivered: false, answer: "目前無法安全確認語音對話狀態，因此尚未執行轉接。請直接聯絡櫃檯。" });
    }
  }
  const result = await performHandoff({ message, channel, history });
  return res.status(200).json({ attempted: result.attempted, delivered: result.delivered, answer: result.answer });
}
