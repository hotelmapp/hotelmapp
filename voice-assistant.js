const LOCALE_MAP = Object.freeze({
  "zh-TW": "zh-TW",
  zh: "zh-TW",
  en: "en-US",
  "en-US": "en-US",
  ja: "ja-JP",
  "ja-JP": "ja-JP",
  ko: "ko-KR",
  "ko-KR": "ko-KR"
});

export function speechLocale(language = "") {
  const normalized = String(language).replace("_", "-");
  return LOCALE_MAP[normalized] || LOCALE_MAP[normalized.split("-")[0]] || "zh-TW";
}

export function initialSpeechLocale(documentLanguage = "", browserLanguages = []) {
  const candidates = [documentLanguage, ...(Array.isArray(browserLanguages) ? browserLanguages : [])];
  const supported = candidates.find(language => /^(?:zh|en|ja|ko)(?:-|$)/iu.test(language || ""));
  return speechLocale(supported || "zh-TW");
}

/** Produce a plain-language copy for TTS without changing the displayed AI answer. */
export function sanitizeForSpeech(value) {
  return String(value ?? "")
    // Keep a Markdown link's useful label, but never its destination.
    .replace(/\[([^\]]+)\]\(\s*https?:\/\/[^\s)]+(?:\([^)]*\)[^\s)]*)?\s*\)/giu, "$1")
    .replace(/https?:\/\/[^\s<>"']+/giu, " ")
    .replace(/<[^>]*>/gu, " ")
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/(?:^|\s)[#>*_~]+/gmu, " ")
    .replace(/[\[\]_*~]/gu, "")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, " and ")
    .replace(/&lt;/giu, " less than ")
    .replace(/&gt;/giu, " greater than ")
    .replace(/[ \t]+/gu, " ")
    .replace(/\s*\n\s*/gu, "。")
    .replace(/\s+([，。！？,.!?])/gu, "$1")
    .trim();
}

export function recognitionConstructor(scope = globalThis) {
  return scope?.SpeechRecognition || scope?.webkitSpeechRecognition || null;
}

export function recognitionErrorMessage(code) {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "無法使用麥克風權限，您仍可直接輸入文字。";
  }
  if (code === "no-speech") return "沒有辨識到語音，請再試一次或直接輸入文字。";
  if (code === "aborted") return "語音辨識已停止，您仍可直接輸入文字。";
  return "語音辨識暫時無法使用，您仍可直接輸入文字。";
}

export function selectVoice(voices, locale) {
  const target = speechLocale(locale).toLowerCase();
  const base = target.split("-")[0];
  return voices.find(voice => voice.lang?.toLowerCase() === target)
    || voices.find(voice => voice.lang?.toLowerCase().split("-")[0] === base)
    || null;
}

export function createVoiceAssistant({ window, form, input, microphoneButton, voiceStatus, speakerButton }) {
  const Recognition = recognitionConstructor(window);
  const synthesis = window?.speechSynthesis;
  let recognition = null;
  let listening = false;
  let speaking = false;
  let locale = initialSpeechLocale(window?.document?.documentElement?.lang, window?.navigator?.languages);
  let latestAnswer = "";

  const stopSpeaking = () => {
    if (synthesis) synthesis.cancel();
    speaking = false;
    speakerButton.textContent = "🔊 朗讀";
    speakerButton.setAttribute("aria-pressed", "false");
  };

  const setLocale = language => { locale = speechLocale(language); };
  const setLatestAnswer = text => {
    latestAnswer = String(text || "");
    speakerButton.hidden = !latestAnswer;
  };

  if (!Recognition) {
    microphoneButton.disabled = true;
    microphoneButton.title = "此瀏覽器目前不支援語音輸入";
    voiceStatus.textContent = "此瀏覽器目前不支援語音輸入，您仍可直接輸入文字。";
  } else {
    microphoneButton.addEventListener("click", () => {
      stopSpeaking();
      if (listening) {
        recognition?.abort();
        return;
      }
      recognition = new Recognition();
      recognition.lang = locale;
      recognition.interimResults = false;
      recognition.continuous = false;
      recognition.onstart = () => {
        listening = true;
        microphoneButton.classList.add("listening");
        microphoneButton.setAttribute("aria-pressed", "true");
        voiceStatus.textContent = "正在聆聽…";
      };
      recognition.onresult = event => {
        const transcript = event.results?.[0]?.[0]?.transcript?.trim();
        if (!transcript) return;
        input.value = transcript;
        voiceStatus.textContent = "辨識完成，正在送出…";
        form.requestSubmit();
      };
      recognition.onerror = event => { voiceStatus.textContent = recognitionErrorMessage(event.error); };
      recognition.onend = () => {
        listening = false;
        microphoneButton.classList.remove("listening");
        microphoneButton.setAttribute("aria-pressed", "false");
      };
      try {
        recognition.start();
      } catch {
        voiceStatus.textContent = recognitionErrorMessage("start-failed");
      }
    });
  }

  speakerButton.addEventListener("click", () => {
    if (speaking) {
      stopSpeaking();
      return;
    }
    if (!synthesis || typeof window.SpeechSynthesisUtterance !== "function") {
      voiceStatus.textContent = "此瀏覽器目前不支援語音朗讀，文字回答仍可正常查看。";
      return;
    }
    const speechText = sanitizeForSpeech(latestAnswer);
    if (!speechText) return;
    synthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(speechText);
    utterance.lang = locale;
    utterance.voice = selectVoice(synthesis.getVoices(), locale);
    utterance.onend = utterance.onerror = () => stopSpeaking();
    speaking = true;
    speakerButton.textContent = "⏹ 停止";
    speakerButton.setAttribute("aria-pressed", "true");
    synthesis.speak(utterance);
  });

  return { setLocale, setLatestAnswer, stopSpeaking };
}
