import { hotelKnowledge, KNOWLEDGE_VERSION, groundedKnowledgePrompt } from "./knowledge.js";
import { bookingDates, datedBookingUrl, hasBookingIntent } from "./booking.js";
import { detectGuestLanguage } from "../guest-language.js";
import { requestGroundedResponse } from "./response-service.js";
import { applyCorePersonalityContract, renderHospitalityFact, styledInstructions } from "./hospitality-personality.js";
import { temporalContextPrompt, temporalContextProvider } from "./temporal-context.js";
import { breakfastArrivalReply, knowledgeGroundingInstructions, parkingReply, resolveKnowledgeGrounding, validateGroundedResponse } from "./knowledge-grounding.js";
import { tryAiFirstReasoning } from "./ai-orchestrator.js";
import { configuredReasoning, configuredTextModel, DEFAULT_TEXT_REASONING_EFFORT } from "./model-config.js";
import { groundedFactSet, verifyFinalResponse } from "./reasoning-core.js";

const MAX_HISTORY_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 2_000;

export const config = { maxDuration: 30 };

export function relevantKnowledge(message) {
  if (/(退房|check[ -]?out)/i.test(message)) {
    return { stay: { checkOut: hotelKnowledge.stay.checkOut } };
  }
  return null;
}

export function normalizedHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .filter(item => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .map(item => ({ role: item.role, content: item.content.trim().slice(0, MAX_MESSAGE_LENGTH) }))
    .filter(item => item.content)
    .slice(-MAX_HISTORY_MESSAGES);
}

export { bookingDates, datedBookingUrl };

function referenceDate(temporalContext) {
  const date = temporalContext?.date;
  return /^\d{4}-\d{2}-\d{2}$/u.test(String(date || "")) ? new Date(`${date}T00:00:00Z`) : new Date();
}

// A dated booking URL is turn-derived context: the canonical booking entry is
// unchanged, while this immutable copy carries the guest's requested stay into
// every response path (deterministic, AI-first, and multi-topic composition).
export function withDatedBookingContext(grounding, message, temporalContext = temporalContextProvider.getContext()) {
  const requestedStay = bookingDates(message, referenceDate(temporalContext));
  const includesBooking = grounding?.topic === "booking" || grounding?.topics?.includes("booking");
  if (!requestedStay || !includesBooking || !grounding?.facts?.identity?.bookingUrl) return grounding;
  const bookingUrl = datedBookingUrl(requestedStay);
  const facts = { ...grounding.facts, identity: { ...grounding.facts.identity, bookingUrl } };
  const groundings = Array.isArray(grounding.groundings)
    ? grounding.groundings.map(item => item.topic === "booking"
      ? { ...item, facts: { ...item.facts, identity: { ...item.facts?.identity, bookingUrl } } }
      : item)
    : grounding.groundings;
  return { ...grounding, facts, ...(groundings ? { groundings } : {}), bookingDates: requestedStay };
}

