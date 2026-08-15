const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const REQUEST_TIMEOUT_MS = 25_000;

export class OpenAIResponseError extends Error {
  constructor(code, { status = code === "missing_api_key" ? 500 : code === "timeout" ? 504 : 502, requestId, type, upstreamCode } = {}) {
    super(code);
    this.name = "OpenAIResponseError";
    this.code = code;
    this.status = status;
    this.diagnostic = { source: "openai", ...(status ? { status } : {}), ...(requestId ? { requestId } : {}), ...(type ? { type } : {}), ...(upstreamCode ? { code: upstreamCode } : { code }) };
  }
}

function extractResponseText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  return (Array.isArray(response?.output) ? response.output : [])
    .filter(item => item?.type === "message")
    .flatMap(item => Array.isArray(item.content) ? item.content : [])
    .filter(item => item?.type === "output_text" && typeof item.text === "string")
    .map(item => item.text.trim()).filter(Boolean).join("\n");
}

// Channel-independent OpenAI transport. Adapters provide an already-grounded
// payload, so web chat and messaging channels cannot drift into separate calls.
export async function requestGroundedResponse({ payload, apiKey = process.env.OPENAI_API_KEY?.trim(), fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS }) {
  if (!apiKey) throw new OpenAIResponseError("missing_api_key");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: controller.signal
    });
  } catch (error) {
    throw new OpenAIResponseError(error?.name === "AbortError" ? "timeout" : "connection_failed");
  } finally {
    clearTimeout(timeout);
  }
  const requestId = response.headers.get("x-request-id") || undefined;
  let rawBody;
  try { rawBody = await response.text(); } catch { throw new OpenAIResponseError("response_read_failed", { requestId }); }
  let body;
  try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { throw new OpenAIResponseError("invalid_json", { requestId }); }
  if (!response.ok) {
    throw new OpenAIResponseError("http_error", {
      status: response.status, requestId,
      type: typeof body?.error?.type === "string" ? body.error.type : undefined,
      upstreamCode: typeof body?.error?.code === "string" ? body.error.code : undefined
    });
  }
  const answer = extractResponseText(body);
  if (!answer) throw new OpenAIResponseError("empty_response", { status: 502, requestId });
  return { answer, status: response.status, requestId };
}
