import test from "node:test";
import assert from "node:assert/strict";
import {
  languageFromText, loadSelectedVoice, saveSelectedVoice, spokenText,
  VoiceConversation, voiceLocaleFor, VOICE_STORAGE_KEY
} from "../voice-assistant.js";
import { speechPayload } from "../api/voice.js";

test("maps all supported languages to recognition locales", () => {
  assert.equal(voiceLocaleFor("zh-TW"), "zh-TW");
  assert.equal(voiceLocaleFor("en"), "en-US");
  assert.equal(voiceLocaleFor("ja"), "ja-JP");
  assert.equal(voiceLocaleFor("ko"), "ko-KR");
  assert.equal(languageFromText("好的，請問幾位？"), "zh-TW");
  assert.equal(languageFromText("How many guests?"), "en");
  assert.equal(languageFromText("何名様ですか？"), "ja");
  assert.equal(languageFromText("몇 분이세요?"), "ko");
});

test("persists a valid selected voice and safely defaults invalid storage", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(loadSelectedVoice(storage), "coral");
  assert.equal(saveSelectedVoice(storage, "shimmer"), true);
  assert.equal(values.get(VOICE_STORAGE_KEY), "shimmer");
  assert.equal(loadSelectedVoice(storage), "shimmer");
  values.set(VOICE_STORAGE_KEY, "invalid");
  assert.equal(loadSelectedVoice(storage), "coral");
  assert.equal(saveSelectedVoice(storage, "invalid"), false);
});

test("removes URLs, Markdown, and HTML from speech while retaining screen-link guidance", () => {
  const result = spokenText("## 房況\n<strong>請查看</strong> [官網](https://example.com) `checkInDate=2026-08-20`\nhttps://book-directonline.com/?checkInDate=2026-08-20", "zh-TW");
  assert.doesNotMatch(result, /https?:|<strong>|##|\[官網\]|book-directonline/u);
  assert.match(result, /點畫面上的官方訂房連結/);
});

test("neural provider receives only conversational sanitized speech", () => {
  const payload = speechPayload("**您好** https://example.com/book", "coral", "zh-TW");
  assert.equal(payload.voice, "coral");
  assert.equal(payload.model, "gpt-4o-mini-tts");
  assert.doesNotMatch(payload.input, /https?:|\*\*/u);
  assert.match(payload.instructions, /Taiwanese style/);
});

function recognitionDouble() {
  return { starts: 0, aborts: 0, start() { this.starts++; }, abort() { this.aborts++; } };
}

test("unsupported recognition falls back without affecting text chat", () => {
  const errors = [];
  const controller = new VoiceConversation({ recognition: null, onError: error => errors.push(error) });
  assert.equal(controller.start("zh-TW"), false);
  assert.match(errors[0], /文字聊天/);
});

test("neural voice failure automatically uses the browser TTS fallback", async () => {
  const spoken = [];
  const errors = [];
  const controller = new VoiceConversation({
    recognition: null,
    playNeural: async () => { throw new Error("provider down"); },
    speakFallback: async (text, locale) => spoken.push({ text, locale }),
    onError: error => errors.push(error)
  });
  await controller.speak("您好，我來幫您。", { voice: "coral", language: "zh-TW" });
  assert.deepEqual(spoken, [{ text: "您好，我來幫您。", locale: "zh-TW" }]);
  assert.match(errors[0], /裝置語音/);
});

test("barge-in and a new question stop existing audio", () => {
  const recognition = recognitionDouble();
  let stopped = 0;
  const controller = new VoiceConversation({ recognition, onTranscript() {} });
  controller.active = true;
  controller.playback = { stop() { stopped++; } };
  recognition.onspeechstart();
  assert.equal(stopped, 1);

  controller.playback = { stop() { stopped++; } };
  controller.stopSpeaking();
  assert.equal(stopped, 2);
});

test("final recognition results continue the same multi-turn conversation callback", () => {
  const recognition = recognitionDouble();
  const turns = [];
  const controller = new VoiceConversation({ recognition, onTranscript: text => turns.push(text) });
  controller.start("zh-TW");
  recognition.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "8 月 20 號有房嗎？" } }] });
  recognition.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "兩晚。" } }] });
  assert.deepEqual(turns, ["8 月 20 號有房嗎？", "兩晚。​".replace("\u200b", "")]);
});
