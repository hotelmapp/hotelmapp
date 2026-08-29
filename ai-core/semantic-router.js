import { explicitTopics, groundingForTopics, resolveKnowledgeGrounding } from "./knowledge-grounding.js";
import { requestGroundedResponse } from "./response-service.js";
import { HANDOFF_CATEGORY_NAMES } from "./handoff.js";
import { configuredReasoning, configuredTextModel, DEFAULT_ROUTING_REASONING_EFFORT } from "./model-config.js";

export const SEMANTIC_ROUTER_VERSION = "2.1";
export const SEMANTIC_ROUTER_FEATURE_FLAG = "SEMANTIC_ROUTER_ENABLED";

const MAX_HISTORY_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 2_000;
const DEFAULT_TIMEOUT_MS = 5_000;

const INTENTS_BY_TOPIC = Object.freeze({
  breakfast: ["breakfast"],
  parking: ["parking_availability", "parking_fee", "parking_partner_location", "parking_location", "parking_process", "parking_reservation", "parking_problem"],
  subsidy: ["subsidy_overview", "subsidy_participation", "subsidy_amount", "subsidy_period", "subsidy_booking_channel", "subsidy_participation_limit", "subsidy_birthday_voucher", "subsidy_taiwan_pass", "subsidy_stacking", "subsidy_registration", "subsidy_documentation", "subsidy_eligibility", "subsidy_third_night"],
  booking: ["booking_direct", "booking_availability", "booking_modify_cancel"],
  wifi: ["wifi"],
  check_in: ["check_in"],
  front_desk_contact: ["front_desk_contact"],
  late_checkout: ["late_checkout"],
  check_out: ["check_out"],
  luggage: ["luggage"],
  room_type: ["room_type"],
  baby_equipment: ["baby_equipment"],
  transportation: ["transportation"],
  cancellation: ["cancellation"],
  payment: ["payment"],
  complaint: ["complaint"],
  unknown: ["unknown"]
});

const TOPICS = Object.freeze(Object.keys(INTENTS_BY_TOPIC));
const INTENTS = Object.freeze([...new Set(Object.values(INTENTS_BY_TOPIC).flat())]);

export const SEMANTIC_ROUTE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["routes", "current_need", "uses_history", "clarification_needed", "handoff"],
  properties: {
    routes: {
      type: "array", minItems: 1, maxItems: 5,
      items: {
        type: "object", additionalProperties: false, required: ["topic", "intent"],
        properties: {
          topic: { type: "string", enum: TOPICS },
          intent: { type: "string", enum: INTENTS }
        }
      }
    },
    current_need: { type: "string", minLength: 1, maxLength: 240 },
    uses_history: { type: "boolean" },
    clarification_needed: { type: "boolean" },
    handoff: {
      type: "object", additionalProperties: false, required: ["requested", "category"],
      properties: {
        requested: { type: "boolean" },
        category: { type: ["string", "null"], enum: [null, ...HANDOFF_CATEGORY_NAMES] }
      }
    }
  }
});

export function semanticRouterEnabled(env = process.env) {
  return env?.[SEMANTIC_ROUTER_FEATURE_FLAG]?.trim().toLowerCase() !== "false";
}

function normalizedHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(turn => turn && (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string")
    .map(turn => ({ role: turn.role, content: turn.content.trim().slice(0, MAX_MESSAGE_LENGTH) }))
    .filter(turn => turn.content)
    .slice(-MAX_HISTORY_MESSAGES);
}

export function validateSemanticRoute(value, message = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const allowedKeys = Object.keys(SEMANTIC_ROUTE_SCHEMA.properties);
  if (Object.keys(value).some(key => !allowedKeys.includes(key)) || allowedKeys.some(key => !(key in value))) return false;
  if (!Array.isArray(value.routes) || value.routes.length < 1 || value.routes.length > 5) return false;
  if (typeof value.current_need !== "string" || !value.current_need.trim() || value.current_need.length > 240) return false;
  if (typeof value.uses_history !== "boolean" || typeof value.clarification_needed !== "boolean") return false;
  if (!value.handoff || typeof value.handoff !== "object" || Array.isArray(value.handoff)) return false;
  if (Object.keys(value.handoff).length !== 2 || typeof value.handoff.requested !== "boolean") return false;
  if (value.handoff.requested ? !HANDOFF_CATEGORY_NAMES.includes(value.handoff.category) : value.handoff.category !== null) return false;

  const seen = new Set();
  for (const route of value.routes) {
    if (!route || typeof route !== "object" || Array.isArray(route)) return false;
    if (Object.keys(route).length !== 2 || !Object.hasOwn(INTENTS_BY_TOPIC, route.topic) || !INTENTS_BY_TOPIC[route.topic].includes(route.intent)) return false;
    if (seen.has(route.topic)) return false;
    seen.add(route.topic);
  }
  if (seen.has("unknown") && seen.size > 1) return false;

  // A complete current sentence is a hard boundary against stale history. A
  // route must retain at least one clear topic from the current message, while
  // still allowing the model to exclude a negated mention, add an implied need,
  // or choose unknown when every recognized word was explicitly rejected.
  const currentTopics = explicitTopics(message);
  if (currentTopics.length && !seen.has("unknown") && !currentTopics.some(topic => seen.has(topic))) return false;
  return true;
}

function parseSemanticRoute(answer, message) {
  let value;
  try { value = JSON.parse(answer); } catch { throw new Error("invalid_semantic_route_json"); }
  if (!validateSemanticRoute(value, message)) throw new Error("invalid_semantic_route");
  return value;
}

export function semanticRoutePayload(message, history = [], env = process.env) {
  const model = configuredTextModel(env, "OPENAI_ROUTER_MODEL");
  return {
    model,
    max_output_tokens: 800,
    ...configuredReasoning(model, env, {
      componentKeys: ["OPENAI_ROUTER_REASONING_EFFORT"],
      fallback: DEFAULT_ROUTING_REASONING_EFFORT
    }),
    instructions: `You are HotelMapp's semantic conversation router. Return only the required JSON; do not answer the guest and do not invent hotel facts. Understand the complete CURRENT message first: subject, object, requested action, time, negation, condition, and all distinct needs. The current message always outranks stored or older topics. Use recent history only to resolve a genuinely omitted referent.

Critical continuity rules:
- A sentence-final particle such as 呢, 嗎, or 可以嗎 does not by itself make the whole message a continuation of an old topic.
- Never skip a newer self-contained user request to recover an older topic.
- A topic that is mentioned only to reject, correct, compare, or negate it is not automatically the requested topic. Respect words such as 不是, 不要, 沒有, 除非, 只有, and their equivalents in the guest's language.
- Preserve conditions and relationships. “If X, can I Y?” is not the same question as X alone, and a comparison may require multiple routes.
- Example: after an earlier parking question and then a booking question, “可否直接跟櫃檯訂呢？” is booking_direct, never parking.
- “那第二台呢？” immediately after parking may use history and is parking_fee.
- “配合的停車場在哪邊？” and “門口滿了，特約停車場在哪裡？” are parking_partner_location. They require the partner lot's actual landmark, walking time, and plate-registration flow; never answer only with the entrance-space count.
- A question asking whether HotelMapp participates in the subsidy, including a negative form such as 「你們沒有參加國旅補助嗎？」, is subsidy_participation. It is not a request for every subsidy rule.
- The word 折抵 alone is ambiguous. Route it to parking only when the current sentence or the uninterrupted recent topic is actually about parking.
- Use unknown only when no supported topic can be determined. Use multiple routes only when the current request truly contains multiple needs.

Handoff classification is semantic and separate from answering:
- requested=true only when the guest asks hotel staff to act, contact them, handle a complaint/problem, change/cancel a reservation, address a payment dispute, find lost property, or arrange a request that requires staff confirmation.
- Questions asking only for front-desk information, such as phone number, location, or opening hours, have requested=false.
- A normal new booking or a question about how to book has requested=false unless the guest explicitly asks staff to contact or handle it.
- A short acceptance such as 好的 or 需要喔 has requested=true only when the latest assistant turn clearly offered to send the preserved request to hotel staff; use category 真人服務.
- This classification is only a recommendation to the server. It never authorizes or performs an external action.`,
    input: JSON.stringify({ current_user_message: String(message || "").slice(0, MAX_MESSAGE_LENGTH), recent_history: normalizedHistory(history) }),
    text: { format: { type: "json_schema", name: "semantic_conversation_route", strict: true, schema: SEMANTIC_ROUTE_SCHEMA } }
  };
}

function safeErrorCode(error) {
  const candidate = error?.code || error?.message;
  return typeof candidate === "string" && /^[a-z0-9_]{1,64}$/iu.test(candidate) ? candidate : "semantic_router_error";
}

export async function resolveSemanticKnowledgeGrounding(message, history = [], storedTopic = null, storedIntent = null, {
  request = requestGroundedResponse,
  env = process.env,
  logger = console
} = {}) {
  const fallback = resolveKnowledgeGrounding(message, history, storedTopic, storedIntent);
  if (!semanticRouterEnabled(env)) return fallback;
  // Unit tests and local deterministic operation do not need to manufacture an
  // upstream error when no production API key exists. Injected requests still
  // exercise the semantic path without credentials.
  if (request === requestGroundedResponse && !env.OPENAI_API_KEY?.trim()) return fallback;

  try {
    const configuredTimeout = Number.parseInt(env.SEMANTIC_ROUTER_TIMEOUT_MS || "", 10);
    const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? Math.min(configuredTimeout, 10_000) : DEFAULT_TIMEOUT_MS;
    const result = await request({
      payload: semanticRoutePayload(message, history, env),
      apiKey: env.OPENAI_API_KEY?.trim(),
      timeoutMs
    });
    const decision = parseSemanticRoute(result.answer, message);
    const knownRoutes = decision.routes.filter(route => route.topic !== "unknown");
    const topics = knownRoutes.map(route => route.topic);
    const intents = Object.fromEntries(knownRoutes.map(route => [route.topic, route.intent]));
    logger?.info?.("[semantic-router]", {
      event: "semantic_route_completed",
      routerVersion: SEMANTIC_ROUTER_VERSION,
      topicCount: topics.length,
      usedHistory: decision.uses_history,
      clarificationNeeded: decision.clarification_needed
    });
    return {
      ...groundingForTopics(message, topics, history, storedIntent, intents),
      semanticRoute: Object.freeze({
        currentNeed: decision.current_need,
        usedHistory: decision.uses_history,
        clarificationNeeded: decision.clarification_needed,
        handoff: Object.freeze({ requested: decision.handoff.requested, category: decision.handoff.category }),
        routerVersion: SEMANTIC_ROUTER_VERSION
      })
    };
  } catch (error) {
    logger?.info?.("[semantic-router]", {
      event: "semantic_route_fallback",
      routerVersion: SEMANTIC_ROUTER_VERSION,
      errorCode: safeErrorCode(error)
    });
    return fallback;
  }
}
