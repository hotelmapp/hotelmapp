const HANDLER_VERSION = "2026-08-12.2";
const OPENAI_URL = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 25_000;
const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";

export const config = { maxDuration: 30 };

export function extractResponseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  return (Array.isArray(data?.output) ? data.output : [])
    .filter(item => item?.type === "message")
    .flatMap(item => (Array.isArray(item.content) ? item.content : []))
    .map(part => {
      if (typeof part === "string") return part;
      if (part?.type === "output_text" && typeof part.text === "string") return part.text;
      // Keep compatibility with message-style content returned by gateways or a
      // future Responses API content shape without accepting arbitrary metadata.
      if (part?.type === "text" && typeof part.text === "string") return part.text;
      if (part?.type === "text" && typeof part.text?.value === "string") return part.text.value;
      return "";
    })
    .map(text => text.trim())
    .filter(Boolean)
    .join("\n");
}

function diagnostic(event, details = {}) {
  console.info("[api/chat]", { event, handlerVersion: HANDLER_VERSION, ...details });
}

function safeResponseShape(data) {
  return {
    responseStatus: typeof data?.status === "string" ? data.status : undefined,
    outputTypes: Array.isArray(data?.output)
      ? data.output.map(item => typeof item?.type === "string" ? item.type : "unknown")
      : [],
    incompleteReason: typeof data?.incomplete_details?.reason === "string"
      ? data.incomplete_details.reason
      : undefined
  };
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
  res.setHeader("X-Chat-Key-Configured", apiKey ? "true" : "false");
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

    diagnostic("calling_openai", { id, model: OPENAI_MODEL, url: OPENAI_URL });
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
          model: OPENAI_MODEL,
          instructions:
            "你是希堤微旅的 AI 智慧櫃台。請使用繁體中文，親切、簡潔地回答旅客問題。如果涉及訂房修改、退款、付款、設備故障或需要查詢飯店內部即時資料，請提醒旅客聯絡真人櫃台協助。若沒有飯店提供的確切資訊，不要臆測，請明確說明並建議聯絡真人櫃台。",
          input: message.trim()
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const openAIRequestId = response.headers.get("x-request-id") || undefined;
    res.setHeader("X-Chat-Upstream-Status", String(response.status));
    diagnostic("openai_response", {
      id,
      status: response.status,
      ok: response.ok,
      openAIRequestId
    });
    const rawBody = await response.text();
    let data;

    try {
      data = rawBody ? JSON.parse(rawBody) : {};
    } catch (error) {
      diagnostic("openai_json_parse_failed", {
        id,
        status: response.status,
        contentType: response.headers.get("content-type"),
        bodyBytes: Buffer.byteLength(rawBody),
        error: error.message
      });
      return res.status(502).json({ error: "OpenAI 回應格式無法解析" });
    }

    if (!response.ok) {
      const upstreamMessage = data?.error?.message;
      diagnostic("openai_error", {
        id,
        status: response.status,
        openAIRequestId,
        errorType: typeof data?.error?.type === "string" ? data.error.type : undefined,
        errorCode: typeof data?.error?.code === "string" ? data.error.code : undefined,
        error: typeof upstreamMessage === "string" ? upstreamMessage : "Unknown OpenAI error"
      });
      return res.status(502).json({
        error: typeof upstreamMessage === "string" ? `OpenAI API 錯誤：${upstreamMessage}` : "OpenAI API 發生錯誤"
      });
    }

    const answer = extractResponseText(data);
    diagnostic("text_parsed", {
      id,
      openAIRequestId,
      hasText: Boolean(answer),
      ...safeResponseShape(data)
    });

    if (!answer) {
      return res.status(502).json({ error: "OpenAI 未回傳有效內容" });
    }

    return res.status(200).json({ answer });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    diagnostic("caught_error", { id, errorName: error?.name, error: message });
    const clientMessage = error?.name === "AbortError"
      ? "OpenAI 回應逾時，請稍後再試"
      : "系統暫時發生錯誤";
    return res.status(error?.name === "AbortError" ? 504 : 500).json({ error: clientMessage });
  }
}
