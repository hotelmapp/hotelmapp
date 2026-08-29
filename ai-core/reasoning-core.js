import { KNOWLEDGE_VERSION } from "./knowledge.js";

export const REASONING_CORE_VERSION = "2.0";
export const CUSTOMER_CHANNELS = Object.freeze(["web", "line", "messenger", "instagram", "voice"]);

export const CAPABILITY_REGISTRY = Object.freeze({
  answer_information: Object.freeze({ kind: "read", authorization: "none", executor: null }),
  contact_front_desk: Object.freeze({ kind: "action", authorization: "confirmed", executor: "handoff" })
});

function flatten(value, prefix, output = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${prefix}[${index}]`, output));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => flatten(item, prefix ? `${prefix}.${key}` : key, output));
  } else {
    output.push(Object.freeze({
      id: prefix, value: value ?? null,
      certainty: value === null || value === undefined ? "unknown" : "confirmed",
      source: `hotel_knowledge_v${KNOWLEDGE_VERSION}`
    }));
  }
  return output;
}

export function groundedFactSet(facts) {
  return Object.freeze(flatten(facts || {}, ""));
}

export function availableCapabilities({ identity, authorization } = {}) {
  return Object.freeze(Object.entries(CAPABILITY_REGISTRY).filter(([, capability]) =>
    capability.authorization === "none" || (identity && authorization?.state === capability.authorization)
  ).map(([name]) => name));
}

export async function executeCapability(name, { available, execute } = {}) {
  if (name === "none") return Object.freeze({ name, status: "not_requested" });
  if (!CAPABILITY_REGISTRY[name] || !available?.includes(name)) return Object.freeze({ name, status: "denied" });
  if (typeof execute !== "function") return Object.freeze({ name, status: "not_executed" });
  const result = await execute(name);
  return Object.freeze({ name, status: result?.status === "completed" ? "completed" : "failed", ...(result?.receipt ? { receipt: result.receipt } : {}) });
}

const COMPLETION_CLAIM = /(?:已(?:經)?(?:幫您)?(?:完成|處理|預留|保留|通知|送出|取消|修改)|(?:completed|reserved|notified|cancelled) (?:it|this|your))/iu;

function numericAtoms(value) {
  return (String(value ?? "").match(/\d[\d,]*/gu) || []).map(token => {
    const digits = token.replace(/,/g, "");
    const normalized = digits.replace(/^0+(?=\d)/u, "");
    return normalized || "0";
  });
}

function compositeNumericClaims(value) {
  const text = String(value ?? "");
  const claims = [];
  for (const match of text.matchAll(/(\d{4})\s*(?:-|\/|年)\s*(\d{1,2})\s*(?:-|\/|月)\s*(\d{1,2})(?:\s*日)?/gu)) {
    claims.push(`date:${Number(match[1])}-${Number(match[2])}-${Number(match[3])}`);
    claims.push(`month-day:${Number(match[2])}-${Number(match[3])}`);
  }
  for (const match of text.matchAll(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/gu)) {
    claims.push(`month-day:${Number(match[1])}-${Number(match[2])}`);
  }
  for (const match of text.matchAll(/NT\$\s*(\d[\d,]*)/giu)) claims.push(`money:${Number(match[1].replace(/,/g, ""))}`);
  for (const match of text.matchAll(/(?<!\d)(\d{1,2})[:：](\d{2})(?!\d)/gu)) claims.push(`time:${Number(match[1])}:${Number(match[2])}`);
  return claims;
}

export function verifyFinalResponse({ answer, selectedFacts = [], toolResult }) {
  if (typeof answer !== "string" || !answer.trim()) return { valid: false, reason: "empty_answer" };
  if (COMPLETION_CLAIM.test(answer) && toolResult?.status !== "completed") return { valid: false, reason: "unverified_action_claim" };
  const allowedTokens = new Set(selectedFacts.filter(f => f.certainty === "confirmed").flatMap(f => numericAtoms(f.value)));
  const assertedTokens = numericAtoms(answer);
  if (assertedTokens.some(token => !allowedTokens.has(token))) return { valid: false, reason: "unsupported_numeric_fact" };
  const allowedClaims = new Set(selectedFacts.filter(f => f.certainty === "confirmed").flatMap(f => compositeNumericClaims(f.value)));
  const assertedClaims = compositeNumericClaims(answer);
  if (assertedClaims.some(claim => !allowedClaims.has(claim))) return { valid: false, reason: "unsupported_numeric_fact" };
  return { valid: true };
}

export function responseProvenance({ grounding, selectedFacts, capability, toolResult }) {
  return Object.freeze({
    reasoningVersion: REASONING_CORE_VERSION,
    knowledgeVersion: KNOWLEDGE_VERSION,
    topic: grounding?.topic || "unknown",
    facts: Object.freeze(selectedFacts.map(({ id, certainty, source }) => Object.freeze({ id, certainty, source }))),
    capability: capability || "none",
    toolStatus: toolResult?.status || "not_requested"
  });
}

export function presentForChannel(result, channel) {
  if (!CUSTOMER_CHANNELS.includes(channel)) throw new Error("unsupported_channel");
  // Presentation may format transport payloads, but never edits core answer or provenance.
  return Object.freeze({ channel, answer: result.answer, provenance: result.provenance });
}
