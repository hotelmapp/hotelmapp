import { answerGuestMessage } from "../guest-response.js";
import { decideHandoff, resolveHandoffDecision } from "../handoff.js";
import { advanceHandoffAuthorization, performAuthorizedHandoff } from "../handoff-service.js";
import { resolveAiFirstHandoffDecision } from "../handoff-resolution-review.js";
import { ConversationService } from "./service.js";
import { conversationStoreFromEnv } from "./store.js";
import { resolveSemanticKnowledgeGrounding } from "../semantic-router.js";
import { temporalContextProvider } from "../temporal-context.js";

const memoryUnavailableHandoff = async () => ({
  attempted: true, delivered: false,
  answer: "目前無法安全確認這段對話的狀態，因此尚未替您送出或執行任何轉接需求。請直接聯絡櫃檯協助。"
});
const HANDOFF_DEDUPE_TTL_MS = 48 * 60 * 60_000;

export async function claimHandoffDelivery(service, conversationId, handoff) {
  if (!service?.store?.claimIdempotencyKey || !handoff?.requestId) throw new Error("handoff_idempotency_unavailable");
  return service.store.claimIdempotencyKey("handoff", `${conversationId}:${handoff.requestId}`, HANDOFF_DEDUPE_TTL_MS);
}

export function configuredConversationService(options = {}) {
  return new ConversationService({ store: conversationStoreFromEnv(process.env, options) });
}

export async function answerWithConversation({
  id, channel, message, service, identity,
  answer = answerGuestMessage,
  handoffService = performAuthorizedHandoff,
  route = resolveSemanticKnowledgeGrounding,
  reviewHandoff = resolveAiFirstHandoffDecision,
  claimDelivery = claimHandoffDelivery,
  env = process.env,
  logger = console
}) {
  const temporalContext = temporalContextProvider.getContext();
  let history;
  let durableHandoff = null;
  let storedTopic = null;
  let storedIntent = null;
  try {
    const context = service.context ? await service.context(id) : null;
    history = context?.turns?.map(({ role, content }) => ({ role, content })) || await service.history(id);
    storedTopic = context?.topic || null;
    storedIntent = context?.intent || null;
    durableHandoff = context?.handoff || { state: "none" };
  } catch (error) {
    // FAQ remains available without Redis. Any action whose authorization or
    // idempotency depends on conversation state is explicitly denied.
    if (decideHandoff(message).required) {
      const response = (await memoryUnavailableHandoff()).answer;
      return { answer: response, durable: false, memoryError: error };
    }
    const response = await answer(message, { history: [], channel, identity, temporalContext });
    return { answer: response, durable: false, memoryError: error };
  }

  const grounding = await route(message, history, storedTopic, storedIntent, { env, logger, temporalContext });
  // Every turn is semantically routed first. A possible action then receives a
  // separate grounded AI review before deterministic authorization begins.
  // Regex matching is retained only inside the safe provider-outage fallback.
  const decision = await reviewHandoff({ message, history, grounding, env, logger });
  const authorization = advanceHandoffAuthorization({ message, history, identity, current: durableHandoff, decision });
  let nextHandoff = authorization.handoff || durableHandoff || { state: "none" };
  let response;

  if (authorization.authorized) {
    let claimed = false;
    try { claimed = await claimDelivery(service, id, nextHandoff); }
    catch {
      nextHandoff = { ...nextHandoff, state: "failed" };
      response = (await memoryUnavailableHandoff()).answer;
    }
    if (!response && !claimed) {
      nextHandoff = { ...nextHandoff, state: "delivery_uncertain" };
      response = "這筆送出請求已經處理過，為避免重複寄送，我不會再次送出。若要確認櫃檯是否收到，請直接聯絡櫃檯協助。";
    }
    if (!response && claimed) {
      const result = await handoffService(
        { message, history, channel, identity },
        { authorization: nextHandoff, deliveryClaimed: true }
      );
      if (result?.attempted && result?.delivered) nextHandoff = { ...nextHandoff, state: "sent", sentAt: new Date().toISOString() };
      else nextHandoff = { ...nextHandoff, state: "failed" };
      response = result?.answer || "目前留言尚未成功送出，請直接聯絡櫃檯協助。";
    }
  } else if (authorization.reply) {
    response = authorization.reply;
  } else {
    response = await answer(message, {
      history, channel, identity, grounding, temporalContext
    });
  }

  try {
    await service.append(
      id,
      channel,
      [{ role: "user", content: message }, { role: "assistant", content: response }],
      { topic: grounding.topic, intent: grounding.intent, handoff: nextHandoff }
    );
    return { answer: response, durable: true, handoff: nextHandoff };
  } catch (error) {
    // Never repeat response generation or a handoff after an uncertain write:
    // doing so could duplicate an external side effect.
    return { answer: response, durable: false, memoryError: error, handoff: nextHandoff };
  }
}
