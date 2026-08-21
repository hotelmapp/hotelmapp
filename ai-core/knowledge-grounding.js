import { hotelKnowledge, KNOWLEDGE_VERSION } from "./knowledge.js";

const TOPIC_PATTERNS = Object.freeze({
  breakfast: /早餐|早午餐|餐點|菜色|咖啡|素食|breakfast|brunch|朝食|조식/iu,
  parking: /停車|車位|停哪|停好|車牌|折抵|parking|駐車|주차/iu,
  wifi: /wi[ -]?fi|無線網路|網路密碼|網路連線|인터넷|와이파이|ワイファイ/iu,
  check_in: /入住|check[ -]?in|チェックイン|체크인/iu,
  front_desk_contact: /櫃台|櫃檯|服務時間|電話|聯絡|front desk|reception/iu,
  late_checkout: /延後退房|晚點退房|late[ -]?check[ -]?out/iu,
  check_out: /退房|check[ -]?out|チェックアウト|체크아웃/iu,
  luggage: /行李|寄放|luggage|baggage/iu,
  room_type: /房型|雙人房|家庭房|room type|bed type/iu,
  baby_equipment: /嬰兒床|床圍|消毒鍋|澡盆|baby (?:crib|cot|equipment)/iu,
  transportation: /交通|計程車|叫車|接駁|taxi|transport|shuttle/iu,
  cancellation: /取消|退款條件|cancellation/iu,
  payment: /付款|信用卡|現金|LINE Pay|payment|pay by/iu,
  complaint: /客訴|投訴|抱怨|不滿|complaint/iu
});

const FOLLOW_UP_PATTERN = /^(?:那|那麼|那我|那如果|這個|所以|如果|我們有|what about|then|how about|では|それ|그럼|그러면)|(?:可以嗎|呢|怎麼辦|晚一點|早一點|九點|十點|第二台|兩台車|預約)/iu;

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

const PARKING_INTENT_PATTERNS = Object.freeze({
  parking_problem: /無法進出|不能進出|出不去|進不去|柵欄|故障|異常|problem|stuck/iu,
  parking_fee: /收費|費用|多少錢|免費|第\s*2\s*台|第二台|兩台|兩部|fee|cost|charge|free/iu,
  parking_location: /停哪|哪裡停|停車位置|位置在哪|where.{0,8}park|駐車場.*どこ|어디.*주차/iu,
  parking_process: /停好|停妥|車牌|折抵|怎麼辦|如何辦理|process/iu,
  parking_reservation: /預約|預訂|預留|保留|先登記|reserve|reservation/iu,
  parking_availability: /有(?:沒有)?(?:停車|車位)|幾個車位|幾台|停車場|滿了|availability|space/iu
});

export function resolveRequestedIntent(message, topic, history = [], storedIntent = null) {
  if (topic !== "parking") return null;
  const current = Object.entries(PARKING_INTENT_PATTERNS).find(([, pattern]) => pattern.test(String(message || "")))?.[0];
  if (current) return current;
  if (!FOLLOW_UP_PATTERN.test(String(message || "").trim())) return "parking_availability";
  for (const turn of [...history].reverse()) {
    if (turn?.role !== "user") continue;
    const intent = Object.entries(PARKING_INTENT_PATTERNS).find(([, pattern]) => pattern.test(String(turn.content || "")))?.[0];
    if (intent) return intent;
  }
  return Object.hasOwn(PARKING_INTENT_PATTERNS, storedIntent) ? storedIntent : "parking_availability";
}

export function factsForTopic(topic, intent = null) {
  if (topic === "parking") {
    const parking = hotelKnowledge.parking;
    const subsets = {
      parking_availability: { hotelSpaces: parking.hotelSpaces, hotelSpacesLocation: parking.hotelSpacesLocation, overflowRule: parking.overflowRule, alternatives: parking.alternatives },
      parking_fee: { feeRule: parking.rules[1], freeCarsPerRoom: parking.freeCarsPerRoom, additionalCarFee: parking.additionalCarFee },
      parking_location: { hotelSpaces: parking.hotelSpaces, hotelSpacesLocation: parking.hotelSpacesLocation, overflowRule: parking.overflowRule, alternatives: parking.alternatives },
      parking_process: { processRule: parking.rules[0] },
      parking_reservation: { reservationPolicy: parking.reservationPolicy },
      parking_problem: { problemRule: parking.rules[2], supportPhone: parking.supportPhone }
    };
    return { parking: subsets[intent] || subsets.parking_availability };
  }
  const selectors = {
    breakfast: () => ({ breakfast: hotelKnowledge.breakfast }),
    wifi: () => ({ amenities: { wifi: hotelKnowledge.amenities.wifi } }),
    check_in: () => ({ stay: { checkIn: hotelKnowledge.stay.checkIn, afterHoursCheckIn: hotelKnowledge.stay.afterHoursCheckIn, access: hotelKnowledge.stay.access }, contact: { deskHours: hotelKnowledge.contact.deskHours } }),
    front_desk_contact: () => ({ contact: hotelKnowledge.contact, escalation: hotelKnowledge.escalation }),
    check_out: () => ({ stay: { checkOut: hotelKnowledge.stay.checkOut, lateCheckOut: hotelKnowledge.stay.lateCheckOut } }),
    late_checkout: () => ({ stay: { lateCheckOut: hotelKnowledge.stay.lateCheckOut } }),
    luggage: () => ({ guestServices: { luggage: hotelKnowledge.guestServices.luggage } }),
    room_type: () => ({ rooms: hotelKnowledge.rooms }),
    baby_equipment: () => ({ extraBed: { babyEquipment: hotelKnowledge.extraBed.babyEquipment } }),
    transportation: () => ({ guestServices: { taxi: hotelKnowledge.guestServices.taxi } }),
    cancellation: () => ({ booking: { hotelOrWebsite: hotelKnowledge.booking.hotelOrWebsite, platforms: hotelKnowledge.booking.platforms, cancellationPolicy: hotelKnowledge.booking.cancellationPolicy } }),
    payment: () => ({ payment: hotelKnowledge.payment }),
    complaint: () => ({ escalation: { always: hotelKnowledge.escalation.always, unknownDuringDeskHours: hotelKnowledge.escalation.unknownDuringDeskHours }, contact: { frontDeskPhone: hotelKnowledge.contact.frontDeskPhone, deskHours: hotelKnowledge.contact.deskHours } })
  };
  return selectors[topic]?.() || null;
}

