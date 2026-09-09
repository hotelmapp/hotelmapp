import test from "node:test";
import assert from "node:assert/strict";
import {
  acknowledgementFallback, isStandaloneAcknowledgement, isHandoffConfirmation,
  validateAcknowledgementReply, withAcknowledgementBoundary
} from "../ai-core/acknowledgement.js";
import { advanceHandoffAuthorization } from "../ai-core/handoff-service.js";
import { resolveHandoffDecision } from "../ai-core/handoff.js";
import { resolveAiFirstHandoffDecision } from "../ai-core/handoff-resolution-review.js";
import { resolveSemanticKnowledgeGrounding, semanticRoutePayload } from "../ai-core/semantic-router.js";
import { resolveKnowledgeGrounding } from "../ai-core/knowledge-grounding.js";
import { answerGuestMessage } from "../ai-core/guest-response.js";
import { answerWithConversation } from "../ai-core/conversation/runtime.js";
import { QUALITY_REVIEW_SCHEMA } from "../ai-core/conversation-quality-review.js";

const silentLogger = { info() {} };
const noAction = { required: false, category: null };
const falsePositive = { required: true, category: "真人服務" };
const contact = { displayName: "Test Guest", email: "guest@example.com" };
const languages = [
  { language: "zh-TW", receipt: "好", thanks: "謝謝您", request: "好的，請櫃檯打電話給我", reply: "謝謝您，祝您順心。" },
  { language: "en", receipt: "Yes", thanks: "Thank you", request: "OK, please ask reception to call me", reply: "You're very welcome!" },
  { language: "ja", receipt: "はい", thanks: "ありがとうございます", request: "はい、フロントから連絡をお願いします", reply: "こちらこそ、ありがとうございます。" },
  { language: "ko", receipt: "네", thanks: "감사합니다", request: "네, 프런트에서 연락해 주세요", reply: "네, 감사합니다." }
];
const oldOffer = [
  { role: "user", content: "請問未確認的服務？" },
  { role: "assistant", content: "也可以回覆『幫我轉接櫃檯』，我會協助您留言給櫃檯。" }
];
const visibleStaffReply = { role: "assistant", content: "之前款項已收到，這筆另外製單喔。" };

function passingQuality() {
  return JSON.stringify({
    verdict: "pass",
    checks: Object.fromEntries(QUALITY_REVIEW_SCHEMA.properties.checks.required.map(key => [key, true])),
    issues: [], rewrite_guidance: null
  });
}

test("whole-utterance receipt guards tolerate punctuation, emoji and four languages, not mixed requests", () => {
  for (const message of ["好", "好的", "好喔，謝謝您😊", "ＯＫ！", "OK, thanks!", "Yes", "はい。", "はい、ありがとうございます", "네, 감사합니다.", "嗯嗯", "收到", "需要喔"]) {
    assert.equal(isStandaloneAcknowledgement(message), true, message);
  }
  for (const { request } of languages) assert.equal(isStandaloneAcknowledgement(request), false, request);
  for (const message of ["好，早餐幾點？", "Yes, but can I park?", "はい、駐車場はどこですか", "네, 조식은 몇 시예요?", "好的 abc@example.com", "好的 0912345678", "好的" + " ".repeat(250) + "請櫃檯回電"]) {
    assert.equal(isStandaloneAcknowledgement(message), false, message);
  }
});

for (const { language, receipt, thanks, request } of languages) {
  test(`${language}: old offers or model false positives cannot start/restart contact collection`, async () => {
    for (const history of [[], oldOffer, [...oldOffer, visibleStaffReply]]) {
      for (const decision of [undefined, noAction, falsePositive]) {
        for (const state of ["none", "sent", "failed", "delivery_uncertain", "collecting_required_fields", "confirmed"]) {
          const current = { state, requestId: "old-request", category: "真人服務", contact };
          const result = advanceHandoffAuthorization({ message: receipt, history, current, decision, identity: contact });
          assert.deepEqual(result.handoff, current);
          assert.equal(result.authorized, false);
          assert.equal(result.reply, undefined);
        }
      }
    }
    const grounding = { topic: "unknown", semanticRoute: { handoff: { requested: true, category: "真人服務" } } };
    assert.equal(resolveHandoffDecision(receipt, oldOffer, grounding).required, false);
    const result = await resolveAiFirstHandoffDecision({
      message: receipt, grounding, history: oldOffer, env: { OPENAI_API_KEY: "test-key" },
      request: async () => { throw new Error("receipt_must_not_need_action_review"); }
    });
    assert.equal(result.required, false);
  });

  test(`${language}: affirmative confirms only a ready request; thanks and incomplete contact never authorize`, () => {
    const ready = { state: "ready_for_confirmation", requestId: "ready-request", category: "真人服務", contact };
    const confirmed = advanceHandoffAuthorization({ message: receipt, current: ready, decision: noAction });
    assert.equal(confirmed.authorized, true);
    assert.equal(confirmed.handoff.requestId, ready.requestId);
    assert.equal(isHandoffConfirmation(thanks), false);
    assert.equal(advanceHandoffAuthorization({ message: thanks, current: ready, decision: noAction }).authorized, false);
    assert.equal(advanceHandoffAuthorization({ message: receipt, current: { ...ready, contact: {} }, identity: contact, decision: falsePositive }).authorized, false);
    const newRequest = advanceHandoffAuthorization({ message: request, current: { state: "none" }, decision: falsePositive });
    assert.equal(newRequest.handoff.state, "collecting_required_fields");
    assert.equal(newRequest.authorized, false);
  });

  test(`${language}: AI outage returns a receipt, not old facts or an unknown-information handoff offer`, async () => {
    const stale = resolveKnowledgeGrounding("停車費多少錢？");
    const answer = await answerGuestMessage(receipt, {
      history: oldOffer, grounding: stale, env: {}, logger: silentLogger,
      request: async () => { throw new Error("offline"); }
    });
    assert.equal(answer, acknowledgementFallback(language));
    assert.equal(validateAcknowledgementReply(answer), true);
  });
}

