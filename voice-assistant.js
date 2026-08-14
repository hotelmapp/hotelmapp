export const VOICE_OPTIONS = Object.freeze([
  { id: "coral", label: "珊瑚 Coral", description: "親切自然（推薦）", recommended: true },
  { id: "shimmer", label: "微光 Shimmer", description: "清晰沉穩" },
  { id: "sage", label: "青蕙 Sage", description: "溫暖專業" }
]);

export const VOICE_STORAGE_KEY = "hotelmapp.voice.v2";

export function voiceLocaleFor(language) {
  return ({ "zh-TW": "zh-TW", en: "en-US", ja: "ja-JP", ko: "ko-KR" })[language] || "zh-TW";
}

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
    .replace(/<[^>]*>/gu, " ")
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`[^`]*`/gu, " ")
    .replace(/^\s{0,3}(?:#{1,6}|[-*+] |\d+[.)] )/gmu, "")
    .replace(/\b(?:checkInDate|checkOutDate|locale)\s*=\s*[^\s]+/giu, " ")
    .replace(/[|*_~]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (/https?:\/\//iu.test(text)) {
    const prompt = {
      "zh-TW": "您可以點畫面上的官方訂房連結，查看最新房況和價格。",
      en: "You can use the official booking link on screen to check the latest availability and rates.",
      ja: "画面の公式予約リンクから、最新の空室状況と料金をご確認いただけます。",
      ko: "화면의 공식 예약 링크에서 최신 객실 상황과 요금을 확인하실 수 있어요."
    }[language] || "";
    result = `${result} ${prompt}`.trim();
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

export class VoiceConversation {
  constructor({ recognition, playNeural, speakFallback, onTranscript, onState, onError }) {
    this.recognition = recognition;
    this.playNeural = playNeural;
    this.speakFallback = speakFallback;
    this.onTranscript = onTranscript;
    this.onState = onState || (() => {});
    this.onError = onError || (() => {});
    this.active = false;
    this.playback = null;
    this.request = null;
    if (recognition) this.bindRecognition();
  }

  bindRecognition() {
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.onstart = () => this.onState("listening");
    this.recognition.onspeechstart = () => this.stopSpeaking();
    this.recognition.onresult = event => {
      const result = event.results[event.resultIndex];
      if (result?.isFinal && result[0]?.transcript?.trim()) this.onTranscript(result[0].transcript.trim());
    };
    this.recognition.onend = () => { if (this.active && !this.playback && !this.request) this.listen(); };
    this.recognition.onerror = event => {
      if (event.error === "aborted") return;
      this.onError(event.error === "not-allowed" ? "麥克風權限未開啟，仍可使用文字聊天。" : "沒有聽清楚，請再說一次或使用文字輸入。");
      if (event.error === "not-allowed") this.active = false;
    };
  }

  start(locale) {
    if (!this.recognition) { this.onError("此瀏覽器不支援語音辨識，請使用文字聊天。"); return false; }
    this.active = true;
    this.recognition.lang = locale;
    this.listen();
    return true;
  }

  listen() {
    if (!this.active) return;
    try { this.recognition.start(); } catch { /* recognition is already starting */ }
  }

  stopSpeaking() {
    this.request?.abort();
    this.request = null;
    this.playback?.stop?.();
    this.playback = null;
    globalThis.speechSynthesis?.cancel?.();
    if (this.active) this.listen(); else this.onState("idle");
  }

  stop() {
    this.active = false;
    this.stopSpeaking();
    try { this.recognition?.abort(); } catch { /* already stopped */ }
    this.onState("idle");
  }

  async speak(text, { voice, language }) {
    this.stopSpeaking();
    try { this.recognition?.abort(); } catch { /* already stopped */ }
    const clean = spokenText(text, language);
    if (!clean) return;
    this.onState("speaking");
    const controller = new AbortController();
    this.request = controller;
    try {
      this.playback = await this.playNeural(clean, { voice, language, signal: controller.signal });
      await this.playback.finished;
    } catch (error) {
      if (error?.name !== "AbortError") {
        this.onError("高品質語音暫時無法使用，已切換為裝置語音。");
        await this.speakFallback?.(clean, voiceLocaleFor(language));
      }
    } finally {
      if (this.request === controller) {
        this.request = null;
        this.playback = null;
        if (this.active) this.listen(); else this.onState("idle");
      }
    }
  }
}
