import { VOICE_OPTIONS } from "../voice-assistant.js";
import { groundedKnowledgePrompt } from "../ai-core/knowledge.js";
import { styledInstructions } from "../ai-core/hospitality-personality.js";
import { decideHandoff } from "../ai-core/handoff.js";

export { decideHandoff };

const CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";
export const config = { maxDuration: 15 };

function sendError(res, status, code, message, diagnostic = {}) {
  return res.status(status).json({ error: message, diagnostic: { source: "realtime", code, ...diagnostic } });
}

// `/v1/realtime/client_secrets` currently returns `value` at the top level.
// Accept the earlier session response shape too, so a staged API rollout cannot
// leave Preview completely unable to start voice sessions.
export function ephemeralCredential(body) {
  return typeof body?.value === "string" ? body.value
    : typeof body?.client_secret?.value === "string" ? body.client_secret.value
      : "";
}

export function voiceInstructions() {
  return `${styledInstructions("voice")}

你正在與客人面對面交談。依客人目前使用的語言，自然使用繁體中文、English、日本語或한국어，客人在同一段對話換語言時也自然跟著切換。
像真人聊天，不像客服 IVR、主播、朗讀機或 TTS。先直接回答客人的重點，再視需要補充；一次通常只回答一到三個口語短句，必要時只追問一個簡短問題。可以偶爾自然使用「好的」、「可以」、「沒問題」、「嗯，我幫您確認一下」這類短銜接，但不要每次都使用，也不要形成固定開場。語速自然，句子之間允許短暫停頓，不要刻意拖長、過度甜膩或使用誇張情緒。
不要重述客人的問題，不要使用條列、Markdown、標題，不要朗讀網址、URL、畫面文字、符號、欄位名稱、系統資訊或完整文章。訂房時只自然說「可以點畫面上的官方訂房連結」，完整日期、價格與網址會另外顯示在畫面。
務必連貫理解整個 session 的對話歷史；「那小朋友呢」等承接問題須延續上一個主題。若客人插話，立刻停下並聽完新問題。
不得猜測房價、空房或未記載資訊。需要真人處理的特殊需求、訂單、退款、設備問題，必須依 shared handoff decision 判定並交由 shared handoff service 寄信；只有收到寄送成功結果才可說已留言，失敗時提供櫃檯聯絡方式。不得聲稱已保留車位、修改訂房、付款或退款。保留嬰兒床等需求的現場確認限制。
${groundedKnowledgePrompt()}`;
}

export function realtimeSession(voice) {
  const selected = VOICE_OPTIONS.some(item => item.id === voice) ? voice : VOICE_OPTIONS[0].id;
  return {
    session: {
      type: "realtime",
      model: process.env.OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime",
      instructions: voiceInstructions(),
      tools: [{
        type: "function", name: "handoff_to_front_desk",
        description: "For a request requiring human action, send the guest request to the shared front-desk handoff service. Always speak exactly from the returned delivery result.",
        parameters: { type: "object", properties: { message: { type: "string", description: "A concise summary of the guest request and necessary recent context" } }, required: ["message"], additionalProperties: false }
      }],
      tool_choice: "auto",
      audio: {
        input: { transcription: { model: "gpt-4o-mini-transcribe" }, turn_detection: { type: "semantic_vad", eagerness: "high", create_response: true, interrupt_response: true } },
        output: { voice: selected }
      }
    }
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return sendError(res, 405, "method_not_allowed", "Method not allowed");
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.error("[api/realtime] OPENAI_API_KEY is missing in this deployment");
    return sendError(res, 503, "credential_failed", "Vercel Preview 無法建立即時語音憑證；請確認 OPENAI_API_KEY 與 Realtime API 權限。", { reason: "missing_api_key" });
  }
  try {
    const upstream = await fetch(CLIENT_SECRETS_URL, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(realtimeSession(req.body?.voice)), signal: AbortSignal.timeout(12_000)
    });
    const body = await upstream.json().catch(() => ({}));
    const requestId = upstream.headers?.get?.("x-request-id") || undefined;
    if (!upstream.ok) {
      console.error("[api/realtime] credential request rejected", { status: upstream.status, requestId, code: body?.error?.code });
      return sendError(res, 502, "realtime_api_rejected", "OpenAI 拒絕建立即時語音憑證。", {
        upstreamStatus: upstream.status, requestId, upstreamCode: body?.error?.code
      });
    }
    const value = ephemeralCredential(body);
    if (!value) {
      console.error("[api/realtime] credential response schema mismatch", { requestId, keys: Object.keys(body || {}) });
      return sendError(res, 502, "credential_failed", "OpenAI 即時語音憑證格式不正確。", { requestId, reason: "schema_invalid" });
    }
    // Return only the short-lived client secret, never the server API key or session instructions.
    return res.status(200).json({ value, expires_at: body.expires_at || body.client_secret?.expires_at });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError";
    console.error("[api/realtime] credential request failed", { timedOut, name: error?.name });
    return sendError(res, timedOut ? 504 : 502, "credential_failed",
      timedOut ? "建立即時語音憑證逾時。" : "目前無法連線至 OpenAI 即時語音服務。");
  }
}
