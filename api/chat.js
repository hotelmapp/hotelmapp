const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
const REQUEST_TIMEOUT_MS = 25_000;

export const config = { maxDuration: 30 };

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

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendError(res, 405, "Method not allowed", { source: "chat", code: "method_not_allowed" });
  }

  const message = req.body?.message;
  if (typeof message !== "string" || !message.trim()) {
    return sendError(res, 400, "請輸入問題", { source: "chat", code: "invalid_message" });
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
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: "你是希堤微旅的 AI 智慧櫃台。請以繁體中文簡潔回答；不確定的飯店資訊不要猜測，請建議旅客聯絡真人櫃台。",
        input: message.trim()
      }),
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

  return res.status(200).json({ answer });
}