const REPLY_TEXT = Object.freeze({
  "zh-TW": {
    booking: (dates, url) => `當然可以！如果您預計 ${dates.checkInDate} 入住、${dates.checkOutDate} 退房，可以透過下方官方訂房頁面查看最新房價與空房：\n${url}`,
    baby: name => `${name}可以協助提出需求；建議在入住前一天告知，會依數量與現場狀況安排，因此無法事先保證。`,
    parking: `飯店門口有 ${hotelKnowledge.parking.hotelSpaces} 個路邊停車格，停車位不提供預留，採先到先停。如果已經停滿，櫃檯會引導您到步行約 ${hotelKnowledge.parking.partnerLots[0].walkingMinutes} 分鐘、位於${hotelKnowledge.parking.partnerLots[0].location}的配合停車場。停好後記得把車號告訴櫃檯，我們輸入系統後，您就可以自由進出。`,
    breakfast: `有的～早餐供應時間為 ${hotelKnowledge.breakfast.serviceHours}；如果房價沒有含早餐，也可以用 ${hotelKnowledge.breakfast.pricePerPerson} 加購。`,
    confirm: summary => `如果您需要，我可以幫您把${summary}整理好，作為「留言給飯店人員」交由櫃檯確認。需要我幫您轉交嗎？`
  },
  en: {
    booking: (dates, url) => `Certainly! For a stay from ${dates.checkInDate} to ${dates.checkOutDate}, you can check the latest room availability and rates through our official booking page below:\n${url}`,
    baby: name => `We can help request ${name}. Please let the hotel know one day before arrival; arrangements depend on availability during your stay, so this cannot be guaranteed in advance.`,
    parking: `The hotel has ${hotelKnowledge.parking.hotelSpaces} roadside spaces outside the entrance, available on a first-come, first-served basis. If they are full, the front desk will direct you to our partner lot next to the All Nation Electronics Fengjia store on Qinghai Road, about a ${hotelKnowledge.parking.partnerLots[0].walkingMinutes}-minute walk away. After parking, please give your license plate number to the front desk so we can enter it in the system for free entry and exit.`,
    breakfast: `Breakfast is served from ${hotelKnowledge.breakfast.serviceHours}. If it is not included in your stay, you can add it for ${hotelKnowledge.breakfast.pricePerPerson}.`,
    confirm: summary => `If you’d like, I can organize ${summary} as a “Message hotel staff” request for confirmation. Would you like me to hand it over?`
  },
  ja: {
    booking: (dates, url) => `承知いたしました。${dates.checkInDate}チェックイン、${dates.checkOutDate}チェックアウトの最新の空室状況と料金は、下記の公式予約ページでご確認いただけます。\n${url}`,
    baby: name => `${name}のリクエストを承ります。前日までにお知らせください。数に限りがあり、当日の状況によってはご用意できない場合がございます。`,
    parking: `ホテル前に路上駐車枠が${hotelKnowledge.parking.hotelSpaces}台分あり、先着順です。満車の場合は、徒歩約${hotelKnowledge.parking.partnerLots[0].walkingMinutes}分、青海路の全国電子逢甲店隣にある提携駐車場へフロントがご案内します。駐車後は車両番号をフロントへお知らせください。システム登録後は自由に出入りできます。`,
    breakfast: `朝食は${hotelKnowledge.breakfast.serviceHours}にご利用いただけます。朝食なしのプランでも、${hotelKnowledge.breakfast.pricePerPerson}で追加できます。`,
    confirm: summary => `ご希望でしたら、${summary}を「ホテルスタッフへのメッセージ」としてまとめて確認を依頼できます。お取り次ぎしましょうか。`
  },
  ko: {
    booking: (dates, url) => `물론입니다. ${dates.checkInDate} 체크인, ${dates.checkOutDate} 체크아웃 일정의 최신 객실과 요금은 아래 공식 예약 페이지에서 확인하실 수 있습니다.\n${url}`,
    baby: name => `${name}를 요청하실 수 있습니다. 체크인 하루 전까지 알려 주세요. 수량과 당일 상황에 따라 준비되므로 사전에 확정해 드리기는 어렵습니다.`,
    parking: `호텔 앞에 노상 주차 공간 ${hotelKnowledge.parking.hotelSpaces}곳이 있으며 선착순입니다. 만차이면 프런트에서 도보 약 ${hotelKnowledge.parking.partnerLots[0].walkingMinutes}분 거리인 칭하이로의 전국전자 펑지아점 옆 제휴 주차장으로 안내해 드립니다. 주차 후 차량 번호를 알려 주시면 시스템 등록 후 자유롭게 출입하실 수 있습니다.`,
    breakfast: `조식은 ${hotelKnowledge.breakfast.serviceHours}에 이용하실 수 있습니다. 조식이 포함되지 않은 경우 ${hotelKnowledge.breakfast.pricePerPerson}에 추가할 수 있습니다.`,
    confirm: summary => `원하시면 ${summary}을 ‘호텔 직원에게 메시지 보내기’ 내용으로 정리해 확인을 요청할 수 있습니다. 전달해 드릴까요?`
  }
});

const BABY_EQUIPMENT = Object.freeze([
  { pattern: /嬰兒床|baby\s*(?:crib|cot)|\bcrib\b|\bcot\b|ベビーベッド|아기\s*침대/iu, names: { "zh-TW": "嬰兒床", en: "a baby crib", ja: "ベビーベッド", ko: "아기 침대" } },
  { pattern: /床圍|bed\s*rail|ベッドガード|침대\s*가드/iu, names: { "zh-TW": "床圍", en: "a bed rail", ja: "ベッドガード", ko: "침대 가드" } },
  { pattern: /消毒鍋|sterili[sz]er|消毒器|소독기/iu, names: { "zh-TW": "消毒鍋", en: "a sterilizer", ja: "消毒器", ko: "소독기" } },
  { pattern: /(?:嬰兒)?澡盆|baby\s*bath|ベビーバス|아기\s*욕조/iu, names: { "zh-TW": "嬰兒澡盆", en: "a baby bath", ja: "ベビーバス", ko: "아기 욕조" } }
]);

