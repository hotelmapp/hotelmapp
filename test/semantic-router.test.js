import test from "node:test";
import assert from "node:assert/strict";
import { answerGuestMessage } from "../ai-core/guest-response.js";
import { resolveKnowledgeGrounding } from "../ai-core/knowledge-grounding.js";
import {
  resolveSemanticKnowledgeGrounding,
  SEMANTIC_ROUTE_SCHEMA,
  semanticRoutePayload,
  validateSemanticRoute
} from "../ai-core/semantic-router.js";
import { answerWithConversation } from "../ai-core/conversation/runtime.js";
import { resolveHandoffDecision } from "../ai-core/handoff.js";

const screenshotHistory = [
  { role: "user", content: "停車折抵要怎麼辦？" },
  { role: "assistant", content: "停妥後告知櫃檯車牌號碼。" },
  { role: "user", content: "可以在這邊訂房嗎？" },
  { role: "assistant", content: "可以到官網預訂。" }
];

const bookingDecision = {
  routes: [{ topic: "booking", intent: "booking_direct" }],
  current_need: "詢問是否能直接向櫃檯訂房",
  uses_history: false,
  clarification_needed: false,
  handoff: { requested: false, category: null }
};

test("current booking request cannot fall back to an older parking topic", async () => {
  const grounding = resolveKnowledgeGrounding("可否直接跟櫃檯訂呢？", screenshotHistory, "parking", "parking_process");
  assert.equal(grounding.topic, "booking");
  assert.equal(grounding.intent, "booking_direct");

  const answer = await answerGuestMessage("可否直接跟櫃檯訂呢？", {
    history: screenshotHistory,
    grounding,
    channel: "line",
    handoffService: async () => ({ attempted: false })
  });
  assert.match(answer, /可以.*櫃檯.*訂房/u);
  assert.match(answer, /04-2707-8378/u);
  assert.doesNotMatch(answer, /停車|車牌|折抵|停妥/u);
});

test("deterministic fallback stops at the newest self-contained topic", () => {
  const booking = resolveKnowledgeGrounding("那可以直接辦理嗎？", screenshotHistory, "parking", "parking_process");
  assert.equal(booking.topic, "booking");
  assert.notEqual(booking.topic, "parking");

  const interrupted = resolveKnowledgeGrounding("那可以嗎？", [
    { role: "user", content: "飯店有停車位嗎？" },
    { role: "assistant", content: "有的。" },
    { role: "user", content: "我想請問別的事情" },
    { role: "assistant", content: "請問。" }
  ], "parking", "parking_availability");
  assert.equal(interrupted.topic, null);
});

test("semantic router applies a strict current-turn-first model decision", async () => {
  const calls = [];
  const grounding = await resolveSemanticKnowledgeGrounding(
    "可否直接跟櫃檯訂呢？",
    screenshotHistory,
    "parking",
    "parking_process",
    {
      env: {},
      logger: { info() {} },
      request: async options => {
        calls.push(options);
        return { answer: JSON.stringify(bookingDecision) };
      }
    }
  );
  assert.equal(grounding.topic, "booking");
  assert.equal(grounding.intent, "booking_direct");
  assert.deepEqual(grounding.semanticRoute, {
    currentNeed: "詢問是否能直接向櫃檯訂房",
    usedHistory: false,
    clarificationNeeded: false,
    handoff: { requested: false, category: null },
    routerVersion: "2.2"
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].payload.instructions, /complete CURRENT message/u);
  assert.match(calls[0].payload.instructions, /never parking/u);
  assert.equal(calls[0].payload.text.format.type, "json_schema");
  assert.deepEqual(calls[0].payload.text.format.schema, SEMANTIC_ROUTE_SCHEMA);
});

test("router validation rejects stale-topic replacement and fails safe", async () => {
  const staleParking = {
    routes: [{ topic: "parking", intent: "parking_process" }],
    current_need: "停車折抵",
    uses_history: true,
    clarification_needed: false,
    handoff: { requested: false, category: null }
  };
  assert.equal(validateSemanticRoute(staleParking, "可否直接跟櫃檯訂呢？"), false);
  assert.equal(validateSemanticRoute(bookingDecision, "可否直接跟櫃檯訂呢？"), true);

  const grounding = await resolveSemanticKnowledgeGrounding(
    "可否直接跟櫃檯訂呢？",
    screenshotHistory,
    "parking",
    "parking_process",
    {
      env: {},
      logger: { info() {} },
      request: async () => ({ answer: JSON.stringify(staleParking) })
    }
  );
  assert.equal(grounding.topic, "booking");
  assert.equal(grounding.intent, "booking_direct");
});

