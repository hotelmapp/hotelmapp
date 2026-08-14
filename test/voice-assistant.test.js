import test from "node:test";
import assert from "node:assert/strict";
import { languageFromText, loadSelectedVoice, saveSelectedVoice, spokenText, RealtimeVoiceSession, VOICE_STORAGE_KEY } from "../voice-assistant.js";
import realtimeHandler, { ephemeralCredential, realtimeSession, voiceInstructions } from "../api/realtime.js";

test("supports the four guest languages", () => {
  assert.equal(languageFromText("早餐幾點？"), "zh-TW");
  assert.equal(languageFromText("What time is breakfast?"), "en");
  assert.equal(languageFromText("朝食は何時ですか？"), "ja");
  assert.equal(languageFromText("조식은 몇 시예요?"), "ko");
  assert.match(voiceInstructions(), /繁體中文、English、日本語或한국어/);
});

test("selected voice controls the server-side realtime neural voice", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(loadSelectedVoice(storage), "coral");
  assert.equal(saveSelectedVoice(storage, "marin"), true);
  assert.equal(values.get(VOICE_STORAGE_KEY), "marin");
  assert.equal(realtimeSession("marin").session.audio.output.voice, "marin");
  assert.equal(realtimeSession("invalid").session.audio.output.voice, "coral");
});

test("voice and rich screen text are separated and URLs are never spoken", () => {
  const screen = "早餐 08:00–10:00，訂房：https://example.com/book?date=2026-08-20";
  const voice = spokenText(screen, "zh-TW");
  assert.match(screen, /https:\/\//);
  assert.doesNotMatch(voice, /https?:|example\.com|2026-08-20/);
  assert.match(voice, /點畫面上的官方訂房連結/);
  assert.match(voiceInstructions(), /不要朗讀網址、URL/);
});

test("realtime session keeps context and uses fast server VAD interruption", () => {
  const session = realtimeSession("coral").session;
  assert.match(session.instructions, /整個 session 的對話歷史/);
  assert.match(session.instructions, /那小朋友呢/);
  assert.equal(session.audio.input.turn_detection.type, "server_vad");
  assert.equal(session.audio.input.turn_detection.silence_duration_ms, 450);
  assert.equal(session.audio.input.turn_detection.create_response, true);
  assert.equal(session.audio.input.turn_detection.interrupt_response, true);
});

test("speech-start immediately cancels response and clears buffered audio", () => {
  const sent = [];
  const states = [];
  const session = new RealtimeVoiceSession({ onState: state => states.push(state) });
  session.channel = { readyState: "open", send: value => sent.push(JSON.parse(value)) };
  session.handleEvent({ type: "input_audio_buffer.speech_started" });
  assert.deepEqual(sent.map(item => item.type), ["response.cancel", "output_audio_buffer.clear"]);
  assert.equal(states.at(-1), "listening");
});

test("transcripts preserve user turns while provider errors fall back to text", () => {
  const turns = [];
  const errors = [];
  const session = new RealtimeVoiceSession({ onTranscript: turn => turns.push(turn), onError: error => errors.push(error) });
  session.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "早餐幾點？" });
  session.handleEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "那小朋友呢？" });
  session.handleEvent({ type: "error", error: { message: "down" } });
  assert.deepEqual(turns.map(turn => turn.text), ["早餐幾點？", "那小朋友呢？"]);
  assert.match(errors[0], /文字聊天/);
});

test("ephemeral credential endpoint keeps the server API key out of its response", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  process.env.OPENAI_API_KEY = "server-secret";
  let authorization;
  global.fetch = async (_url, options) => {
    authorization = options.headers.Authorization;
    return { ok: true, json: async () => ({ value: "ephemeral-secret", expires_at: 123 }) };
  };
  const result = {};
  const res = { setHeader() {}, status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
  try { await realtimeHandler({ method: "POST", body: { voice: "coral" } }, res); }
  finally { global.fetch = originalFetch; process.env.OPENAI_API_KEY = originalKey; }
  assert.equal(authorization, "Bearer server-secret");
  assert.deepEqual(result, { status: 200, body: { value: "ephemeral-secret", expires_at: 123 } });
  assert.doesNotMatch(JSON.stringify(result), /server-secret/);
});

test("accepts current and staged ephemeral credential response schemas", () => {
  assert.equal(ephemeralCredential({ value: "current-secret" }), "current-secret");
  assert.equal(ephemeralCredential({ client_secret: { value: "compatible-secret" } }), "compatible-secret");
  assert.equal(ephemeralCredential({ client_secret: {} }), "");
});

test("missing Preview API key returns an explicit safe diagnostic", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const result = {};
  const res = { setHeader() {}, status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
  try { await realtimeHandler({ method: "POST", body: {} }, res); }
  finally { process.env.OPENAI_API_KEY = originalKey; }
  assert.equal(result.status, 503);
  assert.equal(result.body.diagnostic.code, "missing_api_key");
  assert.match(result.body.error, /Vercel Preview.*OPENAI_API_KEY/);
});

test("credential fetch failures expose their stage and server reason", async () => {
  const errors = [];
  const warnings = [];
  const oldWarn = console.warn;
  console.warn = (_label, detail) => warnings.push(detail);
  const session = new RealtimeVoiceSession({
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ error: "Preview 尚未設定 OPENAI_API_KEY", diagnostic: { code: "missing_api_key" } }) }),
    mediaDevices: { getUserMedia() {} }, RTCPeerConnectionImpl: function () {}, onError: error => errors.push(error)
  });
  try { assert.equal(await session.start(), false); } finally { console.warn = oldWarn; }
  assert.equal(warnings[0].stage, "credential");
  assert.equal(warnings[0].code, "missing_api_key");
  assert.match(errors[0], /無法取得即時語音憑證.*OPENAI_API_KEY/);
  assert.match(errors[0], /文字聊天仍可繼續使用/);
});

test("microphone permission and data channel failures remain distinguishable", async () => {
  const microphoneErrors = [];
  const oldWarn = console.warn;
  console.warn = () => {};
  const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
  const microphoneSession = new RealtimeVoiceSession({
    fetchImpl: async () => ({ ok: true, json: async () => ({ value: "ephemeral" }) }),
    mediaDevices: { getUserMedia: async () => { throw denied; } },
    RTCPeerConnectionImpl: function () {}, audioFactory: () => ({}), onError: error => microphoneErrors.push(error)
  });
  try { assert.equal(await microphoneSession.start(), false); } finally { console.warn = oldWarn; }
  assert.match(microphoneErrors[0], /無法開啟麥克風.*權限遭拒/);

  const channelSession = new RealtimeVoiceSession({});
  channelSession.channel = { readyState: "connecting" };
  const readiness = channelSession.waitForDataChannel(100);
  channelSession.channel.onerror();
  await assert.rejects(readiness, error => error.stage === "data_channel");
});

test("unsupported browsers cleanly fall back without breaking text chat", async () => {
  const errors = [];
  const session = new RealtimeVoiceSession({ mediaDevices: null, RTCPeerConnectionImpl: null, onError: error => errors.push(error) });
  assert.equal(await session.start(), false);
  assert.match(errors[0], /文字聊天/);
});
