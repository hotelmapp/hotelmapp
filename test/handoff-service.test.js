import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decideHandoff, resolveHandoffDecision } from "../ai-core/handoff.js";
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

test("ordinary FAQs and non-reservable parking requests do not send email", async () => {
  for (const message of ["櫃台電話幾號？", "櫃台幾點下班？", "可以刷卡嗎？", "嬰兒床有嗎？", "可以幫我留一個車位嗎"]) {
    let sends = 0;
    const result = await performHandoff({ message, channel: "web" }, { send: async () => sends++ });
    assert.equal(result.attempted, false, message);
    assert.equal(sends, 0, message);
  }
});

for (const [message, category] of [
  ["我要修改訂房日期", "訂房修改／取消"],
  ["我要客訴，房間太糟了", "客訴"],
  ["重複扣款，我要退款", "付款／退款爭議"],
  ["我在確認可否幫我聯絡櫃檯呢？", "真人服務"],
  ["可否幫我接洽櫃檯呢？", "真人服務"],
  ["麻煩通知飯店人員聯絡我", "真人服務"]
]) test(`${category} triggers shared handoff`, () => assert.deepEqual(decideHandoff(message), { required: true, category }));

test("front desk information questions are not mistaken for a handoff request", () => {
  for (const message of ["請問櫃檯電話幾號？", "櫃檯幾點下班？"]) {
    assert.deepEqual(decideHandoff(message), { required: false, category: null }, message);
  }
});

test("validated whole-sentence semantics outrank keyword fallback", () => {
  assert.equal(decideHandoff("我只是想問退款規定，不需要聯絡櫃檯").required, true);
  const infoOnly = resolveHandoffDecision("我只是想問退款規定，不需要聯絡櫃檯", [], {
    handoff: { requested: false, category: null }
  });
  assert.deepEqual(infoOnly, { required: false, category: null, source: "semantic" });

  const naturalRequest = resolveHandoffDecision("能請飯店的人處理後回我嗎？", [], {
    handoff: { requested: true, category: "真人服務" }
  });
  assert.deepEqual(naturalRequest, { required: true, category: "真人服務", source: "semantic" });
});

test("the exact LINE conversation reaches confirmation and parses phone-before-name", () => {
  let state = advanceHandoffAuthorization({ message: "我在確認可否幫我聯絡櫃檯呢？", current: { state: "none" } });
  assert.equal(state.handoff.state, "collecting_required_fields");

  state = advanceHandoffAuthorization({ message: "需要喔", current: state.handoff });
  assert.equal(state.handoff.state, "collecting_required_fields");
  const requestId = state.handoff.requestId;

  state = advanceHandoffAuthorization({ message: "我需要訂房，我的電話是0927708908陳先生。", current: state.handoff });
  assert.equal(state.handoff.state, "ready_for_confirmation");
  assert.deepEqual(state.handoff.contact, { displayName: "陳先生", phone: "0927708908" });
  assert.equal(state.handoff.requestId, requestId);
  assert.match(state.reply, /陳先生.*0927\*\*\*908.*確認送出/u);

  state = advanceHandoffAuthorization({ message: "確認送出", current: state.handoff });
  assert.equal(state.handoff.state, "confirmed");
  assert.equal(state.handoff.requestId, requestId);
  assert.equal(state.authorized, true);
});

test("the latest LINE screenshot phrasing keeps handoff through booking, date, name and phone", () => {
  let state = advanceHandoffAuthorization({ message: "可否幫我接洽櫃檯呢？", current: { state: "none" } });
  assert.equal(state.handoff.state, "collecting_required_fields");

  state = advanceHandoffAuthorization({ message: "好的", current: state.handoff });
  assert.equal(state.handoff.state, "collecting_required_fields");

  state = advanceHandoffAuthorization({ message: "我想訂9月30陳明暉，0927708908。", current: state.handoff });
  assert.equal(state.handoff.state, "ready_for_confirmation");
  assert.deepEqual(state.handoff.contact, { displayName: "陳明暉", phone: "0927708908" });
  assert.match(state.reply, /確認送出.*好的.*正式寄給櫃檯/u);

  state = advanceHandoffAuthorization({ message: "好的", current: state.handoff });
  assert.equal(state.handoff.state, "confirmed");
  assert.equal(state.authorized, true);
});

test("a natural model offer followed by 好的 cannot start a new handoff", () => {
  const state = advanceHandoffAuthorization({
    message: "好的",
    history: [
      { role: "user", content: "可否幫我接洽櫃檯呢？" },
      { role: "assistant", content: "您可以留下訂房需求與聯絡方式，我會幫您整理留言給櫃檯，方便他們回覆您。您看這樣可以嗎？" }
    ],
    current: { state: "none" }
  });
  assert.equal(state.handoff.state, "none");
  assert.equal(state.reply, undefined);
});

test("partial contact details do not get discarded as a new booking question", () => {
  const state = advanceHandoffAuthorization({
    message: "我要訂房，電話是0927708908",
    current: { state: "collecting_required_fields", category: "真人服務", contact: {} }
  });
  assert.equal(state.handoff.state, "collecting_required_fields");
  assert.deepEqual(state.handoff.contact, { phone: "0927708908" });
  assert.match(state.reply, /姓名/u);
});

test("a receipt after an unknown-information offer does not imply handoff consent", () => {
  const state = advanceHandoffAuthorization({
    message: "好的",
    history: [
      { role: "user", content: "小朋友早餐多少錢？" },
      { role: "assistant", content: "不好意思，這個問題我目前沒有確認到正確資料。若您急著確認，可以撥打櫃檯電話 04-2707-8378；也可以回覆「幫我轉接櫃檯」，我會協助您留言給櫃檯。" }
    ],
    current: { state: "none" }
  });
  assert.equal(state.handoff.state, "none");
  assert.equal(state.reply, undefined);
});

