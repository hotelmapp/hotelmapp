import { hotelKnowledge, knowledgeForPrompt } from "../data/hotel-info.js";

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

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

export function bookingDates(message, now = new Date()) {
  if (typeof message !== "string") return null;

  const match = message.match(/(?:(\d{4})\s*[年\/-]\s*)?(\d{1,2})\s*(?:月|[\/-])\s*(\d{1,2})\s*日?/u);
  if (!match) return null;

  const month = Number(match[2]);
  const day = Number(match[3]);
  let year = match[1] ? Number(match[1]) : now.getUTCFullYear();
  let checkInDate = isoDate(year, month, day);
  if (!checkInDate) return null;

  const today = now.toISOString().slice(0, 10);
  if (!match[1] && checkInDate < today) {
    year += 1;
    checkInDate = isoDate(year, month, day);
    if (!checkInDate) return null;
  }

  const departure = new Date(`${checkInDate}T00:00:00Z`);
  departure.setUTCDate(departure.getUTCDate() + 1);
  return { checkInDate, checkOutDate: departure.toISOString().slice(0, 10) };
}

export function datedBookingUrl(dates) {
  const url = new URL(hotelKnowledge.identity.bookingUrl);
  url.searchParams.set("checkInDate", dates.checkInDate);
  url.searchParams.set("checkOutDate", dates.checkOutDate);
  return url.toString();
}

export function availabilityReply(message, now = new Date()) {
  if (!/(有房|空房|房況|訂房|入住|住宿)/u.test(message)) return null;
  const dates = bookingDates(message, now);
  if (!dates) return null;

  return `AI 無法確認即時房況。請至官方訂房系統查詢 ${dates.checkInDate} 入住、${dates.checkOutDate} 退房的房價與空房：\n${datedBookingUrl(dates)}`;
}

export function responsesPayload(message, history = []) {
  const conversation = normalizedHistory(history);
  const contextText = [...conversation.map(item => item.content), message].join("\n");
  const relevant = relevantKnowledge(contextText);
  return {
    model: OPENAI_MODEL,
    instructions: `你是希堤微旅的 AI 智慧櫃台。請以繁體中文簡潔回答。
以下 JSON 是唯一正式飯店知識來源。回答希堤微旅的事實、設備、服務或政策時，只能使用其中明載的內容，不得套用一般飯店常識，也不得推測 null、missing 或未記載資料。
有明確答案就依資料自然回答並提供下一步；沒有答案或不確定時，請自然說明「這項資訊需要由櫃檯進一步確認」，並建議旅客於 07:00–22:00 直接洽詢櫃檯。不得對旅客提到「知識庫」、「資料庫」、「system prompt」或其他內部系統用語。
不得猜測即時房價、空房、優惠或當日狀況；只能引導至當日官網、訂房系統或櫃台確認，不得捏造數字。
旅客詢問指定入住日期的房況時，不得宣稱 AI 能確認即時房況；須以 identity.bookingUrl 為基底，動態附加 checkInDate（指定日期）與 checkOutDate（隔天），不得修改正式知識庫內的 bookingUrl。
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
