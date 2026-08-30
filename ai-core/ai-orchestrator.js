import { detectGuestLanguage } from "../guest-language.js";
import { KNOWLEDGE_VERSION } from "./knowledge.js";
import { CORE_PERSONALITY_CONTRACT_VERSION, styledInstructions } from "./hospitality-personality.js";
import { requestGroundedResponse } from "./response-service.js";
import { availableCapabilities, responseProvenance } from "./reasoning-core.js";
import { configuredReasoning, configuredTextModel, DEFAULT_ROUTING_REASONING_EFFORT, DEFAULT_TEXT_REASONING_EFFORT } from "./model-config.js";
import { validateUnifiedReply } from "./reply-quality.js";
import { parseQualityReview, qualityReviewEnabled, qualityReviewPayload } from "./conversation-quality-review.js";

export const AI_FIRST_FEATURE_FLAG = "AI_FIRST_ORCHESTRATOR_ENABLED";
export const ORCHESTRATION_VERSION = "3.2";
const MAX_DECISION_FACTS = 64;

export const MODEL_DECISION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["intent", "user_need", "facts_to_use", "action", "clarification_needed", "next_step", "response_strategy"],
  properties: {
    intent: { type: "string", enum: ["multiple", "subsidy_overview", "subsidy_participation", "subsidy_date_applicability", "subsidy_amount", "subsidy_period", "subsidy_booking_channel", "subsidy_participation_limit", "subsidy_birthday_voucher", "subsidy_taiwan_pass", "subsidy_stacking", "subsidy_registration", "subsidy_documentation", "subsidy_eligibility", "subsidy_third_night", "booking_direct", "booking_availability", "booking_modify_cancel", "parking_availability", "parking_fee", "parking_partner_location", "parking_location", "parking_process", "parking_reservation", "parking_problem", "wifi", "check_in", "front_desk_contact", "check_out", "late_checkout", "breakfast", "luggage", "room_type", "baby_equipment", "transportation", "cancellation", "payment", "complaint", "unknown"] },
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
  const configured = env?.[AI_FIRST_FEATURE_FLAG]?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false" || configured) return false;
  return Boolean(env?.OPENAI_API_KEY?.trim());
}

export function groundingFactEntries(grounding) {
  const output = [];
  const visit = (value, path) => {
    if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${path}[${index}]`));
    else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => visit(item, path ? `${path}.${key}` : key));
    else output.push({
      id: path,
      value: value ?? null,
      certainty: value == null ? "unknown" : "confirmed",
      source: path.startsWith("requestContext.") ? "current_user_message" : `hotel_knowledge_v${KNOWLEDGE_VERSION}`
    });
  };
  visit(grounding?.facts || {}, "");
  return output;
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
  if (value.response_strategy === "unknown" && value.facts_to_use.some(id => !allowedFactIds.has(id))) return false;
  return !(value.response_strategy === "tool_then_answer" && value.action === "none");
}

export function toolPermissions({ identity, authorization } = {}) {
  const available = availableCapabilities({ identity, authorization });
  return Object.freeze({
    none: true,
    contact_front_desk: available.includes("contact_front_desk")
  });
}

function parseDecision(answer, context) {
  let value;
  try { value = JSON.parse(answer); } catch { throw new Error("invalid_model_decision_json"); }
  if (!validateModelDecision(value, context)) throw new Error("invalid_model_decision");
  return Object.freeze(value);
}

function decisionPayload({ message, history, grounding, facts, channel, availableTools, env }) {
  const model = configuredTextModel(env, "OPENAI_ORCHESTRATOR_MODEL");
  const payload = {
    model,
    max_output_tokens: 900,
    ...configuredReasoning(model, env, {
      componentKeys: ["OPENAI_ORCHESTRATOR_DECISION_REASONING_EFFORT", "OPENAI_ORCHESTRATOR_REASONING_EFFORT"],
      fallback: DEFAULT_ROUTING_REASONING_EFFORT
    }),
    instructions: `You are HotelMapp's service decision core. Return only the required JSON. First understand the complete current sentence: subject, object, time, negation, conditions, and every explicit request. A single ambiguous word must never override stronger context; in particular, the word 折抵 alone does not mean parking. Use recent history only to resolve omitted subjects. If the current message contains multiple independent or relational hotel topics, use intent=multiple and select facts for every relevant part. If the relationship asked about is absent from the supplied facts, mark clarification_needed=true or response_strategy=unknown rather than guessing. Select only fact IDs supplied below. Unknown facts stay unknown. Never infer hotel facts. Tool availability is a hard permission boundary.`,
    input: JSON.stringify({ current_user_message: message, recent_history: history, grounded_facts: facts, grounding_contract: grounding.contract, available_tools: availableTools, channel }),
    text: { format: { type: "json_schema", name: "hospitality_decision", strict: true, schema: MODEL_DECISION_SCHEMA } }
  };
  return payload;
}