test("the offered transfer phrase enters contact collection without sending", () => {
  const state = advanceHandoffAuthorization({
    message: "幫我轉接櫃檯",
    current: { state: "none" }
  });
  assert.equal(state.handoff.state, "collecting_required_fields");
  assert.equal(state.handoff.category, "真人服務");
  assert.equal(state.authorized, false);
  assert.match(state.reply, /姓名.*電話或 Email/u);
});

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

test("pending handoff can be cancelled while collecting contact details", () => {
  const result = advanceHandoffAuthorization({
    message: "不用了",
    current: { state: "collecting_required_fields", category: "真人服務", contact: {} }
  });
  assert.deepEqual(result.handoff, { state: "none" });
  assert.equal(result.authorized, false);
  assert.match(result.reply, /取消.*不會送出/u);
});

test("a new FAQ or booking question exits a stale pending handoff", () => {
  for (const state of ["collecting_required_fields", "ready_for_confirmation"]) {
    for (const message of ["可以幫我保留停車位嗎？", "請問 Wi-Fi 密碼是多少？", "我要訂房"]) {
      const result = advanceHandoffAuthorization({
        message,
        current: { state, category: "真人服務", contact: state === "ready_for_confirmation" ? { displayName: "陳先生", phone: "0927708908" } : {} }
      });
      assert.deepEqual(result.handoff, { state: "none" });
      assert.equal(result.authorized, false);
      assert.equal(result.reply, undefined);
    }
  }
});

test("a new action request does not bypass pending handoff authorization", () => {
  const result = advanceHandoffAuthorization({
    message: "房間 Wi-Fi 壞了",
    current: { state: "collecting_required_fields", category: "設備故障", contact: {} }
  });
  assert.equal(result.handoff.state, "collecting_required_fields");
  assert.equal(result.authorized, false);
  assert.match(result.reply, /姓名/u);
});

test("authorized handoff sends only from confirmed durable state with contact", async () => {
  let sends = 0;
  const request = { message: "確認送出", history: [{ role: "user", content: "我想訂 9/15 的房間，請櫃檯聯絡" }], channel: "messenger" };
  const denied = await performAuthorizedHandoff(request, { authorization: { state: "ready_for_confirmation", category: "真人服務", contact: { displayName: "陳先生", phone: "0927708908" } } }, { send: async () => sends++ });
  assert.equal(denied.delivered, false);
  assert.equal(sends, 0);

  const sent = await performAuthorizedHandoff(request, { authorization: { state: "confirmed", requestId: "request-authorized", category: "真人服務", contact: { displayName: "陳先生", phone: "0927708908" } }, deliveryClaimed: true }, { send: async email => {
    sends++;
    assert.match(email.text, /MESSENGER/);
    assert.match(email.text, /旅客姓名：陳先生/);
    assert.match(email.text, /聯絡電話：0927708908/);
  } });
  assert.equal(sent.delivered, true);
  assert.equal(sends, 1);
  assert.match(sent.answer, /成功送交櫃檯信箱/);
});

test("confirmed prose still cannot send without the runtime idempotency claim", async () => {
  let sends = 0;
  const result = await performAuthorizedHandoff(
    { message: "確認送出", channel: "line" },
    { authorization: { state: "confirmed", requestId: "request-no-claim", category: "真人服務", contact: { displayName: "陳先生", phone: "0927708908" } } },
    { send: async () => sends++ }
  );
  assert.equal(result.delivered, false);
  assert.equal(sends, 0);
  assert.match(result.answer, /一次性送出權/u);
});

test("success is confirmed only after delivery and never promises operations", async () => {
  const booking = await performHandoff({ message: "幫我修改訂房", channel: "line" }, { send: async () => {} });
  assert.match(booking.answer, /尚未完成任何訂房變更/);
  const payment = await performHandoff({ message: "請幫我退款", channel: "line" }, { send: async () => {} });
  assert.match(payment.answer, /尚未完成任何款項處理/);
});

test("delivery failure is honest and includes front desk contact", async () => {
  const result = await performHandoff({ message: "我要修改訂房日期", channel: "web" }, { send: async () => { throw new Error("secret upstream body"); } });
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
  assert.match(email.text, /旅客透過 LINE 請求櫃檯協助/);
  assert.match(email.text, /需求類型：設備故障/);
  assert.match(email.text, /留言時間：2026\/08\/15 20:00（台灣時間）/);
  assert.doesNotMatch(email.text, /來源 channel|handoff category|displayName：|phone：/u);
  assert.doesNotMatch(JSON.stringify(email), /U-safe|reply-secret|channel-secret|api-secret/);
});

test("front desk email is readable and keeps the original need instead of confirmation chatter", () => {
  const email = handoffEmail({
    channel: "line", message: "確認送出", category: "真人服務",
    history: [
      { role: "user", content: "兒童早餐多少錢？" },
      { role: "assistant", content: "需要我幫您轉請櫃檯回覆嗎？" },
      { role: "user", content: "需要喔" },
      { role: "user", content: "0927708908陳先生" }
    ],
    identity: { displayName: "陳先生", phone: "0927708908" },
    now: new Date("2026-08-15T12:00:00Z")
  });
  assert.match(email.text, /^希堤微旅櫃檯您好：/u);
  assert.match(email.text, /客人需求：.*兒童早餐多少錢/u);
  assert.doesNotMatch(email.text, /客人需求：.*需要喔/u);
  assert.match(email.text, /旅客姓名：陳先生[\s\S]*聯絡電話：0927708908/u);
  assert.match(email.text, /最近對話：[\s\S]*兒童早餐多少錢/u);
  assert.doesNotMatch(email.text, /[{}]/u);
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
