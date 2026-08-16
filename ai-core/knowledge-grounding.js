import { hotelKnowledge, KNOWLEDGE_VERSION } from "./knowledge.js";

const TOPIC_PATTERNS = Object.freeze({
  breakfast: /早餐|早午餐|餐點|菜色|咖啡|素食|breakfast|brunch|朝食|조식/iu,
  parking: /停車|車位|parking|駐車|주차/iu,
  check_in: /入住|check[ -]?in|チェックイン|체크인/iu,
  front_desk_contact: /櫃台|櫃檯|服務時間|電話|聯絡|front desk|reception/iu,
  check_out: /退房|check[ -]?out|チェックアウト|체크아웃/iu
});

const FOLLOW_UP_PATTERN = /^(?:那|那麼|那我|那如果|這個|所以|如果|what about|then|how about|では|それ|그럼|그러면)|(?:可以嗎|呢|怎麼辦|晚一點|早一點|九點|十點|第二台)/iu;

export function explicitTopic(text) {
  return Object.entries(TOPIC_PATTERNS).find(([, pattern]) => pattern.test(String(text || "")))?.[0] || null;
}

export function resolveConversationTopic(message, history = [], storedTopic = null) {
  const current = explicitTopic(message);
  if (current) return current;
  if (!FOLLOW_UP_PATTERN.test(String(message || "").trim())) return null;
  // Assistant prose is intentionally excluded: generated text is context, not truth.
  for (const turn of [...history].reverse()) {
    if (turn?.role !== "user") continue;
    const topic = explicitTopic(turn.content);
    if (topic) return topic;
  }
  return storedTopic && Object.hasOwn(TOPIC_PATTERNS, storedTopic) ? storedTopic : null;
}

export function factsForTopic(topic) {
  const selectors = {
    breakfast: () => ({ breakfast: hotelKnowledge.breakfast }),
    parking: () => ({ parking: hotelKnowledge.parking }),
    check_in: () => ({ stay: { checkIn: hotelKnowledge.stay.checkIn, afterHoursCheckIn: hotelKnowledge.stay.afterHoursCheckIn, access: hotelKnowledge.stay.access }, contact: { deskHours: hotelKnowledge.contact.deskHours } }),
    front_desk_contact: () => ({ contact: hotelKnowledge.contact, escalation: hotelKnowledge.escalation }),
    check_out: () => ({ stay: { checkOut: hotelKnowledge.stay.checkOut, lateCheckOut: hotelKnowledge.stay.lateCheckOut } })
  };
  return selectors[topic]?.() || null;
}

export function factualContract(topic) {
  if (!topic) return null;
  const requiredFactIds = {
    breakfast: ["breakfast.serviceStart", "breakfast.orderCheckInCutoff", "breakfast.diningAfterCutoff", "breakfast.preorderRecommendation"],
    parking: ["parking.hotelSpaces", "parking.alternatives", "parking.rules"],
    check_in: ["stay.checkIn", "stay.afterHoursCheckIn", "stay.access", "contact.deskHours"],
    front_desk_contact: ["contact.frontDeskPhone", "contact.deskHours", "contact.afterHoursEquipment", "contact.afterHoursSameDayBooking"],
    check_out: ["stay.checkOut", "stay.lateCheckOut"]
  }[topic] || [];
  return Object.freeze({
    topic, knowledgeVersion: KNOWLEDGE_VERSION, requiredFactIds,
    precedence: ["authoritative_hotel_knowledge", "conversation_topic", "conversation_history", "reasoning", "hospitality_personality"],
    historyPolicy: "Conversation history resolves references only. User and assistant prose are not authoritative hotel facts.",
    modalityPolicy: "Preserve hard_rule, recommendation and optional semantics exactly; never rewrite a recommendation as a requirement."
  });
}

export function resolveKnowledgeGrounding(message, history = [], storedTopic = null) {
  const topic = resolveConversationTopic(message, history, storedTopic);
  return { topic, facts: factsForTopic(topic), contract: factualContract(topic) };
}

export function knowledgeGroundingInstructions(grounding = null) {
  const selected = grounding?.facts ? `\n本輪依 topic 重新取得的正式事實：\n${JSON.stringify(grounding.facts, null, 2)}\n本輪 factual contract：\n${JSON.stringify(grounding.contract, null, 2)}` : "";
  return `事實優先順序固定為：正式飯店知識 > 對話 topic/state > 對話歷史 > 推理 > 待客語氣。對話歷史只可用來理解指代、topic、語言、日期與客人意圖；其中 user 陳述與 assistant 歷史回答都不是飯店事實。歷史若與目前正式知識衝突，必須忽略歷史並依目前正式知識更正。不得從 serviceHours 自行推論點餐截止、用餐結束或其他未明載規則。必須保留 hard_rule、recommendation、optional 的強度；recommendation 絕不可改寫為必須、強制或 requirement。${selected}`;
}

export function breakfastArrivalReply(message, grounding) {
  if (grounding?.topic !== "breakfast" || !/(?:[早上上午]?[八九十]\s*點|\d{1,2}(?::\d{2}|點半?)|過去|到|抵達|來|可以嗎)/u.test(message)) return null;
  const breakfast = grounding.facts.breakfast;
  const cutoff = breakfast.orderCheckInCutoff;
  const dining = breakfast.diningAfterCutoff;
  const preorder = breakfast.preorderRecommendation;
  const arrival = message.match(/九點半|9[:：]30/u)?.[0] || "這個時間";
  return `可以，${arrival}過去來得及。${cutoff.meaning}${dining.rule}${preorder.recommendation}這是方便備餐、減少等候的建議，不是強制要求。`;
}

export function validateGroundedResponse(answer, grounding) {
  if (!grounding?.contract || typeof answer !== "string") return true;
  if (grounding.topic === "breakfast") {
    const prohibited = [
      /10(?::00|\s*點)前(?:要|必須|一定要).{0,8}(?:吃完|用餐完)/u,
      /10(?::00|\s*點)後.{0,10}(?:不能|不得|不可以).{0,8}(?:留|用餐|待在)/u,
      /(?:必須|一定要|強制).{0,10}(?:前一天|提前).{0,10}(?:預訂|點餐|選餐)/u
    ];
    return prohibited.every(pattern => !pattern.test(answer));
  }
  return true;
}