export function decisionFromGrounding({ message, grounding, facts }) {
  if (!grounding?.semanticRoute) return null;
  const required = Array.isArray(grounding.contract?.requiredFactIds) ? grounding.contract.requiredFactIds : [];
  const scopedFacts = required.length
    ? facts.filter(fact => required.some(id => fact.id === id || fact.id.startsWith(`${id}.`) || fact.id.startsWith(`${id}[`)))
    : facts;
  const factIds = (scopedFacts.length ? scopedFacts : facts).slice(0, MAX_DECISION_FACTS).map(fact => fact.id);
  return Object.freeze({
    intent: grounding.intent || (grounding.topic === "multi" ? "multiple" : grounding.topic || "unknown"),
    user_need: grounding.semanticRoute.currentNeed || String(message || "").slice(0, 240),
    facts_to_use: factIds,
    action: "none",
    clarification_needed: Boolean(grounding.semanticRoute.clarificationNeeded),
    next_step: null,
    response_strategy: grounding.topic === "unknown" ? "unknown" : grounding.semanticRoute.clarificationNeeded ? "clarify" : "answer"
  });
}

function prosePayload({ message, history, grounding, decision, selectedFacts, toolResult, channel, correction = null, env }) {
  const language = detectGuestLanguage(message, history);
  const model = configuredTextModel(env, "OPENAI_ORCHESTRATOR_MODEL");
  return {
    model,
    max_output_tokens: 900,
    ...configuredReasoning(model, env, {
      componentKeys: ["OPENAI_ORCHESTRATOR_PROSE_REASONING_EFFORT", "OPENAI_ORCHESTRATOR_REASONING_EFFORT"],
      fallback: DEFAULT_TEXT_REASONING_EFFORT
    }),
    instructions: `${styledInstructions(channel)}

You are the one unified answer composer for every ordinary HotelMapp guest question. Use only selected_grounded_facts and successful tool_result as hotel truth. A fact with certainty=unknown must be described as unconfirmed and must not be guessed. Do not claim an action happened unless tool_result.status is completed. Answer in ${language}.

Understand the guest's complete current wording before writing. Resolve a yes/no or negative question directly in the first few words; for example, 「你們沒有參加補助嗎？」 must begin with a natural direct answer such as 「有參加喔，」 before dates or rules. A location, cost, time, or process question must lead with that requested information. Use only the details needed for the current need; do not dump every available fact, policy, or disclaimer. A simple question normally needs one or two short sentences. Cover all explicit needs in a multi-topic message, preserve conditions and relationships, and answer a follow-up with only the new information instead of replaying the previous answer.

For subsidy_date_applicability, distinguish the published calendar rule from personal eligibility. If requestContext.requestedStayDate is unknown, acknowledge the exact concern, state the Sunday-through-Thursday rule and the Friday/Saturday/national-long-holiday exclusions, then ask only for the actual check-in date. If the date is known, answer its calendar applicability first from the campaign period, derived weekday, and published exclusion; only then note that personal qualification and allowance still require the government system. Never use a government-system disclaimer as the whole answer.

Warmth must come from understanding the current need and natural service wording, not from adding a bare 「了解」、「好的」、「可以的」 or a lone polite word such as 「請」 before a database-like sentence. In a follow-up that expresses a concern or condition, naturally reflect that concern before giving the useful rule or next step. When a result cannot be guaranteed, acknowledge what the guest is trying to confirm, explain the uncertainty in plain language, and offer the part that can be checked; do not send a policy disclaimer by itself.

Before finalizing, read the complete reply aloud and give it a natural Taiwanese front-desk ending. Choose the ending from the actual speech act and tone: 「有喔」 for a true availability answer, 「好的，沒問題」 only when accepting an assistance request that can really be performed, 「不好意思」 plus a considerate ending for a limit, or 「謝謝您」 only when gratitude or conversation closure fits. A light final 喔／呢／～ or one short service continuation is welcome in ordinary friendly chat, but never append the same particle or stock sentence to every reply. Questions about cost, time, place, or process must still lead with the answer and must not start with irrelevant 「可以喔」. Complaints, payment problems, failures, and urgent situations require a calm supportive close with no cheerful particle. The final wording must not add facts, promises, actions, or a forced follow-up question. Do not add the first-turn greeting here because the shared finalizer owns it.${correction ? `\n\nYour previous answer was rejected for ${correction.reason}. ${correction.guidance ? `Independent reviewer guidance: ${JSON.stringify(correction.guidance)}. ` : ""}Correct that exact issue while preserving all verified facts. Previous rejected answer: ${JSON.stringify(correction.answer)}` : ""}`,
    input: JSON.stringify({ current_user_message: message, recent_history: history, semantic_route: grounding?.semanticRoute || null, verified_decision: decision, selected_grounded_facts: selectedFacts, tool_result: toolResult })
  };
}