function requestedBabyEquipment(message, language) {
  return BABY_EQUIPMENT.filter(item => item.pattern.test(message)).map(item => item.names[language]);
}

function staySummary(dates, equipment, language) {
  const nights = dates ? Math.round((Date.parse(dates.checkOutDate) - Date.parse(dates.checkInDate)) / 86_400_000) : 0;
  const joined = equipment.join(language === "en" ? " and " : language === "ja" ? "と" : language === "ko" ? "와 " : "＋");
  if (!dates) return language === "en" ? `your ${joined} request` : language === "ja" ? `${joined}のご希望` : language === "ko" ? `${joined} 요청` : `${joined}需求`;
  if (language === "en") return `your ${dates.checkInDate} stay for ${nights} night${nights === 1 ? "" : "s"} and ${joined} request`;
  if (language === "ja") return `${dates.checkInDate}から${nights}泊のご宿泊と${joined}のご希望`;
  if (language === "ko") return `${dates.checkInDate}부터 ${nights}박 숙박과 ${joined} 요청`;
  return `${dates.checkInDate} 入住 ${nights} 晚＋${joined}需求`;
}

function additionalHotelNeeds(message, language = "zh-TW") {
  const needs = [];
  const add = (pattern, answer, confirmationNeeded = false) => {
    if (pattern.test(message)) needs.push({ answer, confirmationNeeded });
  };

  const copy = REPLY_TEXT[language];
  for (const equipment of requestedBabyEquipment(message, language)) {
    needs.push({ answer: copy.baby(equipment), confirmationNeeded: true, equipment });
  }
  if (/停車|車位|parking|駐車|주차/iu.test(message)) {
    const equipment = language === "en" ? "parking" : language === "ja" ? "駐車場" : language === "ko" ? "주차" : "停車";
    needs.push({ answer: copy.parking, confirmationNeeded: false, equipment });
  }
  add(/早餐|餐點|素食|breakfast|vegetarian|朝食|조식/iu, copy.breakfast);
  add(/牙刷|備品|盥洗|毛巾|浴巾|拖鞋/u, hotelKnowledge.amenities.toiletries);
  add(/電視|Netflix|YouTube/u, hotelKnowledge.amenities.tv);
  add(/洗衣|烘衣/u, hotelKnowledge.amenities.laundry);
  add(/充電器|轉接頭|雨傘/u, hotelKnowledge.amenities.loans);
  add(/提早入住/u, hotelKnowledge.stay.earlyCheckIn, true);
  add(/延後退房/u, hotelKnowledge.stay.lateCheckOut, true);
  add(/加床/u, `${hotelKnowledge.extraBed.price}；是否可加床仍須依房型與現場狀況確認。`, true);

  if (/(設備故障|壞掉|無法使用|沒反應|特殊需求|過敏|無障礙|慶生)/u.test(message)) {
    needs.push({ answer: "這項需求可以請飯店人員依現場狀況進一步確認，但目前無法預先保證。", confirmationNeeded: true });
  }
  return needs;
}

export function availabilityReply(message, now = new Date()) {
  if (!hasBookingIntent(message)) return null;
  const dates = bookingDates(message, now);
  if (!dates) return null;
  const language = detectGuestLanguage(message);
  const copy = REPLY_TEXT[language];
  const booking = copy.booking(dates, datedBookingUrl(dates));
  const needs = additionalHotelNeeds(message, language);
  if (!needs.length) return booking;

  const parts = [booking, ...needs.map(need => need.answer)];
  if (needs.some(need => need.confirmationNeeded)) {
    const equipment = needs.map(need => need.equipment).filter(Boolean);
    const generic = language === "en" ? "request" : language === "ja" ? "ご要望" : language === "ko" ? "요청 사항" : "其他需求";
    parts.push(copy.confirm(staySummary(dates, equipment.length ? equipment : [generic], language)));
  }
  return parts.join("\n\n");
}

export function specialRequestReply(message) {
  const language = detectGuestLanguage(message);
  const equipment = requestedBabyEquipment(message, language);
  if (!equipment.length) return null;
  const copy = REPLY_TEXT[language];
  return [...equipment.map(name => copy.baby(name)), copy.confirm(staySummary(null, equipment, language))].join("\n\n");
}

