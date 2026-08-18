import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decideHandoff } from "../ai-core/handoff.js";
import {
  advanceHandoffAuthorization, handoffEmail, hasRequiredHandoffContact,
  performAuthorizedHandoff, performHandoff
} from "../ai-core/handoff-service.js";
import { frontDeskEmail, LEGACY_FRONT_DESK_EMAIL } from "../ai-core/operational-config.js";
import { decideHandoff as voiceDecision } from "../api/realtime.js";

test("breakfast FAQ does not send email", async () => {
  let sends = 0;
  const result = await performHandoff({ message: "早餐幾點？", channel: "web" }, { send: async () => sends++ });
  assert.equal(result.attempted, false);
  assert.equal(sends, 0);
});

test("ordinary front desk and payment FAQs do not send email", async () => {
  for (const message of ["櫃台電話幾號？", "櫃台幾點下班？", "可以刷卡嗎？", "嬰兒床有嗎？"]) {
    let sends = 0;
    const result = await performHandoff({ message, channel: "web" }, { send: async () => sends++ });
    assert.equal(result.attempted, false, message);
    assert.equal(sends, 0, message);
  }
});

for (const [message, category] of [
  ["可以幫我留一個車位嗎", "停車需求"],
  ["我要修改訂房日期", "訂房修改／取消"],
  ["我要客訴，房間太糟了", "客訴"],
  ["重複扣款，我要退款", "付款／退款爭議"]
]) test(`${category} triggers shared handoff`, () => assert.deepEqual(decideHandoff(message), { required: true, category }));

test("durable handoff requires contact and a separate final confirmation", async () => {
  let state = advanceHandoffAuthorization({ message: "方便請櫃檯跟我聯絡嗎", current: { state: "none" } });
  assert.equal(state.handoff.state, "collecting_required_fields");
  assert.match(state.reply, /姓名/);
  assert.equal(state.authorized, false);

  state = advanceHandoffAuthorization({ message: "OK", current: state.handoff });
  assert.equal(state.handoff.state, "collecting_required_fields");
  assert.equal(state.authorized, false);

  state = advanceHandoffAuthorization({ message: "陳先生，0927708908", current: state.handoff });
  assert.equal(state.handoff.state, "ready_for_confirmation");
  assert.equal(hasRequiredHandoffContact(state.handoff.contact), true);
  assert.match(state.reply, /確認送出/);
  assert.equal(state.authorized, false);

  state = advanceHandoffAuthorization({ message: "確認送出", current: state.handoff });
  assert.equal(state.handoff.state, "confirmed");
  assert.equal(state.authorized, true);
});

test("authorized handoff sends only from confirmed durable state with contact", async () => {
  let sends = 0;
  const request = { message: "確認送出", history: [{ role: "user", content: "我想訂 9/15 的房間，請櫃檯聯絡" }], channel: "messenger" };
  const denied = await performAuthorizedHandoff(request, { authorization: { state: "ready_for_confirmation", category: "真人服務", contact: { displayName: "陳先生", phone: "0927708908" } } }, { send: async () => sends++ });
  assert.equal(denied.delivered, false);
  assert.equal(sends, 0);

  const sent = await performAuthorizedHandoff(request, { authorization: { state: "confirmed", category: "真人服務", contact: { displayName: "陳先生", phone: "0927708908" } } }, { send: async email => {
    sends++;
    assert.match(email.text, /MESSENGER/);
    assert.match(email.text, /displayName：陳先生/);
    assert.match(email.text, /phone：0927708908/);
  } });
  assert.equal(sent.delivered, true);
  assert.equal(sends, 1);
  assert.match(sent.answer, /成功送交櫃檯信箱/);
});

