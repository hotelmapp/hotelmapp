import { randomBytes, createHmac } from "node:crypto";

export const CONVERSATION_LIMITS = Object.freeze({ slidingTtlMs: 24 * 60 * 60_000, absoluteTtlMs: 48 * 60 * 60_000, maxTurns: 20, maxRecordBytes: 48_000, maxTurnChars: 2_000 });
export const CHANNELS = Object.freeze(["web", "line", "voice"]);

export function opaqueConversationId(channel) {
  if (!CHANNELS.includes(channel)) throw new TypeError("invalid_channel");
  return `${channel}_${randomBytes(channel === "voice" ? 18 : 24).toString("base64url")}`;
}

export function lineConversationId(source, secret) {
  const type = source?.type;
  const raw = type === "user" ? source?.userId : type === "group" ? source?.groupId : type === "room" ? source?.roomId : "";
  if (!raw || !secret) throw new TypeError("missing_line_conversation_identity");
  return `line_${createHmac("sha256", secret).update(`${type}:${raw}`).digest("base64url")}`;
}

export function createConversationRecord({ id, channel, now = new Date(), limits = CONVERSATION_LIMITS }) {
  if (!id || !CHANNELS.includes(channel)) throw new TypeError("invalid_conversation_identity");
  const createdAt = now.toISOString();
  return { id, channel, turns: [], topic: null, intent: null, state: "active", pendingAction: null, handoff: { state: "none" }, revision: 0, createdAt, updatedAt: createdAt, expiresAt: new Date(now.getTime() + limits.absoluteTtlMs).toISOString() };
}

const SECRET_PATTERNS = [
  /\b(?:\d[ -]*?){13,19}\b/gu,
  /\b(?:cvv|cvc|密碼|password|passcode)\s*[:：]?\s*\S+/giu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
  /(?<!\d)(?:\+?886[- ]?)?0?9\d{2}[- ]?\d{3}[- ]?\d{3}(?!\d)/gu
];

export function minimizeConversationText(value) {
  let text = String(value || "").trim();
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "[redacted]");
  return text.slice(0, CONVERSATION_LIMITS.maxTurnChars);
}

export function appendTurn(record, turn, { now = new Date(), limits = CONVERSATION_LIMITS } = {}) {
  const next = structuredClone(record);
  const content = minimizeConversationText(turn?.content);
  if (!content || !["user", "assistant"].includes(turn?.role)) throw new TypeError("invalid_turn");
  next.turns.push({ role: turn.role, content, at: now.toISOString(), ...(turn.id ? { id: String(turn.id).slice(0, 128) } : {}) });
  next.turns = next.turns.slice(-limits.maxTurns);
  next.updatedAt = now.toISOString();
  while (Buffer.byteLength(JSON.stringify(next)) > limits.maxRecordBytes && next.turns.length > 1) next.turns.shift();
  if (Buffer.byteLength(JSON.stringify(next)) > limits.maxRecordBytes) throw new RangeError("conversation_record_too_large");
  return next;
}
