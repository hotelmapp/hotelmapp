import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hotelKnowledge } from "../data/hotel-info.js";
import {
  hospitalityPersonalityInstructions,
  channelPresentationInstructions
} from "../ai-core/hospitality-personality.js";
import { breakfastReply, informationalReply, responsesPayload, sensitiveSituationReply } from "../ai-core/guest-response.js";
import { voiceInstructions } from "../api/realtime.js";

test("Web and LINE compose the same shared hospitality personality with presentation-only differences", () => {
  const personality = hospitalityPersonalityInstructions();
  const web = responsesPayload("飯店地址在哪裡？", [], "web").instructions;
  const line = responsesPayload("飯店地址在哪裡？", [], "line").instructions;
  assert.ok(web.startsWith(personality));
  assert.ok(line.startsWith(personality));
  assert.match(web, /Web 呈現/);
  assert.match(line, /LINE 呈現/);
  assert.notEqual(channelPresentationInstructions("web"), channelPresentationInstructions("line"));
});

test("Voice retains the shared personality and adds speech-appropriate formatting", () => {
  const instructions = voiceInstructions();
  assert.ok(instructions.startsWith(hospitalityPersonalityInstructions()));
  assert.match(instructions, /語音呈現.*口語短句/);
  assert.match(instructions, /不使用條列、Markdown、標題、表情符號、網址/);
});

test("personality changes presentation without changing canonical hotel facts", () => {
  const parking = informationalReply("請問有停車位嗎？");
  assert.match(parking, new RegExp(`${hotelKnowledge.parking.hotelSpaces} 個車位`));
  assert.match(parking, /配合停車場/);
  assert.match(parking, /依當天現場狀況/);
  assert.equal(hotelKnowledge.breakfast.serviceHours, "08:00–10:00");
  assert.equal(hotelKnowledge.breakfast.childPrice, null);
});

test("unknown information stays warm and is never invented", () => {
  const answer = breakfastReply("小朋友早餐多少錢？");
  assert.match(answer, /目前沒有確認到/);
  assert.match(answer, /櫃檯確認/);
  assert.doesNotMatch(answer, /(?:NT\$|元|價格是)\s*\d+/u);
});

test("simple breakfast time stays concise and naturally friendly", () => {
  assert.equal(breakfastReply("早餐幾點？"), "早餐時間是 08:00–10:00 喔～");
});

test("vegetarian breakfast offers the confirmed arrangement in a service-first tone", () => {
  const answer = breakfastReply("早餐可以素食嗎？");
  assert.match(answer, /^可以喔～/);
  assert.match(answer, /提前告知櫃台.*蛋奶素餐點/);
});

test("parking gives a useful next step without guaranteeing a space", () => {
  const answer = informationalReply("停車怎麼辦？");
  assert.match(answer, /3 個車位.*配合停車場/);
  assert.match(answer, /依當天現場狀況與車位情形協助安排/);
  assert.doesNotMatch(answer, /保證|一定有/);
});

test("equipment trouble and complaints use restrained handoff language", () => {
  for (const message of ["房間冷氣壞掉了", "我要客訴，真的很不滿"]) {
    const answer = sensitiveSituationReply(message);
    assert.match(answer, /櫃檯|飯店同仁/);
    assert.doesNotMatch(answer, /😊|沒問題喔|～/u);
  }
});

test("payment, refund, and booking changes never claim an unperformed result", () => {
  const payment = sensitiveSituationReply("重複扣款了，請幫我退款");
  assert.match(payment, /不會先承諾退款或款項已處理/);
  const booking = sensitiveSituationReply("請幫我修改訂房日期");
  assert.match(booking, /還沒有替您完成變更/);
  assert.match(booking, /原平台申請/);
});

test("handoff honesty and booking, payment, and refund guardrails remain in shared instructions", () => {
  const instructions = responsesPayload("請幫我退款並通知櫃檯", [], "web").instructions;
  assert.match(instructions, /不可聲稱已修改、取消、付款或退款/);
  assert.match(instructions, /聊天本身不會寄出留言/);
  assert.match(instructions, /不得猜測即時房價、空房/);
  assert.match(instructions, /系統沒有實際完成的員工動作，不得聲稱已完成/);
});

test("channel adapters contain presentation wiring, not duplicated personality rules", async () => {
  const [chat, line, realtime] = await Promise.all([
    readFile(new URL("../api/chat.js", import.meta.url), "utf8"),
    readFile(new URL("../api/line/webhook.js", import.meta.url), "utf8"),
    readFile(new URL("../api/realtime.js", import.meta.url), "utf8")
  ]);
  for (const source of [chat, line]) {
    assert.doesNotMatch(source, /台灣待客|真人櫃檯夥伴|親切絕不能凌駕真實性/);
  }
  assert.doesNotMatch(realtime, /台灣待客|親切絕不能凌駕真實性/);
  assert.match(line, /answerGuestMessage/);
  assert.match(realtime, /styledInstructions\("voice"\)/);
});