export function breakfastReply(message) {
  if (!/(早餐|早午餐|餐點|菜色|咖啡|素食|外帶|breakfast|brunch|vegetarian|朝食|조식|小朋友多少錢)/iu.test(message)) return null;
  if (detectGuestLanguage(message) !== "zh-TW") return REPLY_TEXT[detectGuestLanguage(message)].breakfast;

  const breakfast = hotelKnowledge.breakfast;
  if (/(自助|buffet)/iu.test(message)) {
    return `早餐主要是 ${breakfast.serviceStyle.replace("，並非整套自助式早餐。", "；")}${breakfast.selfServiceDrinks.replace("（例如咖啡）採", "像咖啡是").replace("。", "的。")}`;
  }
  if (/(中式|西式|哪一式|類型)/u.test(message)) {
    return `是${breakfast.cuisineStyle.replace("中西式，", "中西式的 Brunch 套餐，").replace("較", "比較")}`;
  }
  if (/(有什麼|什麼菜|菜色|內容|吃什麼|口味)/u.test(message)) {
    return `主餐有 ${breakfast.menuChoiceCount} 種口味可選，餐點內容會不定時更換，請以當天 Menu 為準。`;
  }
  if (/(兒童|小朋友|小孩).*(多少|價格|費用|價錢)|(?:多少|價格|費用|價錢).*(兒童|小朋友|小孩)/u.test(message)) {
    return breakfast.childPrice === null ? unknownInformationReply(message) : `有的～兒童早餐價格是 ${breakfast.childPrice}。`;
  }
  if (/(外帶|帶走)/u.test(message)) {
    return breakfast.takeawayAvailable ? `可以外帶，請${breakfast.notes.find(note => note.includes("外帶")).replace(/^如需外帶，可/, "")}` : "目前沒有提供早餐外帶。";
  }
  if (/(素食|蛋奶素|吃素)/u.test(message)) {
    return `可以喔～如果您有素食需求，可以提前告知櫃台，我們會請餐廳協助調整成蛋奶素餐點。`;
  }
  if (/(幾點|時間|供應到|開始|結束)/u.test(message)) return `早餐時間是 ${breakfast.serviceHours} 喔～`;
  if (/(多少|價格|費用|價錢|加購)/u.test(message)) return `早餐加購是 ${breakfast.pricePerPerson}。`;
  if (/(哪裡|地點|幾樓)/u.test(message)) return `早餐在${breakfast.location}用餐。`;
  return REPLY_TEXT["zh-TW"].breakfast;
}

export function informationalReply(message) {
  const language = detectGuestLanguage(message);
  const copy = REPLY_TEXT[language];
  const asksBreakfast = /早餐|餐點|素食|breakfast|vegetarian|朝食|조식/iu.test(message);
  const asksParking = /停車|車位|parking|駐車|주차/iu.test(message);
  if (asksBreakfast && !asksParking) return breakfastReply(message);
  if (asksParking && !asksBreakfast) return copy.parking;
  if (asksBreakfast && asksParking) return `${copy.parking}\n\n${breakfastReply(message)}`;
  return null;
}

// Deterministic safety replies for situations where friendly wording must never
// imply that an operational action has already happened.
export function sensitiveSituationReply(message) {
  if (/(冷氣|空調|電視|熱水|門鎖|房內設備).*(壞|故障|沒反應|無法使用)|(?:壞|故障|沒反應|無法使用).*(冷氣|空調|電視|熱水|門鎖|房內設備)/u.test(message)) {
    return "房內設備不能使用真的會很不方便。請直接聯絡櫃檯，我們會請同仁盡快確認處理。";
  }
  if (/(客訴|投訴|抱怨|很不滿|太糟|非常生氣)/u.test(message)) {
    return "很抱歉讓您有這麼不好的感受。可以告訴我現在最需要先處理的是什麼嗎？我會請飯店同仁了解狀況並協助您。";
  }
  if (/(退款|退費|重複扣款|付款異常|刷卡失敗|扣款).*(幫我|處理|怎麼辦|還沒|沒有|問題|異常|失敗)?/u.test(message)) {
    return "了解，付款或退款狀況需要由原付款管道確認。請聯絡櫃檯；如果是透過訂房平台付款，也請向原平台查詢，我這邊不會先承諾退款或款項已處理。";
  }
  if (/(修改|更改|取消).*(訂房|預訂|日期|入住)|(?:訂房|預訂).*(修改|更改|取消)/u.test(message)) {
    return "可以協助確認修改方式，但我這邊還沒有替您完成變更。若是向飯店或官網訂房，請聯絡櫃檯；若是透過訂房平台預訂，原則上請向原平台申請。";
  }
  return null;
}

