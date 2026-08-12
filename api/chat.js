const HANDLER_VERSION = "2026-08-12.1";
const OPENAI_URL = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 25_000;

export const config = { maxDuration: 30 };

export function extractResponseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  return (Array.isArray(data?.output) ? data.output : [])
    .filter(item => item?.type === "message")
    .flatMap(item => (Array.isArray(item.content) ? item.content : []))
    .filter(part => part?.type === "output_text" && typeof part.text === "string")
    .map(part => part.text.trim())
    .filter(Boolean)
    .join("\n");
}

function diagnostic(event, details = {}) {
  console.info("[api/chat]", { event, handlerVersion: HANDLER_VERSION, ...details });
}

function requestId(req) {
  const supplied = req.headers?.["x-vercel-id"];
  return typeof supplied === "string" ? supplied : `local-${Date.now()}`;
}

export default async function handler(req, res) {
  const id = requestId(req);
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  // This fingerprint makes it possible to distinguish this function from a stale
  // deployment without exposing the commit SHA or any secret.
  res.setHeader("X-Chat-Handler-Version", HANDLER_VERSION);
  res.setHeader("Cache-Control", "no-store");
  diagnostic("entered", { id, method: req.method, hasApiKey: Boolean(apiKey) });

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body || {};

    if (typeof message !== "string" || !message.trim()) {
      diagnostic("invalid_request", { id });
      return res.status(400).json({ error: "請輸入問題" });
    }

    if (!apiKey) {
      diagnostic("missing_api_key", { id });
      return res.status(500).json({ error: "伺服器尚未設定 OpenAI API Key" });
    }

    diagnostic("calling_openai", { id, model: "gpt-5-mini" });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
    let response;

    try {
      response = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-5-mini",
          instructions:
            "你是希堤微旅的 AI 智慧櫃台。請使用繁體中文，親切、簡潔地回答旅客問題。如果涉及訂房修改、退款、付款、設備故障或需要查詢飯店內部即時資料，請提醒旅客聯絡真人櫃台協助。若沒有飯店提供的確切資訊，不要臆測，請明確說明並建議聯絡真人櫃台。",
          input: message.trim()
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    diagnostic("openai_response", { id, status: response.status, ok: response.ok });
    const rawBody = await response.text();
    let data;

    try {
      data = rawBody ? JSON.parse(rawBody) : {};
    } catch (error) {
      diagnostic("openai_json_parse_failed", { id, error: error.message });
      return res.status(502).json({ error: "OpenAI 回應格式無法解析" });
    }

    if (!response.ok) {
      const upstreamMessage = data?.error?.message;
      diagnostic("openai_error", {
        id,
        status: response.status,
        error: typeof upstreamMessage === "string" ? upstreamMessage : "Unknown OpenAI error"
      });
      return res.status(502).json({
        error: typeof upstreamMessage === "string" ? `OpenAI API 錯誤：${upstreamMessage}` : "OpenAI API 發生錯誤"
      });
    }

    const answer = extractResponseText(data);
    diagnostic("text_parsed", { id, hasText: Boolean(answer) });

    if (!answer) {
      return res.status(502).json({ error: "OpenAI 未回傳有效內容" });
    }

    return res.status(200).json({ answer });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    diagnostic("caught_error", { id, error: message });
    const clientMessage = error?.name === "AbortError"
      ? "OpenAI 回應逾時，請稍後再試"
      : "系統暫時發生錯誤";
    return res.status(500).json({ error: clientMessage });
  }
}
