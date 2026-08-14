import test from "node:test";
import assert from "node:assert/strict";
import {
  createVoiceAssistant,
  initialSpeechLocale,
  recognitionConstructor,
  recognitionErrorMessage,
  sanitizeForSpeech,
  selectVoice,
  speechLocale
} from "../voice-assistant.js";

function buttonStub() {
  const listeners = {};
  return {
    hidden: true,
    textContent: "",
    classList: { add() {}, remove() {} },
    setAttribute() {},
    addEventListener(type, listener) { listeners[type] = listener; },
    click() { listeners.click?.(); }
  };
}

test("removes plain HTTPS URLs from speech", () => {
  const speech = sanitizeForSpeech("您可以查看官方訂房頁：https://book-directonline.com/hotel?id=1 最新房價與空房。");
  assert.doesNotMatch(speech, /https|book-directonline|\/\//iu);
  assert.match(speech, /您可以查看官方訂房頁/);
  assert.match(speech, /最新房價與空房/);
});

test("keeps readable Chinese, English, Japanese, and Korean content", () => {
  for (const text of [
    "早餐供應時間是早上八點。",
    "Breakfast is served from eight o'clock.",
    "朝食は午前8時からです。",
    "조식은 오전 8시부터 제공됩니다."
  ]) {
    assert.equal(sanitizeForSpeech(text), text);
  }
});

test("keeps Markdown link labels and removes their URLs and formatting", () => {
  const speech = sanitizeForSpeech("請使用 [官方訂房](https://example.com/rooms) **查看空房**。");
  assert.equal(speech, "請使用 官方訂房 查看空房。");
  assert.doesNotMatch(speech, /https|example\.com|[*()[\]]/u);
});

test("maps guest and browser languages to the four speech locales", () => {
  assert.equal(speechLocale("zh-TW"), "zh-TW");
  assert.equal(speechLocale("en"), "en-US");
  assert.equal(speechLocale("ja"), "ja-JP");
  assert.equal(speechLocale("ko"), "ko-KR");
  assert.equal(initialSpeechLocale("fr", ["ja-JP", "en-US"]), "ja-JP");
});

test("uses standard or prefixed recognition without requiring it for text chat", () => {
  const Standard = class {};
  const Prefixed = class {};
  assert.equal(recognitionConstructor({ SpeechRecognition: Standard }), Standard);
  assert.equal(recognitionConstructor({ webkitSpeechRecognition: Prefixed }), Prefixed);
  assert.equal(recognitionConstructor({}), null);
  // The existing form submission owns the chat flow; unsupported voice yields no replacement API.
  assert.equal(typeof recognitionErrorMessage("not-allowed"), "string");
  assert.match(recognitionErrorMessage("no-speech"), /沒有辨識到語音/);
  assert.match(recognitionErrorMessage("aborted"), /已停止/);
});

test("selects an exact locale voice before a language-family fallback", () => {
  const voices = [{ lang: "en-GB" }, { lang: "en-US" }, { lang: "ja-JP" }];
  assert.equal(selectVoice(voices, "en"), voices[1]);
  assert.equal(selectVoice(voices, "ko"), null);
});

test("unsupported recognition and synthesis preserve the existing text chat UI", () => {
  const form = { marker: "unchanged" };
  const microphoneButton = buttonStub();
  const speakerButton = buttonStub();
  const voiceStatus = { textContent: "" };
  const assistant = createVoiceAssistant({
    window: { document: { documentElement: { lang: "zh-TW" } }, navigator: { languages: [] } },
    form,
    input: { value: "文字問題" },
    microphoneButton,
    voiceStatus,
    speakerButton
  });

  assert.equal(microphoneButton.disabled, true);
  assert.match(voiceStatus.textContent, /仍可直接輸入文字/);
  assert.equal(form.marker, "unchanged");
  assistant.setLatestAnswer("AI 的文字回答仍然存在。");
  assert.equal(speakerButton.hidden, false);
  speakerButton.click();
  assert.match(voiceStatus.textContent, /文字回答仍可正常查看/);
});
