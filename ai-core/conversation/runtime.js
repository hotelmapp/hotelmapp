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

export async function answerWithConversation({ id, channel, message, service, identity, answer = answerGuestMessage, handoffService }) {
  let history;
  let durableHandoff = null;
  let storedTopic = null;
  let storedIntent = null;
  try {
    const context = service.context ? await service.context(id) : null;
    history = context?.turns?.map(({ role, content }) => ({ role, content })) || await service.history(id);
    storedTopic = context?.topic || null;
    storedIntent = context?.intent || null;
    durableHandoff = context?.handoff || null;
  } catch (error) {
    // FAQ remains available without Redis. Any action whose authorization or
    // idempotency depends on conversation state is explicitly denied.
    const handoffService = decideHandoff(message).required ? memoryUnavailableHandoff : async () => ({ attempted: false });
    const response = await answer(message, { history: [], channel, identity, handoffService });
    return { answer: response, durable: false, memoryError: error };
  }
  const grounding = resolveKnowledgeGrounding(message, history, storedTopic, storedIntent);
  const response = await answer(message, {
    history, channel, identity, grounding,
    ...(handoffService ? { handoffService: request => handoffService(request, { authorization: durableHandoff }) } : {})
  });
  try {
    await service.append(id, channel, [{ role: "user", content: message }, { role: "assistant", content: response }], { topic: grounding.topic, intent: grounding.intent });
    return { answer: response, durable: true };
  } catch (error) {
    // Never repeat response generation or a handoff after an uncertain write:
    // doing so could duplicate an external side effect.
    return { answer: response, durable: false, memoryError: error };
  }
}
