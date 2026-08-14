export const VOICE_OPTIONS = Object.freeze([
  { id: "coral", label: "珊瑚 Coral", description: "親切自然（推薦）", recommended: true },
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

// A single WebRTC connection carries microphone audio in and model audio out.
// OpenAI's server VAD owns turn boundaries, so no browser STT/TTS pipeline is involved.
export class RealtimeVoiceSession {
  constructor({ fetchImpl = globalThis.fetch, mediaDevices = globalThis.navigator?.mediaDevices,
    RTCPeerConnectionImpl = globalThis.RTCPeerConnection, audioFactory, onState, onTranscript, onError }) {
    this.fetch = fetchImpl;
    this.mediaDevices = mediaDevices;
    this.RTCPeerConnection = RTCPeerConnectionImpl;
    this.audioFactory = audioFactory || (() => new Audio());
    this.onState = onState || (() => {});
    this.onTranscript = onTranscript || (() => {});
    this.onError = onError || (() => {});
    this.active = false;
    this.state = "idle";
  }

  setState(state) { this.state = state; this.onState(state); }
  send(event) { if (this.channel?.readyState === "open") this.channel.send(JSON.stringify(event)); }

  handleEvent(event) {
    if (event.type === "input_audio_buffer.speech_started") {
      // Clear already-buffered sound as well as cancelling generation: this is true barge-in.
      this.send({ type: "response.cancel" });
      this.send({ type: "output_audio_buffer.clear" });
      this.setState("listening");
    } else if (event.type === "input_audio_buffer.speech_stopped") {
      this.setState("answering");
    } else if (event.type === "response.created") {
      this.setState("answering");
    } else if (event.type === "response.output_audio.delta" || event.type === "response.audio.delta" ||
      event.type === "response.output_audio_transcript.delta" || event.type === "response.audio_transcript.delta") {
      this.setState("speaking");
    } else if (event.type === "response.done") {
      this.setState("listening");
    } else if (event.type === "conversation.item.input_audio_transcription.completed" && event.transcript?.trim()) {
      this.onTranscript({ role: "user", text: event.transcript.trim() });
    } else if ((event.type === "response.output_audio_transcript.done" || event.type === "response.audio_transcript.done") && event.transcript?.trim()) {
      this.onTranscript({ role: "assistant", text: spokenText(event.transcript.trim()) });
    } else if (event.type === "error") {
      this.onError("即時語音暫時無法使用，您仍可繼續使用文字聊天。");
    }
  }

  async start(voice = VOICE_OPTIONS[0].id) {
    if (this.active) return true;
    if (!this.mediaDevices?.getUserMedia || !this.RTCPeerConnection) {
      this.onError("此瀏覽器不支援即時語音，請使用文字聊天。"); return false;
    }
    this.setState("connecting");
    try {
      const tokenResponse = await this.fetch("/api/realtime", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voice }) });
      const token = await tokenResponse.json();
      if (!tokenResponse.ok || !token.value) throw new Error("session unavailable");
      this.pc = new this.RTCPeerConnection();
      this.audio = this.audioFactory();
      this.audio.autoplay = true;
      this.pc.ontrack = event => { this.audio.srcObject = event.streams[0]; };
      this.stream = await this.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      for (const track of this.stream.getTracks()) this.pc.addTrack(track, this.stream);
      this.channel = this.pc.createDataChannel("oai-events");
      this.channel.onmessage = message => { try { this.handleEvent(JSON.parse(message.data)); } catch { /* ignore malformed provider events */ } };
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      const sdpResponse = await this.fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST", headers: { Authorization: `Bearer ${token.value}`, "Content-Type": "application/sdp" }, body: offer.sdp
      });
      if (!sdpResponse.ok) throw new Error("realtime negotiation failed");
      await this.pc.setRemoteDescription({ type: "answer", sdp: await sdpResponse.text() });
      this.active = true;
      this.setState("listening");
      return true;
    } catch (error) {
      this.stop();
      this.onError(error?.name === "NotAllowedError" ? "麥克風權限未開啟，仍可使用文字聊天。" : "即時語音暫時無法使用，請使用文字聊天。");
      return false;
    }
  }

  interrupt() { this.handleEvent({ type: "input_audio_buffer.speech_started" }); }
  stop() {
    this.active = false;
    for (const track of this.stream?.getTracks?.() || []) track.stop();
    this.channel?.close?.(); this.pc?.close?.();
    if (this.audio) { this.audio.pause?.(); this.audio.srcObject = null; }
    this.stream = this.channel = this.pc = this.audio = null;
    this.setState("idle");
  }
}
