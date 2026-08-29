import test from "node:test";
import assert from "node:assert/strict";
import {
  QUALITY_REVIEW_FEATURE_FLAG, QUALITY_REVIEW_SCHEMA, parseQualityReview,
  qualityReviewEnabled, qualityReviewPayload, validateQualityReview
} from "../ai-core/conversation-quality-review.js";
import { groundingFactEntries, orchestrateHospitalityTurn } from "../ai-core/ai-orchestrator.js";
import { resolveKnowledgeGrounding } from "../ai-core/knowledge-grounding.js";

const silentLogger = { info() {} };

function checks(value = true) {
  return {
    answers_current_need: value,
    uses_context: value,
    warm_natural: value,
    not_canned: value,
    not_repetitive: value,
    tone_appropriate: value,
    language_consistent: value,
    appropriately_concise: value
  };
}

function passingReview() {
  return { verdict: "pass", checks: checks(true), issues: [], rewrite_guidance: null };
}

function semanticGrounding(message) {
  const grounding = resolveKnowledgeGrounding(message);
  return {
    ...grounding,
    semanticRoute: {
      currentNeed: message,
      usedHistory: false,
      clarificationNeeded: false,
      handoff: { requested: false, category: null },
      routerVersion: "test"
    }
  };
}

test("quality review is a shared production default with an independent emergency switch", () => {
  assert.equal(QUALITY_REVIEW_FEATURE_FLAG, "AI_QUALITY_REVIEW_ENABLED");
  assert.equal(qualityReviewEnabled({ OPENAI_API_KEY: "server-secret" }), true);
  assert.equal(qualityReviewEnabled({}), false);
  assert.equal(qualityReviewEnabled({ OPENAI_API_KEY: "server-secret", AI_QUALITY_REVIEW_ENABLED: "false" }), false);
  assert.equal(qualityReviewEnabled({ AI_QUALITY_REVIEW_ENABLED: "true" }), true);
});

test("quality verdicts are strict and cannot pass with a failed conversational check", () => {
  const pass = passingReview();
  assert.equal(validateQualityReview(pass), true);
  assert.equal(parseQualityReview(JSON.stringify(pass)).verdict, "pass");

  const coldChecks = checks(true);
  coldChecks.warm_natural = false;
  const rewrite = {
    verdict: "rewrite",
    checks: coldChecks,
    issues: ["cold_or_formal"],
    rewrite_guidance: "先承接客人的疑問，再用自然口吻說明限制。"
  };
  assert.equal(validateQualityReview(rewrite), true);
  assert.equal(validateQualityReview({ ...pass, checks: coldChecks }), false);
  assert.equal(validateQualityReview({ ...rewrite, surprise: true }), false);
  assert.throws(() => parseQualityReview("not-json"), /invalid_quality_review_json/u);
  assert.equal(QUALITY_REVIEW_SCHEMA.additionalProperties, false);
});

test("one topic-neutral reviewer evaluates parking, breakfast, booking, subsidy, unknown, and complaints", () => {
  const scenarios = [
    ["停車需要費用嗎？", "每間客房可以免費停 1 台車喔。"],
    ["早餐幾點？", "早餐供應時間是 08:00–10:00 喔。"],
    ["9月30日還有房嗎？", "我幫您附上已帶入日期的官方訂房頁面。"],
    ["國旅補助怎麼用？", "我先幫您說明目前公開的活動規則。"],
    ["房內有熨斗嗎？", "不好意思，這項資訊目前還沒有確認到。"],
    ["房間很吵，我很不滿。", "很抱歉讓您遇到這樣的情況。"]
  ];
  for (const [message, proposedAnswer] of scenarios) {
    const grounding = resolveKnowledgeGrounding(message);
    const selectedFacts = groundingFactEntries(grounding);
    const payload = qualityReviewPayload({
      message, grounding, selectedFacts, proposedAnswer, channel: "line", env: {}
    });
    const input = JSON.parse(payload.input);
    assert.equal(input.current_user_message, message);
    assert.equal(input.proposed_answer, proposedAnswer);
    assert.deepEqual(input.selected_grounded_facts, selectedFacts);
    assert.equal(payload.text.format.name, "conversation_quality_review");
    assert.match(payload.instructions, /independent conversation-quality reviewer/u);
    assert.match(payload.instructions, /do not require a greeting, emoji/u);
  }
});

test("the independent reviewer rejects a canned but factually valid answer and triggers one rewrite", async () => {
  const message = "停車需要費用嗎？";
  const grounding = semanticGrounding(message);
  const first = "每間客房可以免費停 1 台車；如有額外車輛，停車費是 NT$200 喔。";
  const improved = "如果您是開車過來，每間客房可以免費停 1 台車；額外車輛的停車費是 NT$200 喔。";
  const calls = [];
  const answers = [
    first,
    JSON.stringify({
      verdict: "rewrite",
      checks: { ...checks(true), warm_natural: false, not_canned: false },
      issues: ["cold_or_formal", "generic_or_canned"],
      rewrite_guidance: "直接回答費用，同時用一句貼近開車旅客的自然承接。"
    }),
    improved,
    JSON.stringify(passingReview())
  ];

  const result = await orchestrateHospitalityTurn({
    message, grounding, env: { OPENAI_API_KEY: "server-secret" }, logger: silentLogger,
    request: async ({ payload }) => {
      calls.push(payload);
      return { answer: answers.shift() };
    }
  });

  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map(payload => payload.text?.format?.name || "prose"), ["prose", "conversation_quality_review", "prose", "conversation_quality_review"]);
  assert.match(calls[2].instructions, /Independent reviewer guidance/u);
  assert.equal(JSON.parse(calls[1].input).proposed_answer, first);
  assert.equal(result.answer, improved);
  assert.equal(result.qualityReview.verdict, "pass");
});

test("reviewer downtime cannot interrupt a reply that already passed deterministic safety checks", async () => {
  const message = "停車需要費用嗎？";
  const events = [];
  let calls = 0;
  const answer = "每間客房可以免費停 1 台車；如有額外車輛，停車費是 NT$200 喔。";
  const result = await orchestrateHospitalityTurn({
    message,
    grounding: semanticGrounding(message),
    env: { OPENAI_API_KEY: "server-secret" },
    logger: { info(_label, fields) { events.push(fields.event); } },
    request: async () => {
      calls += 1;
      if (calls === 1) return { answer };
      throw new Error("quality_timeout");
    }
  });

  assert.equal(result.answer, answer);
  assert.equal(result.qualityReview, null);
  assert.equal(calls, 2);
  assert.ok(events.includes("quality_review_unavailable"));
});
