import test from "node:test";
import assert from "node:assert/strict";
import { answerWithConversation } from "../ai-core/conversation/runtime.js";
import {
  HANDOFF_RESOLUTION_REVIEW_FEATURE_FLAG,
  HANDOFF_RESOLUTION_REVIEW_SCHEMA,
  handoffResolutionReviewEnabled,
  handoffResolutionReviewPayload,
  parseHandoffResolutionReview,
  resolveAiFirstHandoffDecision,
  validateHandoffResolutionReview
} from "../ai-core/handoff-resolution-review.js";
import { resolveKnowledgeGrounding } from "../ai-core/knowledge-grounding.js";

const silentLogger = { info() {} };

function withSemanticHandoff(message, requested = true, category = "真人服務") {
  return {
    ...resolveKnowledgeGrounding(message),
    semanticRoute: {
      currentNeed: message,
      usedHistory: false,
      clarificationNeeded: false,
      handoff: requested ? { requested: true, category } : { requested: false, category: null },
      routerVersion: "test"
    }
  };
}

const answerReview = Object.freeze({
  resolution: "answer",
  category: null,
  reason: "answer_known_information"
});

test("semantic action review is enabled with the AI brain and has a strict contract", () => {
  assert.equal(HANDOFF_RESOLUTION_REVIEW_FEATURE_FLAG, "AI_HANDOFF_REVIEW_ENABLED");
  assert.equal(handoffResolutionReviewEnabled({ OPENAI_API_KEY: "server-secret" }), true);
  assert.equal(handoffResolutionReviewEnabled({}), false);
  assert.equal(handoffResolutionReviewEnabled({ OPENAI_API_KEY: "server-secret", AI_HANDOFF_REVIEW_ENABLED: "false" }), false);
  assert.equal(HANDOFF_RESOLUTION_REVIEW_SCHEMA.additionalProperties, false);
  assert.equal(validateHandoffResolutionReview(answerReview), true);
  assert.equal(validateHandoffResolutionReview({ ...answerReview, category: "真人服務" }), false);
  assert.equal(validateHandoffResolutionReview({ resolution: "handoff", category: "真人服務", reason: "explicit_staff_contact" }), true);
  assert.equal(validateHandoffResolutionReview({ resolution: "handoff", category: null, reason: "explicit_staff_contact" }), false);
  assert.deepEqual(parseHandoffResolutionReview(JSON.stringify(answerReview)), answerReview);
});

test("one topic-neutral AI review receives full semantics and authoritative facts", () => {
  const cases = [
    "可以幫我確認早餐幾點嗎？",
    "麻煩幫我看看國旅補助規則",
    "能幫我查9月30日怎麼訂房嗎？",
    "停車費可以幫我說明一下嗎？",
    "房間 Wi-Fi 壞了，請飯店處理",
    "我想取消原本的訂房",
    "這次住宿很糟，我要客訴"
  ];
  for (const message of cases) {
    const grounding = withSemanticHandoff(message);
    const payload = handoffResolutionReviewPayload({ message, grounding, channel: "line", env: {} });
    const input = JSON.parse(payload.input);
    assert.equal(input.current_user_message, message);
    assert.equal(input.grounded_topic, grounding.topic || "unknown");
    assert.deepEqual(input.authoritative_facts, grounding.facts);
    assert.match(payload.instructions, /complete meaning.*subject.*object.*negation.*conditions.*requested actor/isu);
    assert.match(payload.instructions, /applies across every topic/iu);
    assert.match(payload.instructions, /do not count keywords/iu);
  }
});

test("AI review corrects cross-topic polite-word false positives to answers", async () => {
  const messages = [
    "可以幫我確認早餐幾點嗎？",
    "麻煩幫我看看國旅補助規則",
    "能幫我查9月30日怎麼訂房嗎？",
    "停車費可以幫我說明一下嗎？",
    "門口停車位可以幫我保留一個嗎？"
  ];
  for (const message of messages) {
    const result = await resolveAiFirstHandoffDecision({
      message,
      grounding: withSemanticHandoff(message),
      env: { AI_HANDOFF_REVIEW_ENABLED: "true" },
      logger: silentLogger,
      request: async () => ({ answer: JSON.stringify(answerReview) })
    });
    assert.deepEqual(result, { required: false, category: null, source: "ai_resolution_review" }, message);
  }
});

