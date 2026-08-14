import test from "node:test";
import assert from "node:assert/strict";
import { greetingEvent, languageFromText, loadSelectedVoice, saveSelectedVoice, spokenText, RealtimeVoiceSession, VOICE_STORAGE_KEY } from "../voice-assistant.js";
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

test("realtime session keeps context and uses semantic VAD interruption", () => {
  const session = realtimeSession("coral").session;
  assert.match(session.instructions, /整個 session 的對話歷史/);
  assert.match(session.instructions, /那小朋友呢/);
  assert.equal(session.audio.input.turn_detection.type, "semantic_vad");
  assert.equal(session.audio.input.turn_detection.eagerness, "high");
  assert.equal(session.audio.input.turn_detection.create_response, true);
  assert.equal(session.audio.input.turn_detection.interrupt_response, true);
});

test("speech-start immediately cancels response and clears buffered audio", () => {
  const sent = [];
  const states = [];
  const session = new RealtimeVoiceSession({ onState: state => states.push(state) });
  session.channel = { readyState: "open", send: value => sent.push(JSON.parse(value)) };
  session.responseActive = true;
  session.handleEvent({ type: "input_audio_buffer.speech_started" });
  assert.deepEqual(sent.map(item => item.type), ["response.cancel", "output_audio_buffer.clear"]);
  assert.equal(states.at(-1), "user_speaking");
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
  assert.equal(result.body.diagnostic.code, "credential_failed");
  assert.equal(result.body.diagnostic.reason, "missing_api_key");
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
  assert.equal(warnings[0].stage, "credential_failed");
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
  assert.match(microphoneErrors[0], /麥克風權限未開啟.*權限遭拒/);

  const channelSession = new RealtimeVoiceSession({});
  channelSession.channel = { readyState: "connecting" };
  const readiness = channelSession.waitForDataChannel(100);
  channelSession.channel.onerror();
  await assert.rejects(readiness, error => error.stage === "data_channel_timeout");
});

test("mute, AI speaking, greeting, and end-session cleanup work without TTS", () => {
  const sent = [];
  let trackStopped = 0;
  const track = { enabled: true, stop() { trackStopped++; } };
  const states = [];
  const session = new RealtimeVoiceSession({ onState: state => states.push(state) });
  session.active = true;
  session.stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  session.channel = { readyState: "open", send: value => sent.push(JSON.parse(value)), close() {} };
  session.pc = { close() {} };
  session.audio = { pause() {}, srcObject: {} };
  assert.equal(session.setMuted(true), true);
  assert.equal(track.enabled, false);
  assert.equal(session.setMuted(false), false);
  assert.equal(track.enabled, true);
  session.handleEvent({ type: "response.created" });
  session.handleEvent({ type: "response.output_audio.delta" });
  assert.equal(states.at(-1), "speaking");
  session.stop();
  assert.equal(trackStopped, 1);
  assert.equal(session.active, false);
  assert.equal(session.pc, null);
  assert.deepEqual(sent.slice(-2).map(item => item.type), ["response.cancel", "output_audio_buffer.clear"]);
  assert.equal(greetingEvent().type, "response.create");
  assert.deepEqual(greetingEvent().response.output_modalities, ["audio"]);
  assert.match(greetingEvent().response.instructions, /主動問候.*希堤微旅 AI 智慧櫃台/);
});

test("successful Chromium-style WebRTC flow reaches listening and requests native audio greeting", async () => {
  const sent = [];
  const channel = { readyState: "connecting", send: value => sent.push(JSON.parse(value)), close() {} };
  class PeerConnection {
    createDataChannel() { return channel; }
    addTrack(track) { this.addedTrack = track; }
    async createOffer() { return { type: "offer", sdp: "test-offer" }; }
    async setLocalDescription(offer) { this.localDescription = offer; }
    async setRemoteDescription(answer) { this.remoteDescription = answer; channel.readyState = "open"; }
    close() {}
  }
  let fetchNumber = 0;
  const fetchImpl = async (_url, options) => ++fetchNumber === 1
    ? { ok: true, status: 200, json: async () => ({ value: "ephemeral" }) }
    : { ok: true, status: 200, text: async () => "test-answer", options };
  const track = { enabled: true, stop() {} };
  const states = [];
  const session = new RealtimeVoiceSession({
    fetchImpl, mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) },
    RTCPeerConnectionImpl: PeerConnection, audioFactory: () => ({ play: async () => {} }), onState: state => states.push(state)
  });
  assert.equal(await session.start("coral"), true);
  assert.equal(session.active, true);
  assert.equal(states.at(-1), "listening");
  assert.equal(session.pc.localDescription.sdp, "test-offer");
  assert.equal(session.pc.remoteDescription.sdp, "test-answer");
  assert.equal(sent.at(-1).type, "response.create");
  assert.deepEqual(sent.at(-1).response.output_modalities, ["audio"]);
  session.stop();
});

test("binds browser Window.fetch during realtime credential initialization", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = function (_url) {
    if (this !== globalThis) throw new TypeError("Illegal invocation");
    calls++;
    return calls === 1
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ value: "ephemeral" }) })
      : Promise.resolve({ ok: true, status: 200, text: async () => "answer-sdp" });
  };
  const channel = { readyState: "open", send() {}, close() {} };
  class PeerConnection {
    createDataChannel() { return channel; }
    addTrack() {}
    async createOffer() { return { type: "offer", sdp: "offer-sdp" }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    close() {}
  }
  const track = { stop() {} };
  try {
    const session = new RealtimeVoiceSession({
      mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) },
      RTCPeerConnectionImpl: PeerConnection, audioFactory: () => ({ play: async () => {} })
    });
    assert.equal(await session.start("coral"), true);
    assert.equal(calls, 2);
    session.stop();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unsupported browsers cleanly fall back without breaking text chat", async () => {
  const errors = [];
  const session = new RealtimeVoiceSession({ mediaDevices: null, RTCPeerConnectionImpl: null, onError: error => errors.push(error) });
  assert.equal(await session.start(), false);
  assert.match(errors[0], /文字聊天/);
});