test("semantic routing can honor negation and conditions instead of counting keywords", async () => {
  const corrected = {
    routes: [{ topic: "booking", intent: "booking_direct" }],
    current_need: "不是詢問停車，而是直接訂房",
    uses_history: false,
    clarification_needed: false,
    handoff: { requested: false, category: null }
  };
  assert.equal(validateSemanticRoute(corrected, "不是要問停車，我是要直接跟櫃檯訂房"), true);
  const grounding = await resolveSemanticKnowledgeGrounding(
    "不是要問停車，我是要直接跟櫃檯訂房",
    screenshotHistory,
    "parking",
    "parking_process",
    {
      env: {},
      logger: { info() {} },
      request: async () => ({ answer: JSON.stringify(corrected) })
    }
  );
  assert.equal(grounding.topic, "booking");
  assert.equal(grounding.intent, "booking_direct");
});

test("semantic payload sends recent conversation without hotel facts or actions", () => {
  const payload = semanticRoutePayload("可否直接跟櫃檯訂呢？", screenshotHistory, {});
  const input = JSON.parse(payload.input);
  assert.equal(input.current_user_message, "可否直接跟櫃檯訂呢？");
  assert.equal(input.recent_history.length, screenshotHistory.length);
  assert.equal(payload.input.includes("additionalCarFee"), false);
  assert.equal(payload.input.includes("frontDeskPhone"), false);
  assert.doesNotMatch(payload.instructions, /sendEmail|executeTool/u);
});

test("semantic handoff understands requested action without authorizing it", async () => {
  const requested = {
    routes: [{ topic: "front_desk_contact", intent: "front_desk_contact" }],
    current_need: "請櫃檯主動聯絡旅客",
    uses_history: false,
    clarification_needed: false,
    handoff: { requested: true, category: "真人服務" }
  };
  const grounding = await resolveSemanticKnowledgeGrounding("可否請飯店的人跟我回電？", [], null, null, {
    env: {}, logger: { info() {} }, request: async () => ({ answer: JSON.stringify(requested) })
  });
  assert.deepEqual(resolveHandoffDecision("可否請飯店的人跟我回電？", [], grounding.semanticRoute), {
    required: true, category: "真人服務", source: "semantic"
  });

  const infoOnly = { ...requested, current_need: "詢問櫃檯電話", handoff: { requested: false, category: null } };
  assert.deepEqual(resolveHandoffDecision("櫃檯電話幾號？", [], {
    handoff: infoOnly.handoff
  }), { required: false, category: null, source: "semantic" });
});

test("invalid semantic handoff pairing is rejected instead of weakening the contract", () => {
  assert.equal(validateSemanticRoute({ ...bookingDecision, handoff: { requested: true, category: null } }, "可否直接跟櫃檯訂呢？"), false);
  assert.equal(validateSemanticRoute({ ...bookingDecision, handoff: { requested: false, category: "真人服務" } }, "可否直接跟櫃檯訂呢？"), false);
});

test("durable conversation routes before answering and stores the new topic", async () => {
  let saved;
  let receivedGrounding;
  const service = {
    context: async () => ({
      turns: screenshotHistory,
      topic: "parking",
      intent: "parking_process",
      handoff: { state: "none" }
    }),
    append: async (_id, _channel, _turns, metadata) => { saved = metadata; }
  };
  const result = await answerWithConversation({
    id: "line_semantic_route",
    channel: "line",
    message: "可否直接跟櫃檯訂呢？",
    service,
    route: async () => resolveKnowledgeGrounding("可否直接跟櫃檯訂呢？", screenshotHistory, "parking", "parking_process"),
    answer: async (_message, { grounding }) => {
      receivedGrounding = grounding;
      return "可以直接向櫃檯詢問訂房。";
    }
  });
  assert.equal(result.answer, "可以直接向櫃檯詢問訂房。");
  assert.equal(receivedGrounding.topic, "booking");
  assert.equal(saved.topic, "booking");
  assert.equal(saved.intent, "booking_direct");
});