test("success is confirmed only after delivery and never promises operations", async () => {
  let delivered = false;
  const parking = await performHandoff({ message: "幫我保留車位", channel: "web" }, { send: async () => { delivered = true; } });
  assert.equal(delivered, true);
  assert.match(parking.answer, /成功送交櫃檯信箱/);
  assert.match(parking.answer, /不代表已保留車位/);
  assert.doesNotMatch(parking.answer, /(?:^|[。！\n])已(?:經)?保留車位[。！]/);

  const booking = await performHandoff({ message: "幫我修改訂房", channel: "line" }, { send: async () => {} });
  assert.match(booking.answer, /尚未完成任何訂房變更/);
  const payment = await performHandoff({ message: "請幫我退款", channel: "line" }, { send: async () => {} });
  assert.match(payment.answer, /尚未完成任何款項處理/);
});

test("delivery failure is honest and includes front desk contact", async () => {
  const result = await performHandoff({ message: "可以幫我留車位嗎", channel: "web" }, { send: async () => { throw new Error("secret upstream body"); } });
  assert.equal(result.delivered, false);
  assert.match(result.answer, /沒辦法成功把留言送到櫃台/);
  assert.match(result.answer, /04-2707-8378/);
  assert.doesNotMatch(result.answer, /成功送交|已經幫您.*留言/);
});

test("LINE, Web, Messenger and Voice share service without channel Resend adapter logic", async () => {
  assert.equal(voiceDecision, decideHandoff);
  const [line, chat, meta] = await Promise.all([
    readFile(new URL("../api/line/webhook.js", import.meta.url), "utf8"),
    readFile(new URL("../api/chat.js", import.meta.url), "utf8"),
    readFile(new URL("../api/meta/adapter.js", import.meta.url), "utf8")
  ]);
  assert.match(line, /answerWithConversation/);
  assert.match(chat, /answerWithConversation/);
  assert.match(meta, /answerWithConversation/);
  assert.match(meta, /performAuthorizedHandoff/);
  assert.doesNotMatch(line, /resend|RESEND_API_KEY|api\.resend\.com/i);
  assert.doesNotMatch(meta, /RESEND_API_KEY|api\.resend\.com/i);
});

test("email payload includes safe context and excludes secrets", () => {
  const email = handoffEmail({
    channel: "line", message: "我的冷氣壞了", category: "設備故障",
    history: [{ role: "user", content: "我住 301" }],
    identity: { userId: "U-safe", replyToken: "reply-secret", channelSecret: "channel-secret", apiKey: "api-secret" },
    now: new Date("2026-08-15T12:00:00Z")
  });
  assert.match(email.text, /來源 channel：LINE/);
  assert.match(email.text, /handoff category：設備故障/);
  assert.match(email.text, /2026-08-15T12:00:00\.000Z/);
  assert.doesNotMatch(JSON.stringify(email), /U-safe|reply-secret|channel-secret|api-secret/);
});

test("FRONT_DESK_EMAIL controls operational routing with one documented legacy fallback", () => {
  assert.equal(frontDeskEmail({ FRONT_DESK_EMAIL: " ops@example.com " }), "ops@example.com");
  assert.equal(frontDeskEmail({}), LEGACY_FRONT_DESK_EMAIL);
});

test("success wording confirms mailbox delivery without implying reading or acceptance", () => {
  const email = handoffEmail({ channel: "web", message: "我要客訴", category: "客訴" });
  assert.equal(email.to[0], process.env.FRONT_DESK_EMAIL?.trim() || LEGACY_FRONT_DESK_EMAIL);
  return performHandoff({ message: "我要客訴", channel: "web" }, { send: async () => {} }).then(result => {
    assert.match(result.answer, /請等櫃檯確認/);
    assert.doesNotMatch(result.answer, /已讀|已接受|一定|保證|後續會/);
  });
});

test("sensitive payment email minimizes card-like numbers and unnecessary history", () => {
  const email = handoffEmail({
    channel: "web", category: "付款／退款爭議",
    message: "信用卡 4111111111111111 重複扣款，訂單 12345678",
    history: [{ role: "user", content: "不相關的完整私人對話" }]
  });
  assert.doesNotMatch(email.text, /4111111111111111|12345678|不相關的完整私人對話/);
  assert.match(email.text, /敏感號碼已遮蔽/);
});
