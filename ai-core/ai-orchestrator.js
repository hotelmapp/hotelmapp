import { detectGuestLanguage } from "../guest-language.js";
import { KNOWLEDGE_VERSION } from "./knowledge.js";
import { CORE_PERSONALITY_CONTRACT_VERSION, styledInstructions } from "./hospitality-personality.js";
import { requestGroundedResponse } from "./response-service.js";

export const AI_FIRST_FEATURE_FLAG = "AI_FIRST_ORCHESTRATOR_ENABLED";
export const ORCHESTRATION_VERSION = "1.0";
const MAX_DECISION_FACTS = 6;

export const MODEL_DECISION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["intent", "user_need", "facts_to_use", "action", "clarification_needed", "next_step", "response_strategy"],
  properties: {
    intent: { type: "string", enum: ["parking_availability", "parking_fee", "parking_location", "parking_process", "parking_reservation", "parking_problem"] },
    user_need: { type: "string", minLength: 1, maxLength: 240 },
    facts_to_use: { type: "array", maxItems: MAX_DECISION_FACTS, items: { type: "string", minLength: 1, maxLength: 120 } },
    action: { type: "string", enum: ["none", "contact_front_desk"] },
    clarification_needed: { type: "boolean" },
    next_step: { type: ["string", "null"], maxLength: 240 },
    response_strategy: { type: "string", enum: ["answer", "clarify", "unknown", "tool_then_answer"] }
  }
});

function safeLog(logger, event, fields = {}) {
  logger?.info?.("[ai-orchestrator]", { event, orchestrationVersion: ORCHESTRATION_VERSION, ...fields });
}

function safeErrorCode(error) {
  const candidate = error?.code || error?.message;
  return typeof candidate === "string" && /^[a-z0-9_]{1,64}$/i.test(candidate) ? candidate : "orchestration_error";
}

export function aiFirstEnabled(env = process.env) {
  return env?.[AI_FIRST_FEATURE_FLAG]?.trim().toLowerCase() === "true";
}

export function groundingFactEntries(grounding) {
  if (grounding?.topic !== "parking" || !grounding.facts?.parking) return [];
  return Object.entries(grounding.facts.parking).map(([key, value]) => ({
    id: `parking.${key}`,
    value,
    certainty: value === null || value === undefined ? "unknown" : "confirmed",
    source: `hotel_knowledge_v${KNOWLEDGE_VERSION}`
  }));
}

export function validateModelDecision(value, { allowedFactIds, allowedTools = ["none"] }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(MODEL_DECISION_SCHEMA.properties);
  if (Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) return false;
  if (!MODEL_DECISION_SCHEMA.properties.intent.enum.includes(value.intent)) return false;
  if (typeof value.user_need !== "string" || !value.user_need.trim() || value.user_need.length > 240) return false;
  if (!Array.isArray(value.facts_to_use) || value.facts_to_use.length > MAX_DECISION_FACTS || value.facts_to_use.some(id => typeof id !== "string" || !allowedFactIds.has(id))) return false;
  if (!allowedTools.includes(value.action)) return false;
  if (typeof value.clarification_needed !== "boolean") return false;
  if (value.next_step !== null && (typeof value.next_step !== "string" || value.next_step.length > 240)) return false;
  if (!MODEL_DECISION_SCHEMA.properties.response_strategy.enum.includes(value.response_strategy)) return false;
  if (value.response_strategy === "unknown" && !value.facts_to_use.some(id => id.endsWith("reservationRequired"))) return false;
  return !(value.response_strategy === "tool_then_answer" && value.action === "none");
}

export function toolPermissions({ identity, authorization } = {}) {
  return Object.freeze({
    none: true,
    contact_front_desk: Boolean(identity && authorization?.state === "confirmed")
  });
}

function parseDecision(answer, context) {
  let value;
  try { value = JSON.parse(answer); } catch { throw new Error("invalid_model_decision_json"); }
  if (!validateModelDecision(value, context)) throw new Error("invalid_model_decision");
  return Object.freeze(value);
}