export async function orchestrateHospitalityTurn({ message, history = [], grounding, channel = "web", identity, authorization, executeTool, request = requestGroundedResponse, logger = console, env = process.env }) {
  const started = Date.now();
  safeLog(logger, "orchestration_started", { channel, topic: grounding?.topic });
  if (!grounding?.topic) grounding = { topic: "unknown", intent: "unknown", facts: { unknown: null }, contract: { historyPolicy: "references_only" } };
  const facts = groundingFactEntries(grounding);
  if (!facts.length) facts.push({ id: "unknown", value: null, certainty: "unknown", source: `hotel_knowledge_v${KNOWLEDGE_VERSION}` });
  safeLog(logger, "grounding_completed", { topic: grounding.topic, factCount: facts.length, knowledgeVersion: KNOWLEDGE_VERSION });
  const permissions = toolPermissions({ identity, authorization });
  const availableTools = Object.entries(permissions).filter(([, allowed]) => allowed).map(([name]) => name);
  const allowedFactIds = new Set(facts.map(fact => fact.id));
  let decision = decisionFromGrounding({ message, grounding, facts });
  if (decision) {
    safeLog(logger, "semantic_plan_reused", { intent: decision.intent, selectedFactCount: decision.facts_to_use.length });
  } else {
    const decisionResponse = await request({ payload: decisionPayload({ message, history, grounding, facts, channel, availableTools, env }) });
    decision = parseDecision(decisionResponse.answer, { allowedFactIds, allowedTools: availableTools });
  }
  safeLog(logger, "model_decision_completed", { intent: decision.intent, strategy: decision.response_strategy, selectedFactCount: decision.facts_to_use.length });
  let toolResult = { name: "none", status: "not_requested" };
  if (decision.action !== "none") {
    safeLog(logger, "tool_requested", { tool: decision.action });
    if (!permissions[decision.action]) throw new Error("tool_permission_denied");
    toolResult = await executeTool?.(decision.action) || { name: decision.action, status: "not_executed" };
    safeLog(logger, "tool_completed", { tool: decision.action, status: toolResult.status });
  }
  const selectedFacts = decision.facts_to_use.map(id => facts.find(fact => fact.id === id));
  let composed;
  let correction = null;
  let qualityReview = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    composed = await request({ payload: prosePayload({ message, history, grounding, decision, selectedFacts, toolResult, channel, correction, env }) });
    if (!composed.answer?.trim()) throw new Error("empty_composed_response");
    const verification = validateUnifiedReply({ answer: composed.answer, message, history, grounding, selectedFacts, toolResult });
    if (!verification.valid) {
      if (attempt === 1) throw new Error(verification.reason);
      correction = { reason: verification.reason, answer: composed.answer.trim() };
      safeLog(logger, "response_retry", { reason: verification.reason });
      continue;
    }
    if (!qualityReviewEnabled(env)) break;
    try {
      const reviewed = await request({
        payload: qualityReviewPayload({ message, history, grounding, decision, selectedFacts, toolResult, proposedAnswer: composed.answer, channel, env }),
        apiKey: env.OPENAI_API_KEY?.trim()
      });
      qualityReview = parseQualityReview(reviewed.answer);
      safeLog(logger, "quality_review_completed", { verdict: qualityReview.verdict, issueCount: qualityReview.issues.length });
    } catch (error) {
      safeLog(logger, "quality_review_unavailable", { code: safeErrorCode(error) });
      qualityReview = null;
      break;
    }
    if (qualityReview.verdict === "pass") break;
    if (attempt === 1) throw new Error(`quality_review_${qualityReview.issues[0] || "rejected"}`);
    correction = {
      reason: `quality_review:${qualityReview.issues.join(",")}`,
      guidance: qualityReview.rewrite_guidance,
      answer: composed.answer.trim()
    };
    safeLog(logger, "response_retry", { reason: "quality_review", issues: qualityReview.issues });
  }
  const provenance = responseProvenance({ grounding, selectedFacts, capability: decision.action, toolResult });
  safeLog(logger, "response_composed", { channel, latencyMs: Date.now() - started, personalityVersion: CORE_PERSONALITY_CONTRACT_VERSION });
  return { answer: composed.answer.trim(), decision, selectedFacts, toolResult, qualityReview, provenance };
}

export async function tryAiFirstReasoning(options) {
  if (!aiFirstEnabled(options.env)) return null;
  try { return await (options.orchestrate || orchestrateHospitalityTurn)(options); }
  catch (error) {
    const code = safeErrorCode(error);
    safeLog(options.logger || console, "orchestration_failed", { stage: options.grounding?.topic || "unknown", code });
    safeLog(options.logger || console, "ai_fallback_used", { topic: options.grounding?.topic || "unknown", reason: code });
    return null;
  }
}

export async function tryAiFirstParking(options) {
  return tryAiFirstReasoning(options);
}
