import { hotelKnowledge, KNOWLEDGE_VERSION } from "./knowledge.js";
import { bookingDatesFromText } from "../stay-dates.js";

const TOPIC_PATTERNS = Object.freeze({
  breakfast: /早餐|早午餐|餐點|菜色|咖啡|素食|breakfast|brunch|朝食|조식/iu,
  parking: /停車|車位|停哪|停好|車牌|車號|parking|駐車|주차/iu,
  subsidy: /國旅(?:補助|獎助)|旅遊補助|住宿補助|補助|住宿獎助|平日住宿活動|政府活動|生日券|壽星券|Taiwan\s*PASS|台灣\s*PASS|住宿券|subsidy|accommodation voucher/iu,
  booking: /有房(?:間)?|空房|房況|房價|訂房|預訂(?:房間|住宿)?|(?:直接|這邊|這裡|透過|跟|向).{0,12}(?:飯店|櫃台|櫃檯|LINE).{0,8}(?:訂|預訂)|(?:飯店|櫃台|櫃檯|LINE).{0,8}(?:訂|預訂)|book(?:ing)?|availab|空室|予約|예약/iu,
  wifi: /wi[\s‐‑‒–—-]?fi|無線網路|網路密碼|網路連線|인터넷|와이파이|ワイファイ/iu,
  check_in: /入住(?:時間|手續|流程|密碼)|幾點.{0,6}入住|何時.{0,6}入住|怎麼.{0,6}入住|check[ -]?in|チェックイン|체크인/iu,
  front_desk_contact: /(?:櫃台|櫃檯).{0,10}(?:幾點|時間|電話|聯絡|在哪|怎麼找|有人)|(?:電話|聯絡).{0,10}(?:櫃台|櫃檯)|front desk|reception/iu,
  late_checkout: /延後退房|晚點退房|late[ -]?check[ -]?out/iu,
  check_out: /退房|check[ -]?out|チェックアウト|체크아웃/iu,
  luggage: /行李|寄放|luggage|baggage/iu,
  room_type: /房型|雙人房|家庭房|room type|bed type/iu,
  baby_equipment: /嬰兒床|床圍|消毒鍋|澡盆|baby (?:crib|cot|equipment)/iu,
  transportation: /交通|計程車|叫車|接駁|taxi|transport|shuttle/iu,
  cancellation: /取消|退款條件|cancellation/iu,
  payment: /付款|信用卡|付現|現金(?:付款|支付)|LINE Pay|payment|pay by/iu,
  complaint: /客訴|投訴|抱怨|不滿|complaint/iu
});

// This is deliberately a whole-message shape, not a substring search. A final
// particle such as 「呢」 does not by itself authorize an older topic to
// override a complete current request.
const FOLLOW_UP_PATTERN = /^(?:(?:那|那麼|那我|那如果|這個|所以|如果|因為|我們有|what about|then|how about|because|では|それ|그럼|그러면).{0,80}|.{0,40}(?:可以嗎|是否適用|適用嗎|呢|怎麼辦|晚一點|早一點|九點|十點|第二台|兩台車|(?:需要)?(?:先)?(?:預約|預留)(?:嗎)?)[？?!！。.\s～~]*)$/iu;

export function isFollowUpMessage(message) {
  return FOLLOW_UP_PATTERN.test(String(message || "").trim());
}

export function explicitTopic(text) {
  return explicitTopics(text)[0] || null;
}

export function explicitTopics(text) {
  const source = String(text || "");
  const topics = Object.entries(TOPIC_PATTERNS)
    .filter(([, pattern]) => pattern.test(source))
    .map(([topic]) => topic);
  // A specific intent owns its generic parent wording. "延後退房" is one
  // late-checkout topic, not two independent questions.
  const withoutParent = topics.includes("late_checkout") ? topics.filter(topic => topic !== "check_out") : topics;
  const withoutCancelledBooking = withoutParent.includes("cancellation") ? withoutParent.filter(topic => topic !== "booking") : withoutParent;
  // Booking-channel language inside a subsidy question is an intent of the
  // subsidy topic, not a second unrelated booking question.
  return withoutCancelledBooking.includes("subsidy") ? withoutCancelledBooking.filter(topic => topic !== "booking") : withoutCancelledBooking;
}

