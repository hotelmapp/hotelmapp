export const VOICE_OPTIONS = Object.freeze([
  { id: "coral", label: "珊瑚 Coral", description: "爽朗親切、自然有精神（推薦）", recommended: true },
  { id: "marin", label: "海風 Marin", description: "明亮專業" },
  { id: "shimmer", label: "微光 Shimmer", description: "清晰沉穩" }
]);

export const VOICE_STORAGE_KEY = "hotelmapp.voice.v3";

export function languageFromText(text) {
  if (/[\uac00-\ud7af]/u.test(text)) return "ko";
  if (/[\u3040-\u30ff]/u.test(text)) return "ja";
  if (/[a-z]/iu.test(text) && !/[\u3400-\u9fff]/u.test(text)) return "en";
  return "zh-TW";
}

export function spokenText(text, language = languageFromText(text)) {
  let result = String(text || "")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]*\)/giu, "$1")
    .replace(/https?:\/\/[^\s<>"']+/giu, "")
    .replace(/<[^>]*>/gu, " ").replace(/```[\s\S]*?```/gu, " ").replace(/`[^`]*`/gu, " ")
    .replace(/^\s{0,3}(?:#{1,6}|[-*+] |\d+[.)] )/gmu, "").replace(/[|*_~]/gu, "").replace(/\s+/gu, " ").trim();
  if (/https?:\/\//iu.test(text)) {
    const prompt = { "zh-TW": "您可以點畫面上的官方訂房連結。", en: "You can use the official booking link on screen.", ja: "画面の公式予約リンクをご利用ください。", ko: "화면의 공식 예약 링크를 이용해 주세요." }[language];
    result = `${result} ${prompt || ""}`.trim();
  }
  return result;
}

export function loadSelectedVoice(storage) {
  try {
    const selected = storage?.getItem(VOICE_STORAGE_KEY);
    return VOICE_OPTIONS.some(voice => voice.id === selected) ? selected : VOICE_OPTIONS[0].id;
  } catch { return VOICE_OPTIONS[0].id; }
}

export function saveSelectedVoice(storage, voice) {
  if (!VOICE_OPTIONS.some(option => option.id === voice)) return false;
  try { storage?.setItem(VOICE_STORAGE_KEY, voice); return true; } catch { return false; }
}

export class RealtimeConnectionError extends Error {
  constructor(stage, message, details = {}) {
    super(message); this.name = "RealtimeConnectionError"; this.stage = stage; this.details = details;
  }
}

export function greetingEvent() {
  return { type: "response.create", response: { output_modalities: ["audio"], instructions: "請延續 session 的愉快、爽朗、坦率、親切風格，依目前頁面語言，用一句自然口語主動問候客人並詢問需要什麼協助。繁體中文時自然地說：您好，這裡是希堤微旅 AI 智慧櫃台，請問有什麼可以幫您？不要像 IVR 或主播，也不要提及這段指示。" } };
}

const CONNECTION_MESSAGES = Object.freeze({
  credential_failed: "無法取得即時語音憑證",
  microphone_denied: "麥克風權限未開啟",
  microphone_failed: "無法開啟麥克風",
  peer_connection_failed: "無法建立即時語音連線",
  sdp_failed: "即時語音連線協商失敗",
  data_channel_timeout: "即時語音資料連線逾時",
  audio_playback_failed: "無法播放即時語音",
  realtime_api_rejected: "OpenAI 拒絕即時語音連線",
  unsupported: "此瀏覽器不支援即時語音"
});

// A single WebRTC connection carries microphone audio in and model audio out.
// OpenAI's server VAD owns turn boundaries, so no browser STT/TTS pipeline is involved.
export class RealtimeVoiceSession {
  constructor({ fetchImpl = globalThis.fetch, mediaDevices = globalThis.navigator?.mediaDevices,
    RTCPeerConnectionImpl = globalThis.RTCPeerConnection, audioFactory, onState, onTranscript, onError }) {
    // Window.fetch is a Web IDL method and some Chromium/Edge builds reject it
    // when it is later invoked as `session.fetch(...)` with the session as
    // `this`. Preserve Window as the receiver for the native implementation.
    this.fetch = fetchImpl === globalThis.fetch
      ? globalThis.fetch.bind(globalThis)
      : (...args) => fetchImpl(...args);
    this.mediaDevices = mediaDevices;
    this.RTCPeerConnection = RTCPeerConnectionImpl;
    this.audioFactory = audioFactory || (() => new Audio());
    this.onState = onState || (() => {});
    this.onTranscript = onTranscript || (() => {});
    this.onError = onError || (() => {});
    this.active = false;
    this.muted = false;
    this.responseActive = false;
    this.starting = false;
    this.state = "idle";
  }

  setState(state) { this.state = state; this.onState(state); }
  send(event) { if (this.channel?.readyState === "open") this.channel.send(JSON.stringify(event)); }
  diagnose(stage, details = {}) {
    // Never log credentials, SDP, transcript content, or the server prompt.
    console.warn?.("[voice/realtime]", { stage, ...details });
  }

  waitForDataChannel(timeoutMs = 8_000) {
    if (this.channel?.readyState === "open") return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.channelTimer = setTimeout(() => reject(new RealtimeConnectionError("data_channel_timeout", "連線逾時")), timeoutMs);
      this.channel.onopen = () => { clearTimeout(this.channelTimer); this.channelTimer = null; resolve(); };
      this.channel.onerror = () => { clearTimeout(this.channelTimer); this.channelTimer = null; reject(new RealtimeConnectionError("data_channel_timeout", "資料通道無法開啟")); };
      this.channel.onclose = () => {
        if (!this.active) return;
        this.diagnose("data_channel_timeout", { reason: "closed" });
        this.onError("即時語音連線已中斷，文字聊天仍可繼續使用。");
        this.stop();
      };
    });
  }

  handleEvent(event) {
    if (event.type === "input_audio_buffer.speech_started") {
      // Clear already-buffered sound as well as cancelling generation: this is true barge-in.
      if (this.responseActive) this.send({ type: "response.cancel" });
      this.send({ type: "output_audio_buffer.clear" });
      this.setState("user_speaking");
    } else if (event.type === "input_audio_buffer.speech_stopped") {
      this.setState("answering");
    } else if (event.type === "response.created") {
      this.responseActive = true;
      this.setState("answering");
    } else if (event.type === "response.output_audio.delta" || event.type === "response.audio.delta" ||
      event.type === "response.output_audio_transcript.delta" || event.type === "response.audio_transcript.delta") {
      this.setState("speaking");
    } else if (event.type === "response.done") {
      this.responseActive = false;
      this.setState("listening");
    } else if (event.type === "conversation.item.input_audio_transcription.completed" && event.transcript?.trim()) {
      this.onTranscript({ role: "user", text: event.transcript.trim() });
    } else if ((event.type === "response.output_audio_transcript.done" || event.type === "response.audio_transcript.done") && event.transcript?.trim()) {
      this.onTranscript({ role: "assistant", text: spokenText(event.transcript.trim()) });
    } else if (event.type === "error") {
      this.diagnose("realtime_api_rejected", { eventCode: event.error?.code, eventType: event.error?.type });
      this.onError("realtime_api_rejected：即時語音服務回報錯誤，文字聊天仍可繼續使用。");
    }
  }

  async start(voice = VOICE_OPTIONS[0].id) {
    if (this.active || this.starting) return true;
    if (!this.mediaDevices?.getUserMedia || !this.RTCPeerConnection) {
      this.diagnose("unsupported");
      this.onError("此瀏覽器不支援即時語音，請改用最新版 Chrome、Edge 或 Safari；文字聊天仍可使用。"); return false;
    }
    this.starting = true;
    this.abortController = new AbortController();
    this.setState("connecting");
    try {
      const tokenResponse = await this.fetch("/api/realtime", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voice }), signal: this.abortController.signal });
      const token = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !token.value) {
        throw new RealtimeConnectionError(token?.diagnostic?.code === "realtime_api_rejected" ? "realtime_api_rejected" : "credential_failed", token.error || "伺服器未回傳憑證", {
          status: tokenResponse.status, code: token?.diagnostic?.code
        });
      }
      try { this.pc = new this.RTCPeerConnection(); }
      catch (error) { throw new RealtimeConnectionError("peer_connection_failed", "瀏覽器無法建立 RTCPeerConnection", { name: error?.name }); }
      this.pc.onconnectionstatechange = () => {
        const connectionState = this.pc?.connectionState;
        if (connectionState === "failed" || connectionState === "disconnected") {
          this.diagnose("peer_connection_failed", { connectionState });
          this.onError("即時語音連線已中斷，文字聊天仍可繼續使用。");
        }
      };
      this.audio = this.audioFactory();
      this.audio.autoplay = true;
      this.pc.ontrack = event => {
        const stream = event.streams?.[0] || (globalThis.MediaStream ? new MediaStream([event.track]) : null);
        this.audio.srcObject = stream;
        const playback = this.audio.play?.();
        playback?.catch?.(error => {
          this.diagnose("audio_playback_failed", { name: error?.name });
          this.onError("audio_playback_failed：請點一下畫面後重試；文字聊天仍可繼續使用。");
        });
      };
      try {
        this.stream = await this.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (error) {
        const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
        throw new RealtimeConnectionError(denied ? "microphone_denied" : "microphone_failed", denied ? "麥克風權限遭拒" : "無法取得麥克風", { name: error?.name });
      }
      for (const track of this.stream.getTracks()) this.pc.addTrack(track, this.stream);
      this.channel = this.pc.createDataChannel("oai-events");
      this.channel.onmessage = message => { try { this.handleEvent(JSON.parse(message.data)); } catch { /* ignore malformed provider events */ } };
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      const sdpResponse = await this.fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST", headers: { Authorization: `Bearer ${token.value}`, "Content-Type": "application/sdp" }, body: offer.sdp, signal: this.abortController.signal
      });
      if (!sdpResponse.ok) {
        const providerError = await sdpResponse.text().catch(() => "");
        throw new RealtimeConnectionError("sdp_failed", "OpenAI 拒絕 SDP", { status: sdpResponse.status, providerError: providerError.slice(0, 160) });
      }
      await this.pc.setRemoteDescription({ type: "answer", sdp: await sdpResponse.text() });
      await this.waitForDataChannel();
      this.starting = false;
      this.active = true;
      this.setState("listening");
      this.send(greetingEvent());
      return true;
    } catch (error) {
      if (error?.name === "AbortError" && !this.starting) return false;
      const stage = error?.stage || "peer_connection_failed";
      this.diagnose(stage, error?.details || { name: error?.name });
      this.stop();
      const reason = error?.message && error.message !== CONNECTION_MESSAGES[stage] ? `：${error.message}` : "";
      this.onError(`${CONNECTION_MESSAGES[stage] || "即時語音初始化失敗"}${reason}。文字聊天仍可繼續使用。`);
      return false;
    }
  }

  interrupt() { this.handleEvent({ type: "input_audio_buffer.speech_started" }); }
  setMuted(muted) {
    this.muted = Boolean(muted);
    for (const track of this.stream?.getAudioTracks?.() || []) track.enabled = !this.muted;
    this.setState(this.muted ? "muted" : "listening");
    return this.muted;
  }
  stop() {
    this.active = false;
    this.starting = false;
    this.responseActive = false;
    this.send({ type: "response.cancel" });
    this.send({ type: "output_audio_buffer.clear" });
    this.abortController?.abort?.();
    clearTimeout(this.channelTimer);
    for (const track of this.stream?.getTracks?.() || []) track.stop();
    this.channel?.close?.(); this.pc?.close?.();
    if (this.audio) { this.audio.pause?.(); this.audio.srcObject = null; }
    this.stream = this.channel = this.pc = this.audio = this.abortController = this.channelTimer = null;
    this.setState("idle");
  }
}