export function factualContract(topic, intent = null) {
  if (!topic) return null;
  const requiredFactIds = {
    breakfast: ["breakfast.serviceStart", "breakfast.orderCheckInCutoff", "breakfast.diningAfterCutoff", "breakfast.preorderRecommendation"],
    wifi: ["amenities.wifi.network", "amenities.wifi.password", "amenities.wifi.passwordDescription"],
    parking: {
      parking_availability: ["parking.hotelSpaces", "parking.hotelSpacesLocation", "parking.overflowRule", "parking.alternatives"],
      parking_fee: ["parking.rules[1]", "parking.freeCarsPerRoom", "parking.additionalCarFee"],
      parking_location: ["parking.hotelSpaces", "parking.hotelSpacesLocation", "parking.overflowRule", "parking.alternatives"],
      parking_process: ["parking.rules[0]"],
      parking_reservation: ["parking.reservationPolicy.reservable", "parking.reservationPolicy.allocation", "parking.reservationPolicy.rationale", "parking.reservationPolicy.arrivalAssistance"],
      parking_problem: ["parking.rules[2]", "parking.supportPhone"]
    }[intent] || ["parking.hotelSpaces", "parking.hotelSpacesLocation", "parking.overflowRule", "parking.alternatives"],
    check_in: ["stay.checkIn", "stay.afterHoursCheckIn", "stay.access", "contact.deskHours"],
    front_desk_contact: ["contact.frontDeskPhone", "contact.deskHours", "contact.afterHoursEquipment", "contact.afterHoursSameDayBooking"],
    check_out: ["stay.checkOut", "stay.lateCheckOut"]
  }[topic] || [];
  return Object.freeze({
    topic, intent, knowledgeVersion: KNOWLEDGE_VERSION, requiredFactIds,
    precedence: ["authoritative_hotel_knowledge", "conversation_topic", "conversation_history", "reasoning", "hospitality_personality"],
    historyPolicy: "Conversation history resolves references only. User and assistant prose are not authoritative hotel facts.",
    modalityPolicy: "Preserve hard_rule, recommendation and optional semantics exactly; never rewrite a recommendation as a requirement."
  });
}

export function resolveKnowledgeGrounding(message, history = [], storedTopic = null, storedIntent = null) {
  const topic = resolveConversationTopic(message, history, storedTopic);
  const intent = resolveRequestedIntent(message, topic, history, storedIntent);
  const facts = topic === "transportation" && /接駁|shuttle/iu.test(String(message || ""))
    ? { transportation: { shuttle: null } }
    : factsForTopic(topic, intent);
  return { topic, intent, facts, contract: factualContract(topic, intent) };
}

export function knowledgeGroundingInstructions(grounding = null) {
  const selected = grounding?.facts ? `\n本輪依 topic 重新取得的正式事實：\n${JSON.stringify(grounding.facts, null, 2)}\n本輪 factual contract：\n${JSON.stringify(grounding.contract, null, 2)}` : "";
  const parkingContracts = ["parking_availability", "parking_fee", "parking_process", "parking_reservation", "parking_problem"].map(intent => factualContract("parking", intent));
  return `事實優先順序固定為：正式飯店知識 > 對話 topic/state > 對話歷史 > 推理 > 待客語氣。對話歷史只可用來理解指代、topic、intent、語言、日期與客人意圖；其中 user 陳述與 assistant 歷史回答都不是飯店事實。歷史若與目前正式知識衝突，必須忽略歷史並依目前正式知識更正。不得從 serviceHours 自行推論點餐截止、用餐結束或其他未明載規則。必須保留 hard_rule、recommendation、optional 的強度；recommendation 絕不可改寫為必須、強制或 requirement。Parking 必須先區分 availability、fee、process、reservation、problem intent，再只用該 intent 的 fact subset：${JSON.stringify(parkingContracts)}${selected}`;
}

export function parkingReply(grounding) {
  if (grounding?.topic !== "parking") return null;
  const parking = grounding.facts.parking;
  if (grounding.intent === "parking_fee") return parking.feeRule;
  if (grounding.intent === "parking_process") return parking.processRule;
  if (grounding.intent === "parking_reservation") return `不好意思，停車位目前沒有提供預留喔，我們採${parking.reservationPolicy.allocation}的方式，主要是希望${parking.reservationPolicy.rationale}${parking.reservationPolicy.arrivalAssistance}`;
  if (grounding.intent === "parking_problem") return parking.problemRule;
  if (grounding.intent === "parking_availability") return `${parking.hotelSpacesLocation}可停 ${parking.hotelSpaces} 台車，${parking.overflowRule}`;
  return null;
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