export function resolveConversationTopics(message, history = [], storedTopic = null) {
  const current = explicitTopics(message);
  if (current.length) return current;
  if (!isFollowUpMessage(message)) return [];
  // Assistant prose is intentionally excluded: generated text is context, not
  // truth. We may walk through a chain of genuinely elliptical user turns, but
  // stop at the first self-contained turn with no recognized topic. This keeps
  // a stale topic from jumping across an unrelated request.
  for (const turn of [...history].reverse()) {
    if (turn?.role !== "user") continue;
    const topics = explicitTopics(turn.content);
    if (topics.length) return topics;
    if (!isFollowUpMessage(turn.content)) return [];
  }
  return storedTopic && Object.hasOwn(TOPIC_PATTERNS, storedTopic) ? [storedTopic] : [];
}

export function resolveConversationTopic(message, history = [], storedTopic = null) {
  return resolveConversationTopics(message, history, storedTopic)[0] || null;
}

const PARKING_INTENT_PATTERNS = Object.freeze({
  parking_problem: /無法進出|不能進出|出不去|進不去|柵欄|故障|異常|problem|stuck/iu,
  parking_fee: /收費|費用|多少錢|免費|第\s*2\s*台|第二台|兩台|兩部|fee|cost|charge|free/iu,
  parking_partner_location: /(?:(?:配合|特約|合作)(?:的)?(?:停車場|車位)|門口.{0,12}(?:滿|沒位).{0,12}(?:停車場|停哪)).{0,24}(?:哪(?:邊|裡|個)|位置|地址|怎麼走|導航)|(?:哪(?:邊|裡)|位置|地址|怎麼走|導航).{0,24}(?:配合|特約|合作)(?:的)?(?:停車場|車位)|partner\s+parking|overflow\s+parking/iu,
  parking_location: /停哪|哪裡停|停車位置|位置在哪|where.{0,8}park|駐車場.*どこ|어디.*주차/iu,
  parking_process: /停好|停妥|車牌|車號|折抵|怎麼辦|如何辦理|process/iu,
  parking_reservation: /預約|預訂|預留|保留|先登記|(?:停車位|車位).{0,6}留|留.{0,6}(?:停車位|車位)|reserve|reservation/iu,
  parking_availability: /有(?:沒有)?(?:停車|車位)|幾個車位|幾台|停車場|滿了|availability|space/iu
});

