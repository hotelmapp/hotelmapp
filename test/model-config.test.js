import test from "node:test";
import assert from "node:assert/strict";
import { orchestrateHospitalityTurn } from "../ai-core/ai-orchestrator.js";
import { responsesPayload } from "../ai-core/guest-response.js";
import {
  configuredReasoning, configuredTextModel, DEFAULT_ROUTING_REASONING_EFFORT,
  DEFAULT_TEXT_MODEL, DEFAULT_TEXT_REASONING_EFFORT, supportsReasoning
} from "../ai-core/model-config.js";
import { resolveKnowledgeGrounding } from "../ai-core/knowledge-grounding.js";
import { semanticRoutePayload } from "../ai-core/semantic-router.js";
import { qualityReviewPayload } from "../ai-core/conversation-quality-review.js";
import { handoffResolutionReviewPayload } from "../ai-core/handoff-resolution-review.js";

const silentLogger = { info() {} };

function parkingDecision() {
  return {
    intent: "parking_availability",
    user_need: "確認是否有停車位",
    facts_to_use: ["parking.hotelSpaces"],
    action: "none",
    clarification_needed: false,
    next_step: null,
    response_strategy: "answer"
  };
}

test("all text paths share GPT-5.6 Terra defaults with role-appropriate reasoning", async () => {
  assert.equal(DEFAULT_TEXT_MODEL, "gpt-5.6-terra");
  assert.equal(DEFAULT_TEXT_REASONING_EFFORT, "medium");
  assert.equal(DEFAULT_ROUTING_REASONING_EFFORT, "low");

  const response = responsesPayload("飯店地址在哪裡？", [], "web", undefined, undefined, {});
  const router = semanticRoutePayload("飯店地址在哪裡？", [], {});
  const quality = qualityReviewPayload({ message: "飯店地址在哪裡？", proposedAnswer: "飯店地址已提供喔。", env: {} });
  const actionReview = handoffResolutionReviewPayload({
    message: "可以幫我確認飯店地址嗎？",
    grounding: resolveKnowledgeGrounding("飯店地址在哪裡？"),
    env: {}
  });
  assert.deepEqual({ model: response.model, reasoning: response.reasoning }, {
    model: "gpt-5.6-terra", reasoning: { effort: "medium" }
  });
  assert.deepEqual({ model: router.model, reasoning: router.reasoning }, {
    model: "gpt-5.6-terra", reasoning: { effort: "low" }
  });
  assert.deepEqual({ model: quality.model, reasoning: quality.reasoning }, {
    model: "gpt-5.6-terra", reasoning: { effort: "low" }
  });
  assert.deepEqual({ model: actionReview.model, reasoning: actionReview.reasoning }, {
    model: "gpt-5.6-terra", reasoning: { effort: "medium" }
  });

  const calls = [];
  await orchestrateHospitalityTurn({
    message: "有停車位嗎？",
    grounding: resolveKnowledgeGrounding("有停車位嗎？"),
    env: {},
    logger: silentLogger,
    request: async ({ payload }) => {
      calls.push(payload);
      return calls.length === 1 ? { answer: JSON.stringify(parkingDecision()) } : { answer: "飯店門口有 3 個停車格喔。" };
    }
  });
  assert.deepEqual(calls.map(({ model, reasoning }) => ({ model, reasoning })), [
    { model: "gpt-5.6-terra", reasoning: { effort: "low" } },
    { model: "gpt-5.6-terra", reasoning: { effort: "medium" } }
  ]);
});

test("component overrides remain supported and reasoning is omitted for legacy models", () => {
  const legacy = { OPENAI_MODEL: "gpt-4.1-mini", OPENAI_REASONING_EFFORT: "high" };
  const response = responsesPayload("飯店地址在哪裡？", [], "web", undefined, undefined, legacy);
  assert.equal(response.model, "gpt-4.1-mini");
  assert.equal(response.reasoning, undefined);
  assert.equal(configuredTextModel({ OPENAI_MODEL: "shared", OPENAI_ROUTER_MODEL: "router" }, "OPENAI_ROUTER_MODEL"), "router");
  assert.equal(qualityReviewPayload({ message: "hi", proposedAnswer: "Hello.", env: { OPENAI_MODEL: "shared", OPENAI_QUALITY_MODEL: "quality" } }).model, "quality");
  assert.equal(handoffResolutionReviewPayload({ message: "hi", env: { OPENAI_MODEL: "shared", OPENAI_HANDOFF_REVIEW_MODEL: "action-review" } }).model, "action-review");
  assert.deepEqual(configuredReasoning("gpt-5.6-terra", { OPENAI_REASONING_EFFORT: "high" }), { reasoning: { effort: "high" } });
  assert.equal(supportsReasoning("gpt-4.1-mini"), false);
});

test("invalid reasoning configuration falls back to a supported safe default", () => {
  assert.deepEqual(configuredReasoning("gpt-5.6-terra", { OPENAI_REASONING_EFFORT: "turbo" }), {
    reasoning: { effort: "medium" }
  });
});