export function frontDeskContactReply(message) {
  if (!/(櫃台|櫃檯|front desk|reception).*(電話|聯絡|怎麼找)|(?:電話|聯絡).*(櫃台|櫃檯)/iu.test(message)) return null;
  return `可以直接撥櫃檯電話 ${hotelKnowledge.contact.frontDeskPhone}，服務時間是 ${hotelKnowledge.contact.deskHours}。需要我幫您通知櫃檯嗎？`;
}

const QUESTION_PATTERN = /[?？]|(?:嗎|呢|哪(?:裡|邊)?|多少|幾點|怎麼|如何|是否|有沒有)\s*[。！!]*$/iu;
const UNSUPPORTED_HOTEL_DETAIL = /浴缸|熨斗|停車場客服|接駁|游泳池|健身(?:房|室)|微波爐|bathtub|iron|pool|gym|microwave|shuttle/iu;
const DYNAMIC_LOCAL_TOPIC = /餐廳|美食|景點|附近|天氣|restaurant|attraction|weather/iu;
const KNOWN_MISSING_DETAIL = /(?:兒童|小朋友|小孩).*(?:早餐).*(?:多少|價格|費用|價錢)|(?:早餐).*(?:兒童|小朋友|小孩).*(?:多少|價格|費用|價錢)|家庭房.*浴缸|浴缸.*家庭房|停車場.*(?:客服|電話)|(?:取消|退款).*(?:條件|規定|費用|金額)|(?:床墊|寢具).*(?:品牌|型號|尺寸|售價|哪一牌)|(?:補助|住宿獎助).*(?:第三晚|第\s*3\s*晚)|(?:第二晚|連續入住).*(?:第一晚|住宿證明|證明)|(?:機場|高鐵|車站)?.{0,8}接駁/iu;

export function unknownInformationReply(message) {
  const phone = hotelKnowledge.contact.frontDeskPhone;
  const language = detectGuestLanguage(message);
  if (language === "en") return `I’m sorry, but I don’t have confirmed information for this question. If you need an answer urgently, please call the front desk at ${phone}; or reply “Connect me with the front desk” and I’ll help you leave a message.`;
  if (language === "ja") return `申し訳ありませんが、このご質問について確認済みの情報がありません。お急ぎの場合はフロント（${phone}）へお電話いただくか、「フロントに取り次いで」とご返信ください。伝言受付へご案内します。`;
  if (language === "ko") return `죄송하지만 이 질문은 확인된 정보가 없습니다. 급하시면 프런트(${phone})로 전화하시거나 “프런트에 연결해 주세요”라고 답해 주시면 메시지 접수를 도와드리겠습니다.`;
  return `不好意思，這個問題我目前沒有確認到正確資料。若您急著確認，可以撥打櫃檯電話 ${phone}；也可以回覆「幫我轉接櫃檯」，我會協助您留言給櫃檯。`;
}

function requiresUnknownInformationReply(message, grounding) {
  const source = String(message || "");
  if (KNOWN_MISSING_DETAIL.test(source)) return true;
  if (grounding?.topic === "unknown") return true;
  if (grounding?.topic !== null && grounding?.topic !== undefined) return false;
  return QUESTION_PATTERN.test(source) && UNSUPPORTED_HOTEL_DETAIL.test(source) && !DYNAMIC_LOCAL_TOPIC.test(source);
}