test("action review uses a bounded timeout and passes it to the AI transport", async () => {
  let receivedTimeout;
  await resolveAiFirstHandoffDecision({
    message: "可以幫我確認早餐幾點嗎？",
    grounding: withSemanticHandoff("可以幫我確認早餐幾點嗎？"),
    env: { AI_HANDOFF_REVIEW_ENABLED: "true", HANDOFF_REVIEW_TIMEOUT_MS: "9000" },
    logger: silentLogger,
    request: async ({ timeoutMs }) => {
      receivedTimeout = timeoutMs;
      return { answer: JSON.stringify(answerReview) };
    }
  });
  assert.equal(receivedTimeout, 9000);
});

test("AI review preserves real staff operations without relying on an exact phrase", async () => {
  const cases = [
    ["希望飯店的人處理後再回覆我", "真人服務", "explicit_staff_contact"],
    ["我要更改原本的入住日期", "訂房修改／取消", "staff_operation_required"],
    ["重複扣款，請協助處理", "付款／退款爭議", "staff_operation_required"],
    ["這次住宿很糟，我要客訴", "客訴", "service_problem_or_complaint"]
  ];
  for (const [message, category, reason] of cases) {
    const result = await resolveAiFirstHandoffDecision({
      message,
      grounding: withSemanticHandoff(message, true, category),
      env: { AI_HANDOFF_REVIEW_ENABLED: "true" },
      logger: silentLogger,
      request: async () => ({ answer: JSON.stringify({ resolution: "handoff", category, reason }) })
    });
    assert.deepEqual(result, { required: true, category, source: "ai_resolution_review" }, message);
  }
});

test("review outage fails safely to known answers and keeps explicit emergency actions", async () => {
  const known = await resolveAiFirstHandoffDecision({
    message: "可以幫我確認早餐幾點嗎？",
    grounding: withSemanticHandoff("可以幫我確認早餐幾點嗎？"),
    env: { AI_HANDOFF_REVIEW_ENABLED: "true" },
    logger: silentLogger,
    request: async () => { throw new Error("connection_failed"); }
  });
  assert.deepEqual(known, { required: false, category: null, source: "safe_fallback" });

  const explicit = await resolveAiFirstHandoffDecision({
    message: "請幫我轉接櫃檯",
    grounding: withSemanticHandoff("請幫我轉接櫃檯"),
    env: { AI_HANDOFF_REVIEW_ENABLED: "true" },
    logger: silentLogger,
    request: async () => { throw new Error("connection_failed"); }
  });
  assert.deepEqual(explicit, { required: true, category: "真人服務", source: "semantic" });
});

test("conversation runtime waits for semantic action review before collecting contact details", async () => {
  const message = "可以幫我確認早餐幾點嗎？";
  const grounding = withSemanticHandoff(message);
  let reviewCalls = 0;
  const result = await answerWithConversation({
    id: "semantic_action_runtime",
    channel: "line",
    message,
    service: {
      context: async () => ({ turns: [], topic: null, intent: null, handoff: { state: "none" } }),
      append: async () => {}
    },
    route: async () => grounding,
    reviewHandoff: async options => {
      reviewCalls += 1;
      assert.equal(options.grounding, grounding);
      return { required: false, category: null, source: "ai_resolution_review" };
    },
    answer: async () => "早餐供應時間是 08:00–10:00 喔。"
  });
  assert.equal(reviewCalls, 1);
  assert.equal(result.answer, "早餐供應時間是 08:00–10:00 喔。");
  assert.equal(result.handoff.state, "none");
  assert.doesNotMatch(result.answer, /姓名|電話或 Email/u);
});
