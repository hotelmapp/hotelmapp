import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_FIRST_FEATURE_FLAG, MODEL_DECISION_SCHEMA, aiFirstEnabled, groundingFactEntries,
  orchestrateHospitalityTurn, toolPermissions, tryAiFirstParking, validateModelDecision
} from "../ai-core/ai-orchestrator.js";
import { answerGuestMessage, breakfastReply, sensitiveSituationReply } from "../ai-core/guest-response.js";
import { hotelKnowledge } from "../ai-core/knowledge.js";
import { resolveKnowledgeGrounding } from "../ai-core/knowledge-grounding.js";

const silentLogger = { info() {} };

function decision(overrides = {}) {
  return {
    intent: "parking_availability", user_need: "確認是否有停車位",
    facts_to_use: ["parking.hotelSpaces", "parking.hotelSpacesLocation"], action: "none",
    clarification_needed: false, next_step: null, response_strategy: "answer", ...overrides
  };
}

test("architecture invariant: feature flag is explicit opt-in and schema is strict", () => {
  assert.equal(AI_FIRST_FEATURE_FLAG, "AI_FIRST_ORCHESTRATOR_ENABLED");
  assert.equal(aiFirstEnabled({ AI_FIRST_ORCHESTRATOR_ENABLED: "true" }), true);
  assert.equal(aiFirstEnabled({ AI_FIRST_ORCHESTRATOR_ENABLED: "1" }), false);
  assert.equal(MODEL_DECISION_SCHEMA.additionalProperties, false);
});

test("structured decisions reject unknown fields, fact IDs, and tools", () => {
  const context = { allowedFactIds: new Set(["parking.hotelSpaces"]), allowedTools: ["none"] };
  assert.equal(validateModelDecision(decision({ facts_to_use: ["parking.hotelSpaces"] }), context), true);
  assert.equal(validateModelDecision({ ...decision({ facts_to_use: ["parking.hotelSpaces"] }), surprise: true }, context), false);
  assert.equal(validateModelDecision(decision({ facts_to_use: ["parking.guessedFee"] }), context), false);
  assert.equal(validateModelDecision(decision({ facts_to_use: ["parking.hotelSpaces"], action: "contact_front_desk" }), context), false);
});

test("grounding cannot be bypassed and unknown certainty remains explicit", () => {
  const facts = groundingFactEntries(resolveKnowledgeGrounding("需要先預約嗎？", [], "parking"));
  assert.deepEqual(facts, [{ id: "parking.reservationRequired", value: null, certainty: "unknown", source: "hotel_knowledge_v2.0" }]);
});

test("tool permissions require identity plus durable confirmation", () => {
  assert.equal(toolPermissions().contact_front_desk, false);
  assert.equal(toolPermissions({ identity: { displayName: "guest" }, authorization: { state: "consent_received" } }).contact_front_desk, false);
  assert.equal(toolPermissions({ identity: { displayName: "guest" }, authorization: { state: "confirmed" } }).contact_front_desk, true);
});

test("final prose receives only model-selected verified facts, so unsupported facts cannot be injected", async () => {
  const calls = [];
  const request = async ({ payload }) => {
    calls.push(payload);
    return calls.length === 1
      ? { answer: JSON.stringify(decision({ facts_to_use: ["parking.hotelSpaces"] })) }
      : { answer: "飯店有 2 個停車位。" };
  };
  const grounding = resolveKnowledgeGrounding("有停車位嗎？");
  const result = await orchestrateHospitalityTurn({ message: "有停車位嗎？", grounding, request, logger: silentLogger });
  assert.equal(result.answer, "飯店有 2 個停車位。");
  const composerInput = JSON.parse(calls[1].input);
  assert.deepEqual(composerInput.selected_grounded_facts.map(fact => fact.id), ["parking.hotelSpaces"]);
  assert.equal(calls[1].input.includes("additionalCarFee"), false);
  assert.match(calls[0].text.format.type, /json_schema/);
});

test("parking five-turn continuity selects the current omitted-subject intent", () => {
  const turns = ["有停車位嗎？", "我們有兩台車", "那第二台多少？", "停哪裡？", "需要先預約嗎？"];
  const expected = ["parking_availability", "parking_fee", "parking_fee", "parking_location", "parking_reservation"];
  const history = [];
  for (let index = 0; index < turns.length; index++) {
    const grounding = resolveKnowledgeGrounding(turns[index], history);
    assert.equal(grounding.intent, expected[index]);
    history.push({ role: "user", content: turns[index] }, { role: "assistant", content: "已依正式資料回答" });
  }
});

test("AI failure safely falls back to the existing parking production reply", async () => {
  const answer = await answerGuestMessage("有停車位嗎？", {
    env: { AI_FIRST_ORCHESTRATOR_ENABLED: "true" }, logger: silentLogger,
    orchestrate: async () => { throw new Error("upstream_timeout"); },
    handoffService: async () => ({ attempted: false })
  });
  assert.match(answer, new RegExp(String(hotelKnowledge.parking.hotelSpaces)));
});

test("channel adapters share one orchestration path while presentation receives the channel", async () => {
  for (const channel of ["line", "messenger", "web"]) {
    let seen;
    const answer = await answerGuestMessage("有停車位嗎？", {
      channel, env: { AI_FIRST_ORCHESTRATOR_ENABLED: "true" }, logger: silentLogger,
      orchestrate: async options => { seen = options.channel; return { answer: "飯店有停車位。" }; },
      handoffService: async () => ({ attempted: false })
    });
    assert.equal(seen, channel);
    assert.match(answer, /停車位/);
  }
});

test("phase-one audit coverage retains facts and deterministic handling for non-parking categories", () => {
  assert.ok(hotelKnowledge.stay.checkIn, "check-in");
  assert.match(breakfastReply("早餐幾點？"), /08:00/, "breakfast");
  assert.ok(hotelKnowledge.guestServices, "luggage");
  assert.ok(hotelKnowledge.rooms, "room type");
  assert.ok(hotelKnowledge.local, "transport");
  assert.match(sensitiveSituationReply("付款異常怎麼辦？"), /付款/, "payment");
  assert.match(sensitiveSituationReply("我要取消訂房"), /尚未完成|還沒有/, "cancellation");
  assert.match(sensitiveSituationReply("我要客訴，很不滿"), /抱歉/, "complaint");
  assert.equal(resolveKnowledgeGrounding("有接駁車嗎？").facts, null, "unknown information is not fabricated by grounding");
});

test("orchestrator emits the required safe event lifecycle without guest content", async () => {
  const events = [];
  const logger = { info(_label, fields) { events.push(fields); } };
  let count = 0;
  await orchestrateHospitalityTurn({
    message: "有停車位嗎？", grounding: resolveKnowledgeGrounding("有停車位嗎？"), logger,
    request: async () => (++count === 1 ? { answer: JSON.stringify(decision()) } : { answer: "有停車位。" })
  });
  assert.deepEqual(events.map(item => item.event), ["orchestration_started", "grounding_completed", "model_decision_completed", "response_composed"]);
  assert.equal(JSON.stringify(events).includes("有停車位嗎"), false);
});

test("tryAiFirstParking reports failure and fallback events", async () => {
  const events = [];
  const result = await tryAiFirstParking({
    env: { AI_FIRST_ORCHESTRATOR_ENABLED: "true" }, logger: { info(_label, fields) { events.push(fields.event); } },
    orchestrate: async () => { throw new Error("bad_decision"); }
  });
  assert.equal(result, null);
  assert.deepEqual(events, ["orchestration_failed", "ai_fallback_used"]);
});
