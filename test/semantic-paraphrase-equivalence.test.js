import test from "node:test";
import assert from "node:assert/strict";
import { answerWithConversation } from "../ai-core/conversation/runtime.js";
import { resolveHandoffDecision } from "../ai-core/handoff.js";
import { parkingReply, resolveKnowledgeGrounding } from "../ai-core/knowledge-grounding.js";
import { semanticRoutePayload } from "../ai-core/semantic-router.js";

const parkingReservationParaphrases = [
  "門口停車位可以幫我保留一個嗎？",
  "停車位可以保留嗎？",
  "可以麻煩你幫我預留車位嗎？",
  "能幫我們留一個門口車位嗎？"
];

function semanticParkingGrounding(message, handoff) {
  const grounding = resolveKnowledgeGrounding(message);
  return {
    ...grounding,
    semanticRoute: {
      currentNeed: "詢問能否預留停車位",
      usedHistory: false,
      clarificationNeeded: false,
      handoff,
      routerVersion: "test"
    }
  };
}

function memoryService() {
  return {
    context: async () => ({ turns: [], topic: null, intent: null, handoff: { state: "none" } }),
    append: async () => {}
  };
}

test("parking reservation paraphrases share one semantic intent", () => {
  for (const message of parkingReservationParaphrases) {
    const grounding = resolveKnowledgeGrounding(message);
    assert.equal(grounding.topic, "parking", message);
    assert.equal(grounding.intent, "parking_reservation", message);
    assert.equal(grounding.contract.actionPolicy, "answer_before_handoff", message);
  }
});

test("a model-side polite-word handoff false positive cannot bypass a known policy", () => {
  const message = parkingReservationParaphrases[0];
  const grounding = semanticParkingGrounding(message, { requested: true, category: "真人服務" });
  assert.deepEqual(resolveHandoffDecision(message, [], grounding), {
    required: false,
    category: null,
    source: "grounded_policy"
  });
});

test("same-meaning parking questions produce the same policy answer and never collect contact details", async () => {
  const answers = [];
  for (const [index, message] of parkingReservationParaphrases.entries()) {
    // Reproduce the observed upstream mismatch: one paraphrase is incorrectly
    // recommended for handoff while the equivalent messages are not.
    const handoff = index === 0
      ? { requested: true, category: "真人服務" }
      : { requested: false, category: null };
    const grounding = semanticParkingGrounding(message, handoff);
    const result = await answerWithConversation({
      id: `parking_paraphrase_${index}`,
      channel: "line",
      message,
      service: memoryService(),
      route: async () => grounding,
      answer: async (_message, { grounding: selected }) => parkingReply(selected)
    });
    answers.push(result.answer);
    assert.equal(result.handoff.state, "none", message);
    assert.match(result.answer, /沒有提供預留.*先到先停/u, message);
    assert.doesNotMatch(result.answer, /姓名|電話或 Email|確認送出/u, message);
  }
  assert.equal(new Set(answers).size, 1);
});

test("an explicit request to transfer to the front desk remains a handoff", () => {
  const message = "請幫我轉接櫃檯，我想確認停車位能不能保留";
  const grounding = semanticParkingGrounding(message, { requested: true, category: "真人服務" });
  assert.deepEqual(resolveHandoffDecision(message, [], grounding), {
    required: true,
    category: "真人服務",
    source: "semantic"
  });
});

test("semantic router treats polite wording as speech style rather than handoff intent", () => {
  const payload = semanticRoutePayload(parkingReservationParaphrases[0], [], {});
  assert.match(payload.instructions, /Polite wording.*does not by itself request a staff handoff/iu);
  assert.match(payload.instructions, /all parking_reservation with requested=false/iu);
});