export function responsesPayload(message, history = [], channel = "web", temporalContext = temporalContextProvider.getContext(), grounding = resolveKnowledgeGrounding(message, history), env = process.env) {
  grounding = withDatedBookingContext(grounding, message, temporalContext);
  const conversation = normalizedHistory(history);
  const responseLanguage = detectGuestLanguage(message, conversation);
  const contextText = [...conversation.map(item => item.content), message].join("\n");
  const relevant = relevantKnowledge(contextText);
  const model = configuredTextModel(env);
  return {
    model,
    max_output_tokens: 1_200,
    ...configuredReasoning(model, env, {
      componentKeys: ["OPENAI_RESPONSE_REASONING_EFFORT"],
      fallback: DEFAULT_TEXT_REASONING_EFFORT
    }),
    instructions: `${styledInstructions(channel)}

${temporalContextPrompt(temporalContext)}

${knowledgeGroundingInstructions(grounding)}

支援繁體中文（zh-TW）、English（en）、日本語（ja）、한국어（ko）。本次判定旅客主要語言為 ${responseLanguage}，必須使用該語言並全程以該語言簡潔回答；不要因下方飯店資料是繁體中文而改用中文，也不要夾雜其他語言。專有名詞、飯店名稱與網址可保留原文。若語言無法可靠判斷則使用繁體中文。
判斷時以旅客目前訊息為優先，並參考最近對話；回答原則上跟隨目前訊息的語言。
先自然回應旅客的需求，再提供必要資訊與下一步。只抽取與旅客這次實際詢問直接相關的知識，不要整段複述知識來源，也不要自行增加同類用品（例如只問嬰兒床時，不得順帶列出床圍、消毒鍋或澡盆）。一般回答控制在 2～4 個短段落，每段只聚焦一件事，避免重複同義提醒。使用親切、簡潔、有服務感但不過度客套的語氣；不要採用系統公告、FAQ、制式標題或機械式編號清單。不要以「AI 無法」、「系統無法」、「AI cannot」或其他負面能力聲明開頭，也不要在每段重複致謝或「很高興為您服務」等客套話。
只有旅客表達明確訂房或住宿意圖時，才在回答問題後自然提供一次官方訂房入口；單純詢問早餐、停車、交通或其他一般資訊時不得附上訂房連結，也不要重複貼連結或過度推銷。
遇到複合問題時，像真人櫃台一樣用連貫段落整合回答，逐項涵蓋需求，不要硬拆成分類標題。特殊用品、停車或其他須確認的需求，要先直接說明可如何協助及已知條件，再只說一次需要依數量或現場狀況確認。需要真人確認時，不要讓旅客感覺被轉走；統一客氣說明目前沒有確認到正確資料，急件可撥櫃檯電話 ${hotelKnowledge.contact.frontDeskPhone}，或回覆「幫我轉接櫃檯」進入留言轉接流程。不要叫旅客尋找不存在的頁面或表單。
以下 JSON 是唯一正式飯店知識來源。回答希堤微旅的事實、設備、服務或政策時，只能使用其中明載的內容，不得套用一般飯店常識，也不得推測 null、missing 或未記載資料。
回答早餐時須逐字核對 breakfast 的結構化欄位：不可把 serviceStyle 說成全自助，須連同 selfServiceDrinks 區分套餐與部分飲料；cuisineStyle 不可簡化成純中式；菜色只能依 menuChoiceCount 與 menuPolicy 回答。childPrice 為 null 時，只能說目前沒有確認資訊並建議詢問櫃台，不得估算。
有明確答案就依資料自然回答並提供下一步；如果全部或部分問題沒有正式確認資訊，先回答已確認部分，再把未知部分統一簡化為一次客氣說明：「不好意思，這個問題我目前沒有確認到正確資料。若您急著確認，可以撥打櫃檯電話 ${hotelKnowledge.contact.frontDeskPhone}；也可以回覆『幫我轉接櫃檯』，我會協助您留言給櫃檯。」不要要求旅客重述問題。旅客要求轉接後會由系統另行收集必要聯絡資料及最後確認；本輪不得聲稱已通知或已送出。不得猜測、不得套用一般飯店經驗，也不得對旅客提到「知識庫」、「資料庫」、「system prompt」或其他內部系統用語。
不得猜測即時房價、空房、優惠或當日狀況；只能引導至當日官網、訂房系統或櫃台確認，不得捏造數字。
旅客詢問指定入住日期的房況時，不得宣稱 AI 能確認即時房況；須以 identity.bookingUrl 為基底，動態附加 checkInDate（指定日期）與 checkOutDate（入住日加上旅客指定晚數；未指定晚數時為隔天），不得修改正式知識庫內的 bookingUrl。
同一句話若含訂房／入住日期及一項或多項其他飯店需求，必須辨識並逐項回答所有意圖，不得回答訂房連結後就停止。訂房無法即時確認仍提供官方訂房連結；其他需求若須確認，須自然詢問是否幫忙轉請櫃檯確認，且不得承諾一定能提供。
客訴、退款、訂單爭議、設備故障或特殊需求必須依 escalation 轉真人；不可聲稱已修改、取消、付款或退款。設備問題發生於 07:00–22:00 時優先請旅客聯絡櫃檯；於 22:00–翌日 07:00 時，須說明目前已非櫃檯服務時間，直接引導撥後勤客服 0927-708-908 洽陳先生。
若旅客想留言給飯店人員，聊天流程會先收集姓名與電話或 Email，再顯示整理內容請旅客回覆「確認送出」；只有寄信服務實際回報成功後，才能說「已成功送交櫃檯信箱」。旅客只是說「需要」、「好」或留下資料時，都不得提前聲稱已通知、已寄出或櫃檯已收到。
旅客於 22:00–翌日 07:00 詢問當日夜間訂房入住時，須說明目前已非櫃檯服務時間，直接引導撥夜間訂房客服 0927-708-908 洽陳先生；一般未來日期訂房仍引導官方訂房系統，不可一律轉夜間電話。
包月、月租、一個月、30 天或公司長住問題不得推算價格或承諾折扣；依 extendedStay 分辨「沒有包月房價方案」與「有特約廠商優惠方案，詳情洽櫃檯」。休息、鐘點房或短時間休息須明確回答目前沒有提供，不可報價。床墊僅能回答五星級高級床墊；購買問題轉洽櫃檯，不得猜測品牌、型號、尺寸或售價。
餐廳具體店名屬變動資訊；若無法即時查證，先詢問餐飲偏好並說明須查詢最新營業資訊，不可編造店家。
請連貫理解下方對話脈絡。旅客使用「那」、「這個」、「兩個人呢」、「如果晚一點呢」等承接語時，應依最近對話判斷所指主題；計算仍只能使用正式知識庫已確認的數字。

${groundedKnowledgePrompt()}${relevant ? `\n\n從正式知識庫擷取的本題相關欄位（內容完全相同，回答時優先核對）：\n${JSON.stringify(relevant, null, 2)}` : ""}`,
    input: [...conversation, { role: "user", content: message }]
  };
}

