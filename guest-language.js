export const SUPPORTED_LANGUAGES = Object.freeze(["zh-TW", "en", "ja", "ko"]);

function languageScore(text) {
  const value = typeof text === "string" ? text.replace(/https?:\/\/\S+/giu, " ") : "";
  return {
    ko: (value.match(/[\uac00-\ud7af]/gu) || []).length * 3,
    ja: (value.match(/[\u3040-\u30ff]/gu) || []).length * 3,
    en: (value.match(/[A-Za-z]+/g) || []).join("").length,
    "zh-TW": (value.match(/[\u3400-\u9fff]/gu) || []).length
  };
}

/** Prefer the current message; use recent guest messages only when it is ambiguous. */
export function detectGuestLanguage(message, history = []) {
  const choose = text => {
    const scores = languageScore(text);
    if (scores.ko) return "ko";
    if (scores.ja) return "ja";
    if (scores.en >= 3 && scores.en > scores["zh-TW"] * 2) return "en";
    if (scores["zh-TW"]) return "zh-TW";
    return null;
  };
  const current = choose(message);
  if (current) return current;
  if (Array.isArray(history)) {
    for (const item of [...history].reverse()) {
      if (item?.role !== "user") continue;
      const recent = choose(item.content);
      if (recent) return recent;
    }
  }
  return "zh-TW";
}