const SUBSIDY_INTENT_PATTERNS = Object.freeze({
  subsidy_documentation: /住宿證明|入住證明|第一晚.{0,12}證明|前一天.{0,12}證明|連續住宿.{0,12}證明|需要提供.{0,12}證明|證明.{0,12}(?:第一晚|前一天|連續住宿)/iu,
  subsidy_date_applicability: /(?:(?:國定)?(?:連續)?(?:假日|連假)|平日|週[日一二三四五六]|星期[日一二三四五六]|禮拜[日一二三四五六]|(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*[日號]?|\d{1,2}\s*[\/-]\s*\d{1,2})(?:.{0,32})(?:適用|可以用|能用|符合|有補助)|(?:適用|可以用|能用|符合|有補助)(?:.{0,32})(?:(?:國定)?(?:連續)?(?:假日|連假)|平日|週[日一二三四五六]|星期[日一二三四五六]|禮拜[日一二三四五六]|(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*[日號]?|\d{1,2}\s*[\/-]\s*\d{1,2})/iu,
  subsidy_stacking: /疊加|併用|一起用|同時用|同時使用|合併使用|超過房價|退現|找現|保留/iu,
  subsidy_birthday_voucher: /生日券|壽星券|壽星生日券|生日住宿金|生日.*補助/iu,
  subsidy_taiwan_pass: /Taiwan\s*PASS|台灣\s*PASS/iu,
  subsidy_booking_channel: /Agoda|Booking(?:\.com)?|OTA|訂房平台|第三方|官網|電話訂房|LINE\s*訂房|現場訂房/iu,
  subsidy_registration: /QR\s*Code|QR碼|登錄|登記|申請|怎麼辦理|如何辦理|怎麼使用|證件|身分證|健保卡|資料上傳/iu,
  subsidy_participation_limit: /每人|一次|幾次|重複參加|參加次數/iu,
  subsidy_third_night: /第三晚|第\s*3\s*晚|三晚|3\s*晚/iu,
  subsidy_amount: /多少|金額|折抵|第一晚|第\s*1\s*晚|第二晚|第\s*2\s*晚|兩晚|2\s*晚/iu,
  subsidy_period: /期間|日期|幾月|何時|什麼時候|開始|結束|到幾號|週五|週六|週日|平日|連續假日/iu,
  subsidy_eligibility: /資格|符合|可以用|能用|還有名額|還有額度|經費|用完|額度|政府公告|解釋權/iu
});
const SUBSIDY_PARTICIPATION_PATTERN = /(?:(?:飯店|你們|希堤微旅).{0,10})?(?:(?:有|沒有|沒|是否|會|將會|不會).{0,10}(?:參加|加入)|(?:參加|加入).{0,10}(?:嗎|呢|沒有|沒)).{0,16}(?:國旅|旅遊|住宿|平日)?(?:補助|獎助|活動)|(?:國旅|旅遊|住宿|平日)?(?:補助|獎助|活動).{0,16}(?:(?:有|沒有|沒|是否|會|將會|不會).{0,10}(?:參加|加入)|(?:參加|加入).{0,10}(?:嗎|呢|沒有|沒))/u;

const BOOKING_INTENT_PATTERNS = Object.freeze({
  booking_modify_cancel: /修改|更改|取消|改期|退款|modify|change|cancel/iu,
  booking_availability: /有房|空房|房況|房價|優惠|即時|日期|入住|退房|幾晚|availab|rate|price|check[ -]?in|check[ -]?out|空室|요금|객실/iu,
  booking_direct: /直接|這邊|這裡|透過|跟|向|櫃台|櫃檯|飯店|官網|電話|LINE|怎麼訂|如何訂|book|予約|예약/iu
});

function inheritedIntent(message, history, topic, patterns, storedIntent, fallback) {
  const current = Object.entries(patterns).find(([, pattern]) => pattern.test(String(message || "")))?.[0];
  if (current) return current;
  if (!isFollowUpMessage(message)) return fallback;
  for (const turn of [...history].reverse()) {
    if (turn?.role !== "user") continue;
    const turnTopics = explicitTopics(turn.content);
    if (turnTopics.length && !turnTopics.includes(topic)) return fallback;
    const intent = Object.entries(patterns).find(([, pattern]) => pattern.test(String(turn.content || "")))?.[0];
    if (intent) return intent;
    if (!turnTopics.length && !isFollowUpMessage(turn.content)) return fallback;
  }
  return Object.hasOwn(patterns, storedIntent) ? storedIntent : fallback;
}

export function resolveRequestedIntent(message, topic, history = [], storedIntent = null) {
  if (topic === "subsidy") {
    if (SUBSIDY_PARTICIPATION_PATTERN.test(String(message || ""))) return "subsidy_participation";
    return inheritedIntent(message, history, topic, SUBSIDY_INTENT_PATTERNS, storedIntent, "subsidy_overview");
  }
  if (topic === "booking") return inheritedIntent(message, history, topic, BOOKING_INTENT_PATTERNS, storedIntent, "booking_direct");
  if (topic === "parking") return inheritedIntent(message, history, topic, PARKING_INTENT_PATTERNS, storedIntent, "parking_availability");
  return null;
}

const WEEKDAY_NAMES = Object.freeze(["週日", "週一", "週二", "週三", "週四", "週五", "週六"]);
const HOLIDAY_EVE_PATTERN = /(?:(?:國定)?(?:連續)?(?:假日|連假).{0,10}(?:前一天|前一日|前一晚|前夕)|(?:前一天|前一日|前一晚|前夕).{0,10}(?:國定)?(?:連續)?(?:假日|連假))/u;
const HOLIDAY_PATTERN = /(?:國定)?(?:連續假日|連假)|國定假日/u;

export function subsidyDateRequestContext(message, temporalContext = null) {
  const reference = /^\d{4}-\d{2}-\d{2}$/u.test(String(temporalContext?.date || ""))
    ? new Date(`${temporalContext.date}T00:00:00Z`)
    : new Date();
  const requestedStayDate = bookingDatesFromText(String(message || ""), reference)?.checkInDate || null;
  const requestedWeekday = requestedStayDate
    ? WEEKDAY_NAMES[new Date(`${requestedStayDate}T00:00:00Z`).getUTCDay()]
    : null;
  return Object.freeze({
    requestedStayDate,
    requestedWeekday,
    holidayRelationship: HOLIDAY_EVE_PATTERN.test(String(message || ""))
      ? "day_before_long_holiday"
      : HOLIDAY_PATTERN.test(String(message || "")) ? "long_holiday_or_related_date" : null
  });
}

export function factsForTopic(topic, intent = null, requestContext = null) {
  if (topic === "parking") {
    const parking = hotelKnowledge.parking;
    const subsets = {
      parking_availability: { hotelSpaces: parking.hotelSpaces, hotelSpacesLocation: parking.hotelSpacesLocation, overflowRule: parking.overflowRule, alternatives: parking.alternatives },
      parking_fee: { feeRule: parking.rules[1], freeCarsPerRoom: parking.freeCarsPerRoom, additionalCarFee: parking.additionalCarFee },
      parking_partner_location: { hotelSpaces: parking.hotelSpaces, hotelSpacesLocation: parking.hotelSpacesLocation, partnerLots: parking.partnerLots, processRule: parking.rules[0] },
      parking_location: { hotelSpaces: parking.hotelSpaces, hotelSpacesLocation: parking.hotelSpacesLocation, overflowRule: parking.overflowRule, alternatives: parking.alternatives, partnerLots: parking.partnerLots },
      parking_process: { processRule: parking.rules[0] },
      parking_reservation: { reservationPolicy: parking.reservationPolicy },
      parking_problem: { problemRule: parking.rules[2], supportPhone: parking.supportPhone }
    };
    return { parking: subsets[intent] || subsets.parking_availability };
  }
  if (topic === "subsidy") {
    if (intent === "subsidy_participation") {
      return {
        governmentSubsidy2026: {
          publicName: hotelKnowledge.governmentSubsidy2026.publicName,
          hotelParticipation: hotelKnowledge.governmentSubsidy2026.hotelParticipation,
          period: hotelKnowledge.governmentSubsidy2026.period
        }
      };
    }
    if (intent === "subsidy_documentation") {
      return {
        governmentSubsidy2026: {
          period: hotelKnowledge.governmentSubsidy2026.period,
          requiredPreviousNightProof: null,
          authorityRule: hotelKnowledge.governmentSubsidy2026.authorityRule,
          guestKnowledgeBoundary: hotelKnowledge.governmentSubsidy2026.guestKnowledgeBoundary
        },
        unknownInformationPolicy: hotelKnowledge.unknownInformationPolicy
      };
    }
    if (intent === "subsidy_date_applicability") {
      return {
        governmentSubsidy2026: {
          period: hotelKnowledge.governmentSubsidy2026.period,
          applicableStayDays: hotelKnowledge.governmentSubsidy2026.applicableStayDays,
          qualificationRule: hotelKnowledge.governmentSubsidy2026.qualificationRule,
          authorityRule: hotelKnowledge.governmentSubsidy2026.authorityRule
        },
        requestContext: requestContext || subsidyDateRequestContext("")
      };
    }
    return { governmentSubsidy2026: hotelKnowledge.governmentSubsidy2026 };
  }
  if (topic === "booking") {
    return {
      identity: { bookingUrl: hotelKnowledge.identity.bookingUrl },
      contact: {
        frontDeskPhone: hotelKnowledge.contact.frontDeskPhone,
        deskHours: hotelKnowledge.contact.deskHours,
        line: hotelKnowledge.contact.line
      },
      booking: hotelKnowledge.booking
    };
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
      parking_partner_location: ["parking.hotelSpaces", "parking.hotelSpacesLocation", "parking.partnerLots[0].name", "parking.partnerLots[0].location", "parking.partnerLots[0].landmark", "parking.partnerLots[0].walkingMinutes", "parking.partnerLots[0].navigation", "parking.processRule"],
      parking_location: ["parking.hotelSpaces", "parking.hotelSpacesLocation", "parking.overflowRule", "parking.alternatives", "parking.partnerLots[0].name", "parking.partnerLots[0].location", "parking.partnerLots[0].walkingMinutes"],
      parking_process: ["parking.rules[0]"],
      parking_reservation: ["parking.reservationPolicy.reservable", "parking.reservationPolicy.allocation", "parking.reservationPolicy.rationale", "parking.reservationPolicy.arrivalAssistance"],
      parking_problem: ["parking.rules[2]", "parking.supportPhone"]
    }[intent] || ["parking.hotelSpaces", "parking.hotelSpacesLocation", "parking.overflowRule", "parking.alternatives"],
    subsidy: {
      subsidy_overview: ["governmentSubsidy2026.period", "governmentSubsidy2026.applicableStayDays", "governmentSubsidy2026.weekdayStayAward", "governmentSubsidy2026.participationLimit", "governmentSubsidy2026.qualificationRule", "governmentSubsidy2026.authorityRule"],
      subsidy_participation: ["governmentSubsidy2026.publicName", "governmentSubsidy2026.hotelParticipation", "governmentSubsidy2026.period"],
      subsidy_date_applicability: ["governmentSubsidy2026.period", "governmentSubsidy2026.applicableStayDays", "governmentSubsidy2026.qualificationRule", "governmentSubsidy2026.authorityRule", "requestContext.requestedStayDate", "requestContext.requestedWeekday", "requestContext.holidayRelationship"],
      subsidy_period: ["governmentSubsidy2026.period", "governmentSubsidy2026.applicableStayDays", "governmentSubsidy2026.authorityRule"],
      subsidy_amount: ["governmentSubsidy2026.weekdayStayAward", "governmentSubsidy2026.qualificationRule"],
      subsidy_booking_channel: ["governmentSubsidy2026.bookingChannels"],
      subsidy_participation_limit: ["governmentSubsidy2026.participationLimit"],
      subsidy_birthday_voucher: ["governmentSubsidy2026.birthdayVoucher", "governmentSubsidy2026.qualificationRule"],
      subsidy_taiwan_pass: ["governmentSubsidy2026.taiwanPass", "governmentSubsidy2026.qualificationRule"],
      subsidy_stacking: ["governmentSubsidy2026.stacking", "governmentSubsidy2026.qualificationRule"],
      subsidy_registration: ["governmentSubsidy2026.registration"],
      subsidy_documentation: ["governmentSubsidy2026.period", "governmentSubsidy2026.requiredPreviousNightProof", "governmentSubsidy2026.authorityRule", "unknownInformationPolicy"],
      subsidy_eligibility: ["governmentSubsidy2026.qualificationRule", "governmentSubsidy2026.authorityRule"],
      subsidy_third_night: ["governmentSubsidy2026.weekdayStayAward.thirdNight", "governmentSubsidy2026.authorityRule"]
    }[intent] || ["governmentSubsidy2026.period", "governmentSubsidy2026.weekdayStayAward", "governmentSubsidy2026.qualificationRule"],
    booking: {
      booking_direct: ["contact.frontDeskPhone", "contact.deskHours", "contact.line", "identity.bookingUrl", "booking.livePriceAndAvailability"],
      booking_availability: ["identity.bookingUrl", "booking.livePriceAndAvailability"],
      booking_modify_cancel: ["booking.hotelOrWebsite", "booking.platforms", "booking.cancellationPolicy", "contact.frontDeskPhone", "contact.deskHours"]
    }[intent] || ["identity.bookingUrl", "booking.livePriceAndAvailability"],
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

export function groundingForTopics(message, topics, history = [], storedIntent = null, semanticIntents = {}, temporalContext = null) {
  const selectedTopics = [...new Set((Array.isArray(topics) ? topics : []).filter(topic => Object.hasOwn(TOPIC_PATTERNS, topic)))];
  if (selectedTopics.length > 1) {
    const groundings = selectedTopics.map(topic => {
      const intent = semanticIntents[topic] || resolveRequestedIntent(message, topic, history, storedIntent);
      const requestContext = topic === "subsidy" && intent === "subsidy_date_applicability" ? subsidyDateRequestContext(message, temporalContext) : null;
      return { topic, intent, facts: factsForTopic(topic, intent, requestContext), contract: factualContract(topic, intent) };
    });
    const facts = Object.assign({}, ...groundings.map(item => item.facts || {}));
    const requiredFactIds = [...new Set(groundings.flatMap(item => item.contract?.requiredFactIds || []))];
    return {
      topic: "multi",
      intent: "multiple",
      topics: selectedTopics,
      groundings,
      facts,
      contract: Object.freeze({
        topic: "multi", intent: "multiple", knowledgeVersion: KNOWLEDGE_VERSION, requiredFactIds,
        precedence: ["authoritative_hotel_knowledge", "current_message_semantics", "conversation_topic", "conversation_history", "reasoning", "hospitality_personality"],
        historyPolicy: "Conversation history resolves references only. User and assistant prose are not authoritative hotel facts.",
        modalityPolicy: "Preserve hard_rule, recommendation and optional semantics exactly; never rewrite a recommendation as a requirement.",
        coveragePolicy: "Address every explicit topic in the current message. If the requested relationship between topics is not stated in authoritative facts, say it is unconfirmed and ask only the necessary clarification."
      })
    };
  }
  const topic = selectedTopics[0] || null;
  const intent = semanticIntents[topic] || resolveRequestedIntent(message, topic, history, storedIntent);
  const requestContext = topic === "subsidy" && intent === "subsidy_date_applicability" ? subsidyDateRequestContext(message, temporalContext) : null;
  const facts = topic === "transportation" && /接駁|shuttle/iu.test(String(message || ""))
    ? { transportation: { shuttle: null } }
    : factsForTopic(topic, intent, requestContext);
  return { topic, intent, facts, contract: factualContract(topic, intent) };
}

export function resolveKnowledgeGrounding(message, history = [], storedTopic = null, storedIntent = null, temporalContext = null) {
  return groundingForTopics(message, resolveConversationTopics(message, history, storedTopic), history, storedIntent, {}, temporalContext);
}

export function knowledgeGroundingInstructions(grounding = null) {
  const selected = grounding?.facts ? `\n本輪依 topic 重新取得的正式事實：\n${JSON.stringify(grounding.facts, null, 2)}\n本輪 factual contract：\n${JSON.stringify(grounding.contract, null, 2)}${grounding.semanticRoute ? `\n本輪已驗證的語意路由（只描述客人需求，不是飯店事實）：\n${JSON.stringify(grounding.semanticRoute, null, 2)}` : ""}` : "";
  const parkingContracts = ["parking_availability", "parking_fee", "parking_partner_location", "parking_location", "parking_process", "parking_reservation", "parking_problem"].map(intent => factualContract("parking", intent));
  const subsidyContracts = ["subsidy_overview", "subsidy_participation", ...Object.keys(SUBSIDY_INTENT_PATTERNS)].map(intent => factualContract("subsidy", intent));
  return `事實優先順序固定為：正式飯店知識 > 對話 topic/state > 對話歷史 > 推理 > 待客語氣。判定 topic/state 前，必須先理解目前整句的主詞、受詞、時間、否定、條件與真正問題；目前整句永遠優先於舊的 topic/state，不得因單一模糊詞直接套用固定答案。「折抵」本身不代表停車，只有同句明確提到停車、車位、車號，或最近對話已明確延續停車主題時，才能套用停車系統流程。若同句有多個主題，必須逐一處理；若無法判斷「折抵」指停車或住宿補助，先用一個簡短問題釐清，不得猜測。對話歷史只可用來理解指代、topic、intent、語言、日期與客人意圖；其中 user 陳述與 assistant 歷史回答都不是飯店事實。歷史若與目前正式知識衝突，必須忽略歷史並依目前正式知識更正。不得從 serviceHours 自行推論點餐截止、用餐結束或其他未明載規則。必須保留 hard_rule、recommendation、optional 的強度；recommendation 絕不可改寫為必須、強制或 requirement。Parking 必須先區分 availability、fee、partner location、general location、process、reservation、problem intent，再只用該 intent 的 fact subset；客人問配合／特約停車場位置時，必須回答已確認的位置地標、步行時間與車號流程，不得只重播飯店門口車位數，也不得補回已移除的智惠街門牌：${JSON.stringify(parkingContracts)}。政府住宿補助必須依 Asia/Taipei 的伺服器日期區分尚未開始、活動期間與已結束，且只能回答旅客公開規則；不得保證資格、額度或經費，不得索取證件或個資，不得揭露內部核銷 SOP。詢問某天、平日、週幾、國定連假或連假前一天是否適用時，必須使用 subsidy_date_applicability；先說明週日至週四適用、週五週六及國定連續假日不適用。若客人沒有提供實際入住日期，只追問一次日期，不得只回覆「以政府系統為準」；若已有日期，先依活動期間與星期直接回答日期規則，再把個人資格與額度留給政府系統確認。旅客詢問連續住宿是否需要前一晚住宿證明時，若正式資料未明載，必須明說尚未確認並請櫃檯依政府系統或最新規定確認，不得改答停車，也不得自行推測。補助 intents 與 contracts：${JSON.stringify(subsidyContracts)}${selected}`;
}

export function parkingReply(grounding) {
  if (grounding?.topic !== "parking") return null;
  const parking = grounding.facts.parking;
  if (grounding.intent === "parking_fee") return parking.feeRule;
  if (grounding.intent === "parking_partner_location") {
    const lot = parking.partnerLots?.[0];
    return lot ? `門口滿位時，櫃檯會引導至步行約 ${lot.walkingMinutes} 分鐘、位於${lot.location}的「${lot.name}」。${parking.processRule}` : null;
  }
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