test("the semantic router handles receipt paraphrases outside the safety recognizer", async () => {
  const message = "您剛才解釋的停車部分我都清楚了，感謝說明";
  assert.equal(isStandaloneAcknowledgement(message), false);
  let calls = 0;
  const grounding = await resolveSemanticKnowledgeGrounding(message, oldOffer, "parking", "parking_fee", {
    env: {}, logger: silentLogger,
    request: async () => {
      calls++;
      return { answer: JSON.stringify({
        routes: [{ topic: "acknowledgement", intent: "acknowledgement" }],
        current_need: "感謝說明，沒有新的需求", uses_history: true, clarification_needed: false,
        handoff: { requested: false, category: null }
      }) };
    }
  });
  assert.equal(calls, 1);
  assert.equal(grounding.topic, "acknowledgement");
  assert.deepEqual(grounding.facts, {});
  assert.equal(grounding.semanticRoute.handoff.requested, false);
  assert.match(semanticRoutePayload(message).instructions, /History can be incomplete/u);
});

test("historical prose cannot override a reviewed non-handoff decision for an ambiguous reply", () => {
  const result = advanceHandoffAuthorization({
    message: "請幫我", history: oldOffer, current: { state: "none" }, decision: noAction
  });
  assert.equal(result.handoff.state, "none");
  assert.equal(result.reply, undefined);
  assert.equal(result.authorized, false);
});

test("long repeated receipt tokens followed by a real request are not truncated or misclassified", () => {
  assert.equal(isStandaloneAcknowledgement("嗯".repeat(100) + "請櫃檯回電"), false);
  assert.equal(isStandaloneAcknowledgement("OK ".repeat(20) + "please cancel my reservation"), false);
});

test("memory outage cannot turn a receipt into an external action", async () => {
  for (const { receipt, language } of languages) {
    const result = await answerWithConversation({
      id: "line_memory_outage", channel: "line", message: receipt,
      service: { context: async () => { throw new Error("offline"); } },
      answer: (message, options) => answerGuestMessage(message, { ...options, env: {}, logger: silentLogger }),
      handoffService: async () => { assert.fail("no_memory_must_not_send"); }
    });
    assert.equal(result.durable, false);
    assert.ok(result.answer.endsWith(acknowledgementFallback(language)));
  }
});

test("a full semantic pass precedes the deny-only guard even if the model misreads a receipt", async () => {
  let calls = 0;
  const grounding = await resolveSemanticKnowledgeGrounding("好", oldOffer, "parking", "parking_fee", {
    env: {}, logger: silentLogger,
    request: async () => {
      calls++;
      return { answer: JSON.stringify({
        routes: [{ topic: "front_desk_contact", intent: "front_desk_contact" }],
        current_need: "接受歷史邀請", uses_history: true, clarification_needed: false,
        handoff: { requested: true, category: "真人服務" }
      }) };
    }
  });
  assert.equal(calls, 1);
  assert.equal(grounding.topic, "acknowledgement");
  assert.equal(grounding.semanticRoute.handoff.requested, false);
});

