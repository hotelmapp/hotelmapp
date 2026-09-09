import test from "node:test";
import assert from "node:assert/strict";
import { AI_LABEL, aiMessage } from "../ai-core/message-identity.js";
import { processLineEvent } from "../api/line/webhook.js";
import { processMetaEvent } from "../api/meta/adapter.js";
import { fixture } from "../test-support/front-desk-fixture.js";

test("AI identity is applied once without changing multilingual facts, dates or links", () => {
  const content = "您好😊 每房 1 台免費，第 2 台 NT$200。\nHello! チェックインは15:00です。감사합니다.\nhttps://example.test/?checkInDate=2026-09-30&checkOutDate=2026-10-01";
  assert.equal(aiMessage(content), AI_LABEL + "\n" + content);
  assert.equal(aiMessage(aiMessage(content)), AI_LABEL + "\n" + content);
  assert.equal(aiMessage("【真人櫃檯回覆】\n" + content), AI_LABEL + "\n" + content);
  for (const empty of [null, "", " ", "【真人櫃檯回覆】", AI_LABEL]) assert.throws(() => aiMessage(empty), /invalid_ai_message/);
});

for (const channel of ["line", "messenger"]) {
  test(`${channel} labels generated replies with and without workbench enabled, preserving original model history`, async () => {
    for (const enabled of [false, true]) {
      const f = fixture(channel), outgoing = [];
      const answer = "您好😊 每房可免費停 1 台車。";
      const options = {
        conversationService: f.conversations, hmacSecret: f.env.CONVERSATION_HMAC_SECRET,
        accessToken: "test-only", env: { ...f.env, FRONT_DESK_ENABLED: String(enabled) },
        desk: enabled ? f.desk : null, answer: async () => answer, logger: {},
        fetchImpl: async (_url, options) => { outgoing.push(JSON.parse(options.body).messages[0].text); return { ok: true }; },
        send: async ({ text }) => outgoing.push(text)
      };
      const run = n => channel === "line"
        ? processLineEvent({ webhookEventId: `event-${n}`, type: "message", replyToken: "test-reply", timestamp: f.clock.now, source: { type: "user", userId: f.route.recipientId }, message: { type: "text", text: "停車需要費用嗎？" } }, options)
        : processMetaEvent({ pageId: f.route.pageId, event: { timestamp: f.clock.now, sender: { id: f.route.recipientId }, message: { mid: `event-${n}`, text: "停車需要費用嗎？" } } }, options);
      assert.equal((await run(1)).outcome, "replied");
      assert.deepEqual(outgoing, [AI_LABEL + "\n" + answer]);
      assert.equal((await f.conversations.context(f.id)).turns.at(-1).content, answer);
      if (enabled) {
        await f.desk.takeover(f.id);
        assert.equal((await run(2)).outcome, "human");
        assert.equal(outgoing.length, 1, "pausing AI must not send even an identity-only message");
        await f.close();
        assert.equal((await run(3)).outcome, "replied");
        assert.equal(outgoing[1], AI_LABEL + "\n" + answer);
      }
    }
  });
}

test("stateless LINE fallback also labels its AI response", async () => {
  let outgoing;
  await processLineEvent({ type: "message", replyToken: "test-only", message: { type: "text", text: "請問？" } }, {
    accessToken: "test", env: {}, answer: async () => "不好意思，請櫃檯為您確認。",
    fetchImpl: async (_url, options) => { outgoing = JSON.parse(options.body).messages[0].text; return { ok: true }; }
  });
  assert.equal(outgoing, AI_LABEL + "\n不好意思，請櫃檯為您確認。");
});
