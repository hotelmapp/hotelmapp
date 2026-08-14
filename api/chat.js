import { hotelKnowledge, knowledgeForPrompt } from "../data/hotel-info.js";
import { detectGuestLanguage } from "../guest-language.js";
import { bookingDatesFromText } from "../stay-dates.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
const REQUEST_TIMEOUT_MS = 25_000;
const KNOWLEDGE_VERSION = "2.0";
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

export function bookingDates(message, now = new Date()) {
  return bookingDatesFromText(message, now);
}

export function datedBookingUrl(dates) {
  const url = new URL(hotelKnowledge.identity.bookingUrl);
  url.searchParams.set("checkInDate", dates.checkInDate);
  url.searchParams.set("checkOutDate", dates.checkOutDate);
  return url.toString();
}

const REPLY_TEXT = Object.freeze({
  "zh-TW": {
    booking: (dates, url) => `當然可以！如果您預計 ${dates.checkInDate} 入住、${dates.checkOutDate} 退房，可以透過下方官方訂房頁面查看最新房價與空房：\n${url}`,
    baby: name => `${name}可以協助提出需求；建議在入住前一天告知，會依數量與現場狀況安排，因此無法事先保證。`,
    parking: `飯店有 ${hotelKnowledge.parking.hotelSpaces} 個車位，另有配合停車場；實際車位仍需依當日現場狀況安排。`,
    breakfast: `早餐供應時間為 ${hotelKnowledge.breakfast.hours}，未含早餐也可以加購，每客 NT$150。`,
    confirm: summary => `如果您需要，我可以幫您把${summary}整理好，透過下方「留言給飯店人員」表單交給飯店人員確認。`
  },
  en: {
    booking: (dates, url) => `Certainly! For a stay from ${dates.checkInDate} to ${dates.checkOutDate}, you can check the latest room availability and rates through our official booking page below:\n${url}`,
    baby: name => `We can help request ${name}. Please let the hotel know one day before arrival; arrangements depend on availability during your stay, so this cannot be guaranteed in advance.`,
    parking: `The hotel has ${hotelKnowledge.parking.hotelSpaces} parking spaces and also works with nearby parking lots. A space will need to be confirmed based on availability when you arrive.`,
    breakfast: `Breakfast is served from ${hotelKnowledge.breakfast.hours}. If it is not included in your stay, you can add it for NT$150 per guest.`,
    confirm: summary => `If you’d like, I can organize ${summary} and send it through the “Message hotel staff” form below for the hotel team to confirm.`
  },
  ja: {
    booking: (dates, url) => `承知いたしました。${dates.checkInDate}チェックイン、${dates.checkOutDate}チェックアウトの最新の空室状況と料金は、下記の公式予約ページでご確認いただけます。\n${url}`,
    baby: name => `${name}のリクエストを承ります。前日までにお知らせください。数に限りがあり、当日の状況によってはご用意できない場合がございます。`,
    parking: `ホテル専用駐車場は${hotelKnowledge.parking.hotelSpaces}台分あり、提携駐車場もございます。ご利用可否は当日の状況によりホテルで確認いたします。`,
    breakfast: `朝食は${hotelKnowledge.breakfast.hours}にご利用いただけます。朝食なしのプランでも、1名様NT$150で追加できます。`,
    confirm: summary => `ご希望でしたら、${summary}をまとめて、下の「ホテルスタッフへのメッセージ」フォームからホテルスタッフへ確認を依頼できます。`
  },
  ko: {
    booking: (dates, url) => `물론입니다. ${dates.checkInDate} 체크인, ${dates.checkOutDate} 체크아웃 일정의 최신 객실과 요금은 아래 공식 예약 페이지에서 확인하실 수 있습니다.\n${url}`,
    baby: name => `${name}를 요청하실 수 있습니다. 체크인 하루 전까지 알려 주세요. 수량과 당일 상황에 따라 준비되므로 사전에 확정해 드리기는 어렵습니다.`,
    parking: `호텔 주차 공간은 ${hotelKnowledge.parking.hotelSpaces}대이며 제휴 주차장도 있습니다. 이용 가능 여부는 당일 상황에 따라 호텔에서 확인해 드립니다.`,
    breakfast: `조식은 ${hotelKnowledge.breakfast.hours}에 이용하실 수 있습니다. 조식이 포함되지 않은 경우 1인당 NT$150에 추가할 수 있습니다.`,
    confirm: summary => `원하시면 ${summary}을 정리해 아래 ‘호텔 직원에게 메시지 보내기’ 양식으로 호텔 직원에게 확인을 요청할 수 있습니다.`
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
    needs.push({ answer: copy.parking, confirmationNeeded: true, equipment });
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
  if (!/(有房|空房|房況|訂房|入住|住宿|(?:要|想|會)住|room|availab|book|check[ -]?in|stay|予約|空室|宿泊|\d+\s*泊|チェックイン|객실|예약|숙박|체크인)/iu.test(message)) return null;
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

export function informationalReply(message) {
  const language = detectGuestLanguage(message);
  const copy = REPLY_TEXT[language];
  const asksBreakfast = /早餐|餐點|素食|breakfast|vegetarian|朝食|조식/iu.test(message);
  const asksParking = /停車|車位|parking|駐車|주차/iu.test(message);
  if (asksBreakfast && !asksParking) return copy.breakfast;
  if (asksParking && !asksBreakfast) return copy.parking;
  if (asksBreakfast && asksParking) return `${copy.parking}\n\n${copy.breakfast}`;
  return null;
}

export function responsesPayload(message, history = []) {
  const conversation = normalizedHistory(history);
  const responseLanguage = detectGuestLanguage(message, conversation);
  const contextText = [...conversation.map(item => item.content), message].join("\n");
  const relevant = relevantKnowledge(contextText);
  return {
    model: OPENAI_MODEL,
    instructions: `你是希堤微旅專業、親切、自然的智慧櫃台人員。支援繁體中文（zh-TW）、English（en）、日本語（ja）、한국어（ko）。本次判定旅客主要語言為 ${responseLanguage}，必須使用該語言並全程以該語言簡潔回答；不要因下方飯店資料是繁體中文而改用中文，也不要夾雜其他語言。專有名詞、飯店名稱與網址可保留原文。若語言無法可靠判斷則使用繁體中文。
判斷時以旅客目前訊息為優先，並參考最近對話；回答原則上跟隨目前訊息的語言。
先自然回應旅客的需求，再提供必要資訊與下一步。只抽取與旅客這次實際詢問直接相關的知識，不要整段複述知識來源，也不要自行增加同類用品（例如只問嬰兒床時，不得順帶列出床圍、消毒鍋或澡盆）。一般回答控制在 2～4 個短段落，每段只聚焦一件事，避免重複同義提醒。使用親切、簡潔、有服務感但不過度客套的語氣；不要採用系統公告、FAQ、制式標題或機械式編號清單。不要以「AI 無法」、「系統無法」、「AI cannot」或其他負面能力聲明開頭，也不要在每段重複致謝或「很高興為您服務」等客套話。
只有旅客表達明確訂房或住宿意圖時，才在回答問題後自然提供一次官方訂房入口；單純詢問早餐、停車、交通或其他一般資訊時不得附上訂房連結，也不要重複貼連結或過度推銷。
遇到複合問題時，像真人櫃台一樣用連貫段落整合回答，逐項涵蓋需求，不要硬拆成分類標題。特殊用品、停車或其他須確認的需求，要先直接說明可如何協助及已知條件，再只說一次需要依數量或現場狀況確認。需要真人確認時，不要讓旅客感覺被轉走；自然邀請使用下方留言表單，並說明會將需求整理給飯店人員確認。
以下 JSON 是唯一正式飯店知識來源。回答希堤微旅的事實、設備、服務或政策時，只能使用其中明載的內容，不得套用一般飯店常識，也不得推測 null、missing 或未記載資料。
有明確答案就依資料自然回答並提供下一步；沒有答案或不確定時，請自然說明「這項資訊需要由櫃檯進一步確認」，並建議旅客於 07:00–22:00 直接洽詢櫃檯。不得對旅客提到「知識庫」、「資料庫」、「system prompt」或其他內部系統用語。
不得猜測即時房價、空房、優惠或當日狀況；只能引導至當日官網、訂房系統或櫃台確認，不得捏造數字。
旅客詢問指定入住日期的房況時，不得宣稱 AI 能確認即時房況；須以 identity.bookingUrl 為基底，動態附加 checkInDate（指定日期）與 checkOutDate（入住日加上旅客指定晚數；未指定晚數時為隔天），不得修改正式知識庫內的 bookingUrl。
同一句話若含訂房／入住日期及一項或多項其他飯店需求，必須辨識並逐項回答所有意圖，不得回答訂房連結後就停止。訂房無法即時確認仍提供官方訂房連結；其他需求若須確認，須明說可使用下方留言表單請飯店人員確認，且不得承諾一定能提供。
客訴、退款、訂單爭議、設備故障或特殊需求必須依 escalation 轉真人；不可聲稱已修改、取消、付款或退款。設備問題發生於 07:00–22:00 時優先請旅客聯絡櫃檯；於 22:00–翌日 07:00 時，須說明目前已非櫃檯服務時間，直接引導撥後勤客服 0927-708-908 洽陳先生。
若旅客想留言給飯店人員，請引導使用頁面下方「留言給飯店人員」表單。聊天本身不會寄出留言，不得僅憑對話聲稱「已將留言轉交飯店人員」；只有留言表單實際寄送成功後，頁面才會顯示該確認訊息。
旅客於 22:00–翌日 07:00 詢問當日夜間訂房入住時，須說明目前已非櫃檯服務時間，直接引導撥夜間訂房客服 0927-708-908 洽陳先生；一般未來日期訂房仍引導官方訂房系統，不可一律轉夜間電話。
包月、月租、一個月、30 天或公司長住問題不得推算價格或承諾折扣；依 extendedStay 分辨「沒有包月房價方案」與「有特約廠商優惠方案，詳情洽櫃檯」。休息、鐘點房或短時間休息須明確回答目前沒有提供，不可報價。床墊僅能回答五星級高級床墊；購買問題轉洽櫃檯，不得猜測品牌、型號、尺寸或售價。
餐廳具體店名屬變動資訊；若無法即時查證，先詢問餐飲偏好並說明須查詢最新營業資訊，不可編造店家。
請連貫理解下方對話脈絡。旅客使用「那」、「這個」、「兩個人呢」、「如果晚一點呢」等承接語時，應依最近對話判斷所指主題；計算仍只能使用正式知識庫已確認的數字。

正式知識庫（V${KNOWLEDGE_VERSION}）：
${knowledgeForPrompt()}${relevant ? `\n\n從正式知識庫擷取的本題相關欄位（內容完全相同，回答時優先核對）：\n${JSON.stringify(relevant, null, 2)}` : ""}`,
    input: [...conversation, { role: "user", content: message }]
  };
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

function sendError(res, status, error, diagnostic) {
  return res.status(status).json({ error, diagnostic });
}

function upstreamDiagnostic(response, body) {
  return {
    source: "openai",
    status: response.status,
    requestId: response.headers.get("x-request-id") || undefined,
    type: typeof body?.error?.type === "string" ? body.error.type : undefined,
    code: typeof body?.error?.code === "string" ? body.error.code : undefined
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Chat-Knowledge-Version", KNOWLEDGE_VERSION);
  res.setHeader("X-Chat-Commit", process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "local");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendError(res, 405, "Method not allowed", { source: "chat", code: "method_not_allowed" });
  }

  const message = req.body?.message;
  if (typeof message !== "string" || !message.trim()) {
    return sendError(res, 400, "請輸入問題", { source: "chat", code: "invalid_message" });
  }

  const trimmedMessage = message.trim();
  const directAnswer = availabilityReply(trimmedMessage) || specialRequestReply(trimmedMessage) || informationalReply(trimmedMessage);
  if (directAnswer) {
    return res.status(200).json({
      answer: directAnswer,
      diagnostic: {
        knowledgeVersion: KNOWLEDGE_VERSION,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "local"
      }
    });
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.error("[api/chat] OPENAI_API_KEY is not configured");
    return sendError(res, 500, "AI 服務尚未設定", { source: "chat", code: "missing_api_key" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let upstream;

  try {
    upstream = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(responsesPayload(message.trim().slice(0, MAX_MESSAGE_LENGTH), req.body?.history)),
      signal: controller.signal
    });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    console.error("[api/chat] OpenAI request failed", { timedOut, name: error?.name });
    return sendError(
      res,
      timedOut ? 504 : 502,
      timedOut ? "OpenAI 請求逾時" : "無法連線至 OpenAI",
      { source: "openai", code: timedOut ? "timeout" : "connection_failed" }
    );
  } finally {
    clearTimeout(timeout);
  }

  // Reaching here proves fetch completed an outgoing request and received an HTTP
  // response. Record that fact before attempting to parse its body.
  const requestId = upstream.headers.get("x-request-id") || undefined;
  console.info("[api/chat] OpenAI responded", { status: upstream.status, requestId });

  let rawBody;
  try {
    rawBody = await upstream.text();
  } catch {
    return sendError(res, 502, "無法讀取 OpenAI 回應", {
      source: "openai",
      status: upstream.status,
      requestId,
      code: "response_read_failed"
    });
  }
  let body;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return sendError(res, 502, "OpenAI 回應格式無法解析", {
      source: "openai",
      status: upstream.status,
      requestId,
      code: "invalid_json"
    });
  }

  if (!upstream.ok) {
    const diagnostic = upstreamDiagnostic(upstream, body);
    console.error("[api/chat] OpenAI HTTP error", diagnostic);
    return sendError(res, upstream.status, "OpenAI API 請求失敗", diagnostic);
  }

  const answer = responseText(body);
  if (!answer) {
    return sendError(res, 502, "OpenAI 未回傳文字答案", {
      source: "openai",
      status: upstream.status,
      requestId,
      code: "empty_response"
    });
  }

  return res.status(200).json({
    answer,
    diagnostic: {
      knowledgeVersion: KNOWLEDGE_VERSION,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "local"
    }
  });
}