export function groundedPresentationPayload({ message, history = [], channel = "web", grounding, draft, env = process.env }) {
  const conversation = normalizedHistory(history);
  const language = detectGuestLanguage(message, conversation);
  const model = configuredTextModel(env);
  return {
    model,
    max_output_tokens: 500,
    ...configuredReasoning(model, env, {
      componentKeys: ["OPENAI_RESPONSE_REASONING_EFFORT"],
      fallback: DEFAULT_TEXT_REASONING_EFFORT
    }),
    instructions: `${styledInstructions(channel)}

Rewrite the supplied grounded_draft as one natural hotel front-desk reply in ${language}. The draft is a factual fallback, not a wording template. Use only grounded_facts as hotel truth and preserve every number, price, date, address, URL, condition, limitation, and action status exactly. Do not add a fact or claim that staff acted.

Match the guest's actual speech act before choosing the opening. A question about location must answer where; a cost question must state the fee first; a time question must state the time; a process question must state the next step; a statement of confusion should be acknowledged with useful direction. Never begin with 可以、可以的、可以喔、當然可以、沒問題, or an equivalent permission confirmation unless the guest actually asked whether something is allowed, available, or can be arranged. Do not manufacture warmth with a generic acknowledgement, repeated ～, or a stock phrase. Keep LINE and messaging replies to one or two short paragraphs and do not repeat the previous answer.

Return only the guest-facing reply.`,
    input: JSON.stringify({
      current_user_message: message,
      recent_history: conversation,
      topic: grounding?.topic,
      intent: grounding?.intent,
      grounded_facts: grounding?.facts,
      factual_contract: grounding?.contract,
      grounded_draft: draft
    })
  };
}

function safePresentationError(error) {
  const candidate = error?.code || error?.message;
  return typeof candidate === "string" && /^[a-z0-9_]{1,64}$/iu.test(candidate) ? candidate : "grounded_presentation_error";
}

const GENERIC_PERMISSION_OPENING = /^(?:好的|了解|可以(?:的|喔)?|當然可以|沒問題)(?:[～~，,。.!！\s]|$)/u;
const EXPLICIT_PERMISSION_REQUEST = /(?:可以|可不可以|可否|能不能|能否|請幫|幫我|協助我|\b(?:can|could|may|would)\b.{0,24}\b(?:you|i|we)\b|できますか|可能ですか|お願い|할 수 있|가능한가|도와)/iu;

function openingMatchesSpeechAct(answer, message) {
  return !GENERIC_PERMISSION_OPENING.test(String(answer || "").trim()) || EXPLICIT_PERMISSION_REQUEST.test(String(message || ""));
}

