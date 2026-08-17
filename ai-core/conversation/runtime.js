import { answerGuestMessage } from "../guest-response.js";
import { decideHandoff } from "../handoff.js";
import { ConversationService } from "./service.js";
import { conversationStoreFromEnv } from "./store.js";
import { resolveKnowledgeGrounding } from "../knowledge-grounding.js";

const memoryUnavailableHandoff = async () => ({
  attempted: true, delivered: false,
  answer: "目前無法安全確認這段對話的狀態，因此尚未替您送出或執行任何轉接需求。請直接聯絡櫃檯協助。"
});

export function configuredConversationService(options = {}) {
  return new ConversationService({ store: conversationStoreFromEnv(process.env, options) });
}

export async function answerWithConversation({ id, channel, message, service, identity, answer = answerGuestMessage, onDiagnostic = () => {} }) {
  let history;
  let storedTopic = null;
  let storedIntent = null;
  let pendingAction = null;
  try {
    const context = service.context ? await service.context(id) : null;
    history = context?.turns?.map(({ role, content }) => ({ role, content })) || await service.history(id);
    storedTopic = context?.topic || null;
    storedIntent = context?.intent || null;
    pendingAction = context?.pendingAction || null;
    onDiagnostic({ event: "memory_load", success: true, previousTopic: storedTopic, previousIntent: storedIntent, mode: "durable" });
  } catch (error) {
    // FAQ remains available without Redis. Any action whose authorization or
    // idempotency depends on conversation state is explicitly denied.
    const handoffService = decideHandoff(message).required ? memoryUnavailableHandoff : async () => ({ attempted: false });
    const response = await answer(message, { history: [], channel, identity, handoffService });
    onDiagnostic({ event: "memory_load", success: false, mode: "stateless", code: error?.code || "memory_unavailable" });
    return { answer: response, durable: false, memoryError: error };
  }
  const grounding = resolveKnowledgeGrounding(message, history, storedTopic, storedIntent);
  const currentHandoff = decideHandoff(message, history);
  const consent = /(?:可以幫我處理|請幫我處理|幫我處理|好[啊的]?[,，]?麻煩你|同意(?:轉接|通知))/u.test(message);
  const needsConsent = currentHandoff.required && currentHandoff.category === "設備故障" && !consent;
  let nextPendingAction = pendingAction;
  let handoffService;
  if (needsConsent) {
    nextPendingAction = { type: "handoff", category: currentHandoff.category, status: "awaiting_consent" };
    handoffService = async () => ({ attempted: true, delivered: false, answer: "若您同意，我可以協助通知真人同仁；請明確回覆是否要我處理。" });
  } else if (pendingAction?.status === "awaiting_consent" && consent) {
    handoffService = undefined;
    nextPendingAction = { ...pendingAction, status: "completed" };
  } else if (pendingAction?.status === "completed" && /^(?:好|好的|好啊)?[,，]?\s*麻煩你[了]?$/u.test(message.trim())) {
    handoffService = async () => ({ attempted: true, delivered: false, answer: "好的，已延續前一輪的處理狀態，不會重複通知。" });
  }
  const response = await answer(message, { history, channel, identity, grounding, ...(handoffService ? { handoffService } : {}) });
  try {
    await service.append(id, channel, [{ role: "user", content: message }, { role: "assistant", content: response }], { topic: grounding.topic, intent: grounding.intent, pendingAction: nextPendingAction });
    onDiagnostic({ event: "memory_write", success: true, topic: grounding.topic, intent: grounding.intent, mode: "durable" });
    return { answer: response, durable: true };
  } catch (error) {
    // Never repeat response generation or a handoff after an uncertain write:
    // doing so could duplicate an external side effect.
    onDiagnostic({ event: "memory_write", success: false, topic: grounding.topic, intent: grounding.intent, mode: "stateless", code: error?.code || "memory_unavailable" });
    return { answer: response, durable: false, memoryError: error };
  }
}
