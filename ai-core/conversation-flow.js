import { resolveKnowledgeGrounding } from "./knowledge-grounding.js";

export const SERVICE_PRIORITY = Object.freeze({ REQUIRED: "required", HELPFUL: "helpful", OPTIONAL: "optional", NONE: "none" });

const ACCEPTANCE = /^(?:(?:好(?:的|啊|呀)?[，,、\s]*)?(?:麻煩你(?:了)?|請幫我)|好(?:的|啊|呀)?|可以|沒問題|yes|sure|please|okay|ok|はい|お願いします|네|좋아요)[。！!,.，\s]*$/iu;
const DECLINE = /^(?:不用|先不用|不必|沒關係|no thanks|not now|結構です|괜찮아요)[。！!,.，\s]*$/iu;
const LATE_ARRIVAL = /(?:晚上|晚間|夜間)?(?:十[點時](?:半)?|十一[點時](?:半)?|22(?::?\s*(?:[0-5]\d))?|23(?::?\s*(?:[0-5]\d))?|10(?::?\s*(?:[0-5]\d))?\s*p\.?m\.?|11(?::?\s*(?:[0-5]\d))?\s*p\.?m\.?).*(?:到|抵達|入住|check[ -]?in)|(?:到|抵達|入住).*(?:十點半|十一點|22|23)/iu;
const EQUIPMENT_PROBLEM = /(?:冷氣|空調|電視|熱水|門鎖|房內設備|wifi|網路).*(?:壞|故障|沒反應|無法使用)|(?:壞|故障|沒反應|無法使用).*(?:冷氣|空調|電視|熱水|門鎖|房內設備|wifi|網路)/iu;
const FRONT_DESK_REQUEST = /(?:想|要|找|聯絡).{0,6}(?:櫃台|櫃檯|真人|飯店人員)/iu;

function inferredPendingAction(history) {
  const last = [...history].reverse().find(turn => turn?.role === "assistant")?.content || "";
  if (/停哪|停車位置|哪裡比較方便/u.test(last)) return { type: "explain_parking_location", topic: "parking", intent: "parking_location" };
  if (/通知|聯絡.{0,4}櫃[台檯]/u.test(last)) return { type: "request_handoff", topic: "front_desk_contact" };
  return null;
}

/** Plans what this turn should accomplish before presentation is generated. */
export function planConversationTurn({ message, history = [], storedTopic = null, storedIntent = null, state = null, channel = "web" }) {
  const text = String(message || "").trim();
  const pending = state && typeof state === "object" ? state.pendingAction : null;
  const offeredAction = pending || inferredPendingAction(history);
  const acceptedAction = ACCEPTANCE.test(text) ? offeredAction : null;
  const declinedAction = DECLINE.test(text) ? offeredAction : null;
  const effectiveMessage = acceptedAction?.type === "explain_parking_location" ? "停車位置在哪裡？" : text;
  let grounding = resolveKnowledgeGrounding(effectiveMessage, history, storedTopic, storedIntent);
  if (LATE_ARRIVAL.test(text)) grounding = resolveKnowledgeGrounding("入住", history, "check_in", null);

  const problem = EQUIPMENT_PROBLEM.test(text);
  const frontDesk = FRONT_DESK_REQUEST.test(text);
  let servicePriority = SERVICE_PRIORITY.NONE;
  let proactiveNotice = null;
  let suggestedNextAction = null;
  let shouldOfferHandoff = false;
  let tone = problem ? "empathetic" : "hospitality";

  if (LATE_ARRIVAL.test(text)) {
    servicePriority = SERVICE_PRIORITY.REQUIRED;
    proactiveNotice = "late_arrival_procedure";
  } else if (problem || frontDesk) {
    servicePriority = SERVICE_PRIORITY.REQUIRED;
    shouldOfferHandoff = true;
    suggestedNextAction = { type: "request_handoff", topic: grounding.topic || "front_desk_contact" };
  } else if (grounding.topic === "parking" && grounding.intent === "parking_fee") {
    servicePriority = SERVICE_PRIORITY.HELPFUL;
    suggestedNextAction = { type: "explain_parking_location", topic: "parking", intent: "parking_location" };
  }

  const handoffConsent = acceptedAction?.type === "request_handoff";
  const pendingAction = declinedAction || acceptedAction ? null : suggestedNextAction;
  return Object.freeze({
    resolvedTopic: grounding.topic, resolvedIntent: grounding.intent,
    guestGoal: acceptedAction?.type || grounding.intent || grounding.topic,
    grounding, requiredFacts: grounding.contract?.requiredFactIds || [], optionalFacts: [],
    servicePriority, proactiveNotice, suggestedNextAction,
    conversationContinuation: suggestedNextAction ? servicePriority : SERVICE_PRIORITY.NONE,
    shouldAskQuestion: shouldOfferHandoff, requiredQuestion: shouldOfferHandoff ? "handoff_consent" : null,
    shouldOfferHandoff, handoffConsent, acceptedAction, tone,
    channelConstraints: { channel, voiceBrevity: channel === "voice", emojiAllowed: channel !== "voice" && !problem },
    nextState: { status: "active", pendingAction }
  });
}

export function conversationFlowInstructions(plan = null) {
  return `先決定本輪服務行動，再決定措辭。回答當下問題與推進服務是兩個決策：required 主動提醒必須說；helpful 只提供一個高度相關的下一步；optional 不必每輪出現；none 自然結束。採 progressive disclosure，只使用 response plan 的 required facts，不傾倒同 topic 的其他資訊。不為延續聊天而追問；只有完成服務所必需或明顯改善服務時才問，而且一輪最多一題。短答「好啊／可以／麻煩你」應承接 pending offer，而不是當成新 FAQ。Handoff 必須先 offer，只有明確同意後才能執行。${plan ? `\n本輪 authoritative response plan：\n${JSON.stringify(plan, null, 2)}` : ""}`;
}
