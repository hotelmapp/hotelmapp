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
    booking: (dates, url) => `1. 訂房／查房：AI 無法確認即時房況。請至官方訂房系統查詢 ${dates.checkInDate} 入住、${dates.checkOutDate} 退房的房價與空房：\n${url}`,
    babyLabel: "嬰幼兒用品", baby: hotelKnowledge.extraBed.babyEquipment,
    confirm: "如需確認上述需求，請使用頁面下方「留言給飯店人員」表單；飯店將依數量與現場狀況確認，AI 不會自行承諾一定能提供。"
  },
  en: {
    booking: (dates, url) => `1. Booking / availability: AI cannot confirm live availability. Please check rates and rooms for check-in ${dates.checkInDate} and check-out ${dates.checkOutDate} in the official booking system:\n${url}`,
    babyLabel: "Baby equipment", baby: "A baby crib, bed rail, sterilizer, or baby bath may be available. Please notify the hotel one day before arrival; availability depends on quantity and on-site conditions and cannot be guaranteed.",
    confirm: "To confirm these requests, please use the “Message hotel staff” form below. The hotel must confirm based on quantity and on-site conditions; AI cannot promise that an item will be provided."
  },
  ja: {
    booking: (dates, url) => `1. 予約／空室確認：AIではリアルタイムの空室状況を確認できません。公式予約システムでチェックイン ${dates.checkInDate}、チェックアウト ${dates.checkOutDate} の料金と空室をご確認ください：\n${url}`,
    babyLabel: "ベビー用品", baby: "ベビーベッド、ベッドガード、消毒器、ベビーバスはご用意できる場合があります。前日までにホテルへお知らせください。数量と当日の状況によるため、確約はできません。",
    confirm: "ご希望の確認には、下の「ホテルスタッフへのメッセージ」フォームをご利用ください。数量と当日の状況をホテルが確認する必要があり、AIがお約束することはできません。"
  },
  ko: {
    booking: (dates, url) => `1. 예약 / 객실 확인: AI는 실시간 객실 상황을 확인할 수 없습니다. 공식 예약 시스템에서 체크인 ${dates.checkInDate}, 체크아웃 ${dates.checkOutDate}의 요금과 객실을 확인해 주세요:\n${url}`,
    babyLabel: "유아용품", baby: "아기 침대, 침대 가드, 소독기, 아기 욕조는 제공 가능할 수 있습니다. 체크인 하루 전 호텔에 알려 주세요. 수량과 현장 상황에 따라 확인이 필요하며 보장할 수 없습니다.",
    confirm: "요청 확인이 필요하면 아래의 ‘호텔 직원에게 메시지 보내기’ 양식을 이용해 주세요. 호텔이 수량과 현장 상황을 확인해야 하며, AI는 제공을 보장하지 않습니다."
  }
});

function additionalHotelNeeds(message, language = "zh-TW") {
  const needs = [];
  const add = (pattern, label, answer) => {
    if (pattern.test(message)) needs.push({ label, answer });
  };

  const copy = REPLY_TEXT[language];
  add(/嬰兒床|床圍|消毒鍋|澡盆|baby\s*(?:crib|cot)|crib|cot|ベビーベッド|ベビー用品|아기\s*침대|유아용품/iu, copy.babyLabel, copy.baby);
  add(/停車|車位/u, "停車需求", `飯店有 ${hotelKnowledge.parking.hotelSpaces} 個車位，也有配合停車場；車位與現場安排仍請飯店人員確認。`);
  add(/早餐|餐點|素食/u, "早餐需求", `早餐資訊：${hotelKnowledge.breakfast.hours}，${hotelKnowledge.breakfast.addOn}${/素食/u.test(message) ? ` ${hotelKnowledge.breakfast.vegetarian}` : ""}`);
  add(/牙刷|備品|盥洗|毛巾|浴巾|拖鞋/u, "備品需求", hotelKnowledge.amenities.toiletries);
  add(/電視|Netflix|YouTube/u, "電視設備", hotelKnowledge.amenities.tv);
  add(/洗衣|烘衣/u, "洗衣設備", hotelKnowledge.amenities.laundry);
  add(/充電器|轉接頭|雨傘/u, "借用物品", hotelKnowledge.amenities.loans);
  add(/提早入住/u, "提早入住", hotelKnowledge.stay.earlyCheckIn);
  add(/延後退房/u, "延後退房", hotelKnowledge.stay.lateCheckOut);
  add(/加床/u, "加床需求", `${hotelKnowledge.extraBed.price}；是否可加床仍須依房型與現場狀況確認。`);

  if (/(設備故障|壞掉|無法使用|沒反應|特殊需求|過敏|無障礙|慶生)/u.test(message)) {
    needs.push({ label: "其他需求", answer: "這項需求需要由飯店人員依現場狀況進一步確認，無法預先保證。" });
  }
  return needs;
}

export function availabilityReply(message, now = new Date()) {
  if (!/(有房|空房|房況|訂房|入住|住宿|room|availab|book|check[ -]?in|stay|予約|空室|宿泊|チェックイン|객실|예약|숙박|체크인)/iu.test(message)) return null;
  const dates = bookingDates(message, now);
  if (!dates) return null;
  const language = detectGuestLanguage(message);
  const copy = REPLY_TEXT[language];
  const booking = copy.booking(dates, datedBookingUrl(dates));
  const needs = additionalHotelNeeds(message, language);
  if (!needs.length) return booking.replace(/^1\. /u, "");

  const answers = needs.map((need, index) => `${index + 2}. ${need.label}：${need.answer}`);
  return [booking, ...answers, copy.confirm].join("\n\n");
}

export function responsesPayload(message, history = []) {
  const conversation = normalizedHistory(history);
  const responseLanguage = detectGuestLanguage(message, conversation);
  const contextText = [...conversation.map(item => item.content), message].join("\n");
  const relevant = relevantKnowledge(contextText);
  return {
    model: OPENAI_MODEL,
    instructions: `你是希堤微旅的 AI 智慧櫃台。支援繁體中文（zh-TW）、English（en）、日本語（ja）、한국어（ko）。本次判定旅客主要語言為 ${responseLanguage}，必須使用該語言簡潔回答；不要因下方飯店資料是繁體中文而改用中文。專有名詞、飯店名稱與網址可保留原文。若語言無法可靠判斷則使用繁體中文。
判斷時以旅客目前訊息為優先，並參考最近對話；回答原則上跟隨目前訊息的語言。
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

  const directAvailabilityAnswer = availabilityReply(message.trim());
  if (directAvailabilityAnswer) {
    return res.status(200).json({
      answer: directAvailabilityAnswer,
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
