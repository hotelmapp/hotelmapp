import { spokenText, VOICE_OPTIONS } from "../voice-assistant.js";

const SPEECH_URL = "https://api.openai.com/v1/audio/speech";
const MAX_SPEECH_LENGTH = 1800;

export const config = { maxDuration: 30 };

export function speechPayload(text, voice, language) {
  return {
    model: process.env.OPENAI_TTS_MODEL?.trim() || "gpt-4o-mini-tts",
    voice,
    input: spokenText(text, language).slice(0, MAX_SPEECH_LENGTH),
    response_format: "mp3",
    instructions: `Speak in ${language}, like a warm, young, professional female hotel receptionist. Use natural conversational pacing, short phrases, gentle pauses, and a Taiwanese style for zh-TW. Avoid announcer, IVR, navigation, advertising, or overly cute delivery.`
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { text, language = "zh-TW" } = req.body || {};
  const voice = VOICE_OPTIONS.some(item => item.id === req.body?.voice) ? req.body.voice : VOICE_OPTIONS[0].id;
  if (typeof text !== "string" || !spokenText(text, language)) return res.status(400).json({ error: "No speakable text" });
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return res.status(503).json({ error: "Voice service is not configured" });

  try {
    const upstream = await fetch(SPEECH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(speechPayload(text, voice, language)),
      signal: AbortSignal.timeout(25_000)
    });
    if (!upstream.ok) return res.status(502).json({ error: "Voice provider failed" });
    const audio = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", String(audio.length));
    return res.status(200).send(audio);
  } catch (error) {
    return res.status(error?.name === "TimeoutError" ? 504 : 502).json({ error: "Voice provider unavailable" });
  }
}