test("Web, LINE, Meta and Voice never send or ask for contact after the screenshot receipt", async () => {
  for (const channel of ["web", "line", "messenger", "instagram", "voice"]) {
    for (const { receipt, language } of languages) {
      for (const state of ["none", "collecting_required_fields", "sent"]) {
        const current = { state, requestId: "old-request", category: "真人服務", contact: {} };
        const calls = [];
        let saved;
        const result = await answerWithConversation({
          id: `${channel}_test`, channel, message: receipt, identity: contact,
          service: {
            context: async () => ({ turns: oldOffer, handoff: current }),
            append: async (_id, _channel, _turns, metadata) => { saved = metadata; }
          },
          route: async () => { calls.push("semantic"); return resolveKnowledgeGrounding("停車費多少？"); },
          reviewHandoff: async () => { calls.push("review"); return falsePositive; },
          answer: async (message, options) => {
            calls.push("answer");
            assert.equal(options.grounding.topic, "acknowledgement");
            return answerGuestMessage(message, { ...options, env: {}, logger: silentLogger });
          },
          claimDelivery: async () => { assert.fail("receipt_must_not_claim_delivery"); },
          handoffService: async () => { assert.fail("receipt_must_not_send"); }
        });
        assert.deepEqual(calls, ["semantic", "review", "answer"]);
        assert.deepEqual(saved.handoff, current);
        assert.equal(result.answer, acknowledgementFallback(language));
      }
    }
  }
});

test("ready requests still send exactly once across channels and four-language affirmatives", async () => {
  for (const channel of ["web", "line", "messenger", "instagram", "voice"]) {
    for (const { receipt, thanks, language } of languages) {
      let current = { state: "ready_for_confirmation", requestId: "ready-request", category: "真人服務", contact };
      let claims = 0;
      let sends = 0;
      const options = {
        id: `${channel}_ready`, channel,
        service: {
          context: async () => ({ turns: oldOffer, handoff: current }),
          append: async (_id, _channel, _turns, metadata) => { current = metadata.handoff; }
        },
        route: async message => withAcknowledgementBoundary(message),
        reviewHandoff: async () => falsePositive,
        answer: async () => acknowledgementFallback(language),
        claimDelivery: async (_service, _id, handoff) => {
          claims++;
          assert.equal(handoff.requestId, "ready-request");
          return claims === 1;
        },
        handoffService: async (_request, { authorization, deliveryClaimed }) => {
          sends++;
          assert.equal(authorization.state, "confirmed");
          assert.deepEqual(authorization.contact, contact);
          assert.equal(deliveryClaimed, true);
          return { attempted: true, delivered: true, answer: "test-delivered" };
        }
      };
      const confirmed = await answerWithConversation({ ...options, message: receipt });
      assert.equal(confirmed.handoff.state, "sent");
      assert.equal(confirmed.answer, "test-delivered");
      for (const message of [receipt, thanks]) {
        const repeated = await answerWithConversation({ ...options, message });
        assert.equal(repeated.handoff.state, "sent");
        assert.equal(repeated.answer, acknowledgementFallback(language));
      }
      assert.equal(claims, 1);
      assert.equal(sends, 1);
    }
  }
});

test("receipts use the same AI composer and independent reviewer in every language", async () => {
  for (const { language, receipt, reply } of languages) {
    const calls = [];
    const answers = [reply, passingQuality()];
    const result = await answerGuestMessage(receipt, {
      history: oldOffer, grounding: withAcknowledgementBoundary(receipt),
      env: { OPENAI_API_KEY: "test-key" }, logger: silentLogger,
      request: async ({ payload }) => { calls.push(payload); return { answer: answers.shift() }; }
    });
    assert.equal(result, reply);
    assert.equal(calls.length, 2);
    const input = JSON.parse(calls[0].input);
    assert.equal(input.verified_decision.intent, "acknowledgement");
    assert.equal(input.verified_decision.action, "none");
    assert.deepEqual(input.selected_grounded_facts, []);
    assert.match(calls[0].instructions, new RegExp(`Answer in ${language}`));
    assert.equal(calls[1].text.format.name, "conversation_quality_review");
  }
});

test("unsafe generated receipt text is rejected and safely falls back without contact collection", async () => {
  const badReplies = [
    "好的，請提供您的姓名和電話，我幫您轉接櫃檯。",
    "Please provide your name and email so I can forward your request.",
    "フロントへ送信しますので、お名前を教えてください。",
    "프런트에 전달할 수 있도록 성함과 전화번호를 알려 주세요."
  ];
  for (let i = 0; i < languages.length; i++) {
    const { receipt, language } = languages[i];
    let attempts = 0;
    const answer = await answerGuestMessage(receipt, {
      history: oldOffer, grounding: withAcknowledgementBoundary(receipt),
      env: { OPENAI_API_KEY: "test-key" }, logger: silentLogger,
      request: async () => { attempts++; return { answer: badReplies[i] }; }
    });
    assert.equal(attempts, 2);
    assert.equal(answer, acknowledgementFallback(language));
  }
});
