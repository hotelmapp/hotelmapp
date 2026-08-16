import { configuredConversationService } from "../ai-core/conversation/runtime.js";

export const config = { maxDuration: 10 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const id = typeof req.body?.conversationId === "string" && /^voice_[A-Za-z0-9_-]{20,80}$/.test(req.body.conversationId) ? req.body.conversationId : "";
  const role = ["user", "assistant"].includes(req.body?.role) ? req.body.role : "";
  const content = typeof req.body?.content === "string" ? req.body.content : "";
  if (!id || !role || !content.trim()) return res.status(400).json({ error: "Invalid conversation turn" });
  try {
    const service = configuredConversationService();
    if (!await service.store.get(id)) return res.status(404).json({ error: "Conversation not found" });
    await service.append(id, "voice", [{ role, content }]);
    return res.status(204).end();
  } catch {
    return res.status(503).json({ error: "Conversation memory unavailable" });
  }
}