function decisionPayload({ message, history, grounding, facts, channel, availableTools }) {
  const payload = {
    model: process.env.OPENAI_ORCHESTRATOR_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
    max_output_tokens: 500,
    instructions: `You are HotelMapp's service decision core. Return only the required JSON. Understand topic continuity and omitted subjects from history. Select only fact IDs supplied below. Unknown facts stay unknown. Never infer hotel facts. Tool availability is a hard permission boundary.`,
    input: JSON.stringify({ current_user_message: message, recent_history: history, grounded_facts: facts, grounding_contract: grounding.contract, available_tools: availableTools, channel }),
    text: { format: { type: "json_schema", name: "hospitality_decision", strict: true, schema: MODEL_DECISION_SCHEMA } }
  };
  const effort = process.env.OPENAI_ORCHESTRATOR_REASONING_EFFORT?.trim();
  if (effort) payload.reasoning = { effort };
  return payload;
}

function prosePayload({ message, history, decision, selectedFacts, toolResult, channel }) {
  const language = detectGuestLanguage(message, history);
  return {
    model: process.env.OPENAI_ORCHESTRATOR_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
    max_output_tokens: 350,
    instructions: `${styledInstructions(channel)}\nUse only selected_grounded_facts and successful tool_result as hotel truth. A fact with certainty=unknown must be described as unconfirmed and must not be guessed. Do not claim an action happened unless tool_result.status is completed. Answer in ${language}. Address the current need first, avoid repeating prior detail, and do not force a follow-up question.`,
    input: JSON.stringify({ current_user_message: message, recent_history: history, verified_decision: decision, selected_grounded_facts: selectedFacts, tool_result: toolResult })
  };
}

export async function orchestrateHospitalityTurn({ message, history = [], grounding, channel = "web", identity, authorization, executeTool, request = requestGroundedResponse, logger = console }) {
  const started = Date.now();
  safeLog(logger, "orchestration_started", { channel, topic: grounding?.topic });
  const facts = groundingFactEntries(grounding);
  if (!facts.length) throw new Error("unsupported_orchestration_topic");
  safeLog(logger, "grounding_completed", { topic: grounding.topic, factCount: facts.length, knowledgeVersion: KNOWLEDGE_VERSION });
  const permissions = toolPermissions({ identity, authorization });
  const availableTools = Object.entries(permissions).filter(([, allowed]) => allowed).map(([name]) => name);
  const allowedFactIds = new Set(facts.map(fact => fact.id));
  const decisionResponse = await request({ payload: decisionPayload({ message, history, grounding, facts, channel, availableTools }) });
  const decision = parseDecision(decisionResponse.answer, { allowedFactIds, allowedTools: availableTools });
  safeLog(logger, "model_decision_completed", { intent: decision.intent, strategy: decision.response_strategy, selectedFactCount: decision.facts_to_use.length });
  let toolResult = { name: "none", status: "not_requested" };
  if (decision.action !== "none") {
    safeLog(logger, "tool_requested", { tool: decision.action });
    if (!permissions[decision.action]) throw new Error("tool_permission_denied");
    toolResult = await executeTool?.(decision.action) || { name: decision.action, status: "not_executed" };
    safeLog(logger, "tool_completed", { tool: decision.action, status: toolResult.status });
  }
  const selectedFacts = decision.facts_to_use.map(id => facts.find(fact => fact.id === id));
  const composed = await request({ payload: prosePayload({ message, history, decision, selectedFacts, toolResult, channel }) });
  if (!composed.answer?.trim()) throw new Error("empty_composed_response");
  safeLog(logger, "response_composed", { channel, latencyMs: Date.now() - started, personalityVersion: CORE_PERSONALITY_CONTRACT_VERSION });
  return { answer: composed.answer.trim(), decision, selectedFacts, toolResult };
}

export async function tryAiFirstParking(options) {
  if (!aiFirstEnabled(options.env)) return null;
  try { return await (options.orchestrate || orchestrateHospitalityTurn)(options); }
  catch (error) {
    const code = safeErrorCode(error);
    safeLog(options.logger || console, "orchestration_failed", { stage: "parking", code });
    safeLog(options.logger || console, "ai_fallback_used", { topic: "parking", reason: code });
    return null;
  }
}
