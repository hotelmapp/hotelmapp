import { VOICE_OPTIONS } from "../voice-assistant.js";
import { knowledgeForPrompt } from "../data/hotel-info.js";

const CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";
export const config = { maxDuration: 15 };

export function voiceInstructions() {
  return `你是希堤微旅親切、自然、簡潔的女性櫃檯人員，正在與客人面對面交談。依客人目前使用的語言，自然使用繁體中文、English、日本語或한국어，並能隨客人切換語言。
像真人說話，不像客服稿：一次通常只回答一到三個自然短句，必要時問一個簡短問題。不要使用條列、Markdown、標題，不要重複客人的問題，不要朗讀網址、URL、符號或技術文字。訂房時只說「可以點畫面上的官方訂房連結」，完整日期、價格與網址會另外顯示在畫面。
務必連貫理解整個 session 的對話歷史；「那小朋友呢」等承接問題須延續上一個主題。若客人插話，立刻停下並聽完新問題。
不得猜測房價、空房或未記載資訊。需要真人處理的特殊需求、訂單、退款、設備問題，親切引導客人使用畫面下方留言表單或洽櫃檯，不可聲稱已經送出。保留嬰兒床等需求的現場確認限制。
以下是唯一飯店事實來源，只自然說出本題需要的資訊：
${knowledgeForPrompt()}`;
}

export function realtimeSession(voice) {
  const selected = VOICE_OPTIONS.some(item => item.id === voice) ? voice : VOICE_OPTIONS[0].id;
  return {
    session: {
      type: "realtime",
      model: process.env.OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime",
      instructions: voiceInstructions(),
      audio: {
        input: { transcription: { model: "gpt-4o-mini-transcribe" }, turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 450, create_response: true, interrupt_response: true } },
        output: { voice: selected }
      }
    }
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return res.status(503).json({ error: "Voice service is not configured" });
  try {
    const upstream = await fetch(CLIENT_SECRETS_URL, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(realtimeSession(req.body?.voice)), signal: AbortSignal.timeout(12_000)
    });
    const body = await upstream.json().catch(() => ({}));
    if (!upstream.ok || !body.value) return res.status(502).json({ error: "Voice provider failed" });
    // Return only the short-lived client secret, never the server API key or session instructions.
    return res.status(200).json({ value: body.value, expires_at: body.expires_at });
  } catch { return res.status(502).json({ error: "Voice provider unavailable" }); }
}
