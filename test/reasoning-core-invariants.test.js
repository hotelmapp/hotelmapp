import test from "node:test";
import assert from "node:assert/strict";
import { hotelKnowledge } from "../ai-core/knowledge.js";
import { resolveKnowledgeGrounding } from "../ai-core/knowledge-grounding.js";
import {
  CAPABILITY_REGISTRY, availableCapabilities, executeCapability, groundedFactSet,
  presentForChannel, responseProvenance, verifyFinalResponse
} from "../ai-core/reasoning-core.js";

const domains = [
  ["parking", "有停車位嗎？"], ["check-in", "check-in 幾點？"], ["late checkout", "可以延後退房嗎？"],
  ["breakfast", "早餐幾點？"], ["luggage", "可以寄放行李嗎？"], ["room type", "有哪些房型？"],
  ["baby equipment", "有嬰兒床嗎？"], ["transportation", "可以幫忙叫計程車嗎？"],
  ["cancellation", "取消規定是什麼？"], ["payment", "可以用信用卡付款嗎？"], ["complaint", "我要客訴"]
];

for (const [domain, message] of domains) {
  test(`${domain}: known, unknown and action requests preserve the boundaries`, async () => {
    const grounding = resolveKnowledgeGrounding(message);
    const known = groundedFactSet(grounding.facts).filter(fact => fact.certainty === "confirmed");
    assert.ok(known.length, `${domain} must retrieve authoritative facts`);

    const unknown = groundedFactSet({ requestedOperationalDetail: null });
    assert.equal(unknown[0].certainty, "unknown");
    assert.equal(unknown[0].value, null);

    const available = availableCapabilities();
    assert.deepEqual(available, ["answer_information"]);
    const denied = await executeCapability("contact_front_desk", { available, execute: async () => ({ status: "completed" }) });
    assert.equal(denied.status, "denied");
  });
}

test("unsupported facts and unverified completion claims fail final verification", () => {
  const selectedFacts = [{ id: "parking.hotelSpaces", value: 3, certainty: "confirmed", source: "hotel_knowledge_v2.0" }];
  assert.equal(verifyFinalResponse({ answer: "飯店有 99 個車位", selectedFacts }).reason, "unsupported_numeric_fact");
  assert.equal(verifyFinalResponse({ answer: "已幫您預留", selectedFacts, toolResult: { status: "not_executed" } }).reason, "unverified_action_claim");
  assert.equal(verifyFinalResponse({ answer: "是否能預約目前尚未確認", selectedFacts: [{ id: "parking.reservation", value: null, certainty: "unknown" }] }).valid, true);
});

test("capability availability and completion require authorization and a verified executor result", async () => {
  assert.equal(CAPABILITY_REGISTRY.contact_front_desk.authorization, "confirmed");
  const available = availableCapabilities({ identity: { displayName: "guest" }, authorization: { state: "confirmed" } });
  assert.ok(available.includes("contact_front_desk"));
  assert.equal((await executeCapability("contact_front_desk", { available })).status, "not_executed");
  assert.equal((await executeCapability("contact_front_desk", { available, execute: async () => ({ status: "completed", receipt: "safe-id" }) })).status, "completed");
});

test("conversation context resolves omitted subjects but cannot become factual provenance", () => {
  const grounding = resolveKnowledgeGrounding("那晚一點呢？", [{ role: "user", content: "check-in 幾點？" }, { role: "assistant", content: "可以免費延遲到 24:00" }]);
  assert.equal(grounding.topic, "check_in");
  assert.equal(JSON.stringify(grounding.facts).includes("24:00"), false);
});

test("channels cannot rewrite core facts and every final result carries provenance", () => {
  const grounding = resolveKnowledgeGrounding("早餐幾點？");
  const selectedFacts = groundedFactSet(grounding.facts).slice(0, 1);
  const result = { answer: "早餐從 08:00 開始。", provenance: responseProvenance({ grounding, selectedFacts, capability: "none", toolResult: { status: "not_requested" } }) };
  for (const channel of ["web", "line", "messenger", "instagram", "voice"]) {
    const presented = presentForChannel(result, channel);
    assert.equal(presented.answer, result.answer);
    assert.deepEqual(presented.provenance, result.provenance);
    assert.ok(presented.provenance.facts[0].source);
  }
});

test("unknown topic is explicit and never populated from general hotel assumptions", () => {
  const grounding = resolveKnowledgeGrounding("房間有熨斗嗎？");
  assert.equal(grounding.topic, null);
  assert.equal(grounding.facts, null);
});
