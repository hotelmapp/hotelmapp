import { performHandoff } from "../ai-core/handoff-service.js";

export const config = { maxDuration: 20 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const message = typeof req.body?.message === "string" ? req.body.message.trim().slice(0, 2_000) : "";
  const channel = ["web", "line", "voice"].includes(req.body?.channel) ? req.body.channel : "web";
  if (!message) return res.status(400).json({ error: "Invalid message" });
  const result = await performHandoff({ message, channel, history: req.body?.history });
  return res.status(200).json({ attempted: result.attempted, delivered: result.delivered, answer: result.answer });
}
