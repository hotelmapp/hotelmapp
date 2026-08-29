import test from "node:test";
import assert from "node:assert/strict";
import { orchestrateHospitalityTurn } from "../ai-core/ai-orchestrator.js";
import { answerGuestMessage } from "../ai-core/guest-response.js";
import { resolveKnowledgeGrounding } from "../ai-core/knowledge-grounding.js";
import { groundedFactSet } from "../ai-core/reasoning-core.js";
import { validateUnifiedReply } from "../ai-core/reply-quality.js";
import { resolveSemanticKnowledgeGrounding, semanticRoutePayload } from "../ai-core/semantic-router.js";

const silentLogger = { info() {} };
const temporalContext = {
  date: "2026-08-29", time: "12:00:00", timeZone: "Asia/Taipei", weekday: "Saturday",
  frontDesk: { opens: "07:00", closes: "22:00", isOpen: true }
};
const history = [
  { role: "user", content: "想請問平日住宿補助規則。" },
  { role: "assistant", content: "請問您想了解哪一部分呢？" }
];

function grounding(message) {
  return resolveKnowledgeGrounding(message, history, "subsidy", "subsidy_period", temporalContext);
}

test("the screenshot follow-up becomes date applicability and asks only for the missing date", async () => {
  const message = "因為是國定連續假日前一天想先詢問是否適用 謝謝~";
  const selected = grounding(message);
  assert.equal(selected.topic, "subsidy");
  assert.equal(selected.intent, "subsidy_date_applicability");
  assert.equal(selected.facts.requestContext.requestedStayDate, null);
  assert.equal(selected.facts.requestContext.holidayRelationship, "day_before_long_holiday");
  assert.match(selected.contract.requiredFactIds.join(" "), /applicableStayDays/u);

  const answer = await answerGuestMessage(message, {
    history, grounding: selected, temporalContext,
    env: { AI_FIRST_ORCHESTRATOR_ENABLED: "false" }, logger: silentLogger
  });
  assert.match(answer, /^了解～您是想確認國定連假前一天/u);
  assert.match(answer, /國定連續假日本身不適用/u);
  assert.match(answer, /週日至週四/u);
  assert.match(answer, /預計入住的日期/u);
  assert.doesNotMatch(answer, /^您好/u, "a follow-up should connect naturally instead of greeting again");
  assert.doesNotMatch(answer, /^是否適用仍需以政府活動系統/u);
});

test("date applicability handles in-range weekday, Friday, and outside-period dates", async () => {
  const cases = [
    ["9月30日住宿補助適用嗎？", /9 月 30 日.*週三.*適用日/u],
    ["9月4日住宿補助可以用嗎？", /9 月 4 日.*週五.*不適用/u],
    ["8月31日住宿補助適用嗎？", /8 月 31 日.*不在 9 月 1 日至 11 月 30 日.*不適用/u]
  ];
  for (const [message, expected] of cases) {
    const selected = grounding(message);
    assert.equal(selected.intent, "subsidy_date_applicability", message);
    assert.equal(groundedFactSet(selected.facts).find(fact => fact.id === "requestContext.requestedStayDate")?.source, "current_user_message");
    const answer = await answerGuestMessage(message, {
      history, grounding: selected, temporalContext,
      env: { AI_FIRST_ORCHESTRATOR_ENABLED: "false" }, logger: silentLogger
    });
    assert.match(answer, expected, message);
  }
});

test("the semantic router cannot collapse a date question into generic eligibility", async () => {
  const message = "因為是國定連續假日前一天想先詢問是否適用 謝謝~";
  const selected = await resolveSemanticKnowledgeGrounding(message, history, "subsidy", "subsidy_period", {
    env: {}, temporalContext, logger: silentLogger,
    request: async () => ({ answer: JSON.stringify({
      routes: [{ topic: "subsidy", intent: "subsidy_eligibility" }],
      current_need: "確認是否具備補助資格",
      uses_history: true,
      clarification_needed: false,
      handoff: { requested: false, category: null }
    }) })
  });
  assert.equal(selected.intent, "subsidy_date_applicability");
  assert.equal(selected.semanticRoute.clarificationNeeded, true);
  assert.equal(selected.facts.requestContext.requestedStayDate, null);
  assert.match(semanticRoutePayload(message, history).instructions, /subsidy_date_applicability, not subsidy_eligibility/u);
});

test("a formal government-system deflection fails both usefulness and warmth checks", () => {
  const message = "因為是國定連續假日前一天想先詢問是否適用 謝謝~";
  const selected = grounding(message);
  const facts = groundedFactSet(selected.facts);
  const cold = "是否適用仍需以政府活動系統查詢結果為準；即使是國定連假前一天，也無法先保證一定可使用。活動規則與額度請以政府最新公告為準。";
  const natural = "了解～您是想確認國定連假前一天入住能不能使用補助。國定連續假日本身不適用；連假前一天要看實際入住日期是否落在週日至週四。方便告訴我預計入住的日期嗎？";
  assert.deepEqual(validateUnifiedReply({ answer: cold, message, history, grounding: selected, selectedFacts: facts }), { valid: false, reason: "current_need_not_answered_first" });
  assert.equal(validateUnifiedReply({ answer: natural, message, history, grounding: selected, selectedFacts: facts }).valid, true);
});

test("the unified composer retries a cold mid-conversation answer with a contextual reply", async () => {
  const message = "因為是國定連續假日前一天想先詢問是否適用 謝謝~";
  const selected = {
    ...grounding(message),
    semanticRoute: {
      currentNeed: "確認國定連假前一天是否適用平日住宿補助",
      usedHistory: true,
      clarificationNeeded: true,
      handoff: { requested: false, category: null },
      routerVersion: "test"
    }
  };
  const replies = [
    "是否適用仍需以政府活動系統查詢結果為準；即使是國定連假前一天，也無法先保證一定可使用。活動規則與額度請以政府最新公告為準。",
    "了解～您是想確認國定連假前一天入住能不能使用補助。國定連續假日本身不適用；連假前一天要看實際入住日期是否落在週日至週四。方便告訴我預計入住的日期嗎？"
  ];
  const payloads = [];
  const result = await orchestrateHospitalityTurn({
    message, history, grounding: selected, logger: silentLogger,
    request: async ({ payload }) => {
      payloads.push(payload);
      return { answer: replies.shift() };
    }
  });
  assert.equal(payloads.length, 2);
  assert.match(payloads[1].instructions, /current_need_not_answered_first/u);
  assert.match(result.answer, /^了解～您是想確認/u);
});