export async function composeGroundedPresentation({ message, history = [], channel = "web", grounding, draft, env = process.env, request = requestGroundedResponse, logger = console }) {
  if (!env.OPENAI_API_KEY?.trim()) return draft;
  const selectedFacts = groundedFactSet(grounding?.facts);
  try {
    const result = await request({
      payload: groundedPresentationPayload({ message, history, channel, grounding, draft, env }),
      apiKey: env.OPENAI_API_KEY.trim(),
      validate: answer => openingMatchesSpeechAct(answer, message) && validateGroundedResponse(answer, grounding) && verifyFinalResponse({
        answer,
        selectedFacts,
        toolResult: { status: "not_requested" }
      }).valid
    });
    return result.answer.trim();
  } catch (error) {
    logger?.info?.("[grounded-presentation]", { event: "fallback_used", code: safePresentationError(error), topic: grounding?.topic || "unknown" });
    return draft;
  }
}

export function responseText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  return (Array.isArray(response?.output) ? response.output : [])
    .filter(item => item?.type === "message")
    .flatMap(item => Array.isArray(item.content) ? item.content : [])
    .filter(item => item?.type === "output_text" && typeof item.text === "string")
    .map(item => item.text.trim())
    .filter(Boolean)
    .join("\n");
}

export function finalizeGuestAnswer(draft, { message, history = [], channel = "web" } = {}) {
  const language = detectGuestLanguage(message, normalizedHistory(history));
  return applyCorePersonalityContract({ draft, message, language, channel }).text;
}

export async function answerGuestMessage(message, { history = [], channel = "web", identity, temporalContext = temporalContextProvider.getContext(), grounding = resolveKnowledgeGrounding(message, history), orchestrate, request = requestGroundedResponse, env = process.env, logger = console } = {}) {
  const trimmed = typeof message === "string" ? message.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
  if (!trimmed) throw new TypeError("A non-empty guest message is required");
  const language = detectGuestLanguage(trimmed, normalizedHistory(history));
  grounding = withDatedBookingContext(grounding, trimmed, temporalContext);
  if (requiresUnknownInformationReply(trimmed, grounding)) {
    return finalizeGuestAnswer(unknownInformationReply(trimmed), { message: trimmed, history, channel });
  }
  // This module only composes presentation. Authorization and every external
  // side effect are owned by conversation/runtime.js.
  const aiFirst = await tryAiFirstReasoning({ message: trimmed, history: normalizedHistory(history), channel, identity, grounding, orchestrate, env, logger });
  if (aiFirst) return finalizeGuestAnswer(aiFirst.answer, { message: trimmed, history, channel });
  // Multiple explicit topics require the language model to preserve the
  // relationship between them. Concatenating canned answers can be accurate in
  // isolation while still missing what the guest actually asked.
  if (grounding.topic === "multi" || grounding.semanticRoute?.clarificationNeeded) {
    const payload = responsesPayload(trimmed, history, channel, temporalContext, grounding, env);
    const generated = (await request({ payload, apiKey: env.OPENAI_API_KEY?.trim(), validate: answer => validateGroundedResponse(answer, grounding) })).answer;
    return finalizeGuestAnswer(generated, { message: trimmed, history, channel });
  }
  const groundedHospitalityAnswer = renderHospitalityFact({ ...grounding, language, channel, temporalContext });
  if (groundedHospitalityAnswer) {
    const presented = await composeGroundedPresentation({ message: trimmed, history, channel, grounding, draft: groundedHospitalityAnswer, env, request, logger });
    return finalizeGuestAnswer(presented, { message: trimmed, history, channel });
  }
  const directAnswer = breakfastArrivalReply(trimmed, grounding) || parkingReply(grounding) || frontDeskContactReply(trimmed) || sensitiveSituationReply(trimmed) || availabilityReply(trimmed) || specialRequestReply(trimmed) || informationalReply(trimmed);
  if (directAnswer) return finalizeGuestAnswer(directAnswer, { message: trimmed, history, channel });

  const payload = responsesPayload(trimmed, history, channel, temporalContext, grounding, env);
  const generated = (await request({ payload, apiKey: env.OPENAI_API_KEY?.trim(), validate: answer => validateGroundedResponse(answer, grounding) })).answer;
  return finalizeGuestAnswer(generated, { message: trimmed, history, channel });
}
