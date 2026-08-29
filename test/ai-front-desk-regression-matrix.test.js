import test from "node:test";
import assert from "node:assert/strict";
import { answerGuestMessage } from "../ai-core/guest-response.js";
import { resolveKnowledgeGrounding } from "../ai-core/knowledge-grounding.js";
import { resolveHandoffDecision } from "../ai-core/handoff.js";
import {
  advanceHandoffAuthorization,
  performAuthorizedHandoff
} from "../ai-core/handoff-service.js";

const parkingThenBooking = [
  { role: "user", content: "停車折抵要怎麼辦？" },
  { role: "assistant", content: "停妥後告知櫃檯車牌號碼。" },
  { role: "user", content: "可以在這邊訂房嗎？" },
  { role: "assistant", content: "可以到官網預訂。" }
];

test("historical topic mistakes stay fixed as one regression matrix", () => {
  const cases = [
    ["國旅補助第一晚可以折抵多少？", [], "subsidy", "subsidy_amount"],
    ["停車折抵要怎麼辦？", [], "parking", "parking_process"],
    ["可否直接跟櫃檯訂呢？", parkingThenBooking, "booking", "booking_direct"],
    ["請問房間 Wi-Fi 密碼？", parkingThenBooking, "wifi", null]
  ];
  for (const [message, history, topic, intent] of cases) {
    const grounding = resolveKnowledgeGrounding(message, history, "parking", "parking_process");
    assert.equal(grounding.topic, topic, message);
    assert.equal(grounding.intent, intent, message);
  }
});

test("parking address follow-ups and dated booking links keep the newly requested detail", async () => {
  const parkingHistory = [
    { role: "user", content: "配合的停車場在哪邊？" },
    { role: "assistant", content: "飯店門口有 3 個車位。" }
  ];
  const parking = resolveKnowledgeGrounding("門口滿了，特約停車場在哪裡呢？", parkingHistory);
  assert.equal(parking.intent, "parking_partner_location");
  const parkingAnswer = await answerGuestMessage("門口滿了，特約停車場在哪裡呢？", {
    history: parkingHistory,
    channel: "line"
  });
  assert.match(parkingAnswer, /智惠全國停車場.*台中市西屯區智惠街135號旁空地/u);
  assert.doesNotMatch(parkingAnswer, /門口有 3 個車位|門口可停 3 台車/u);

  const bookingAnswer = await answerGuestMessage("請問9月30號還有房間嗎？", {
    channel: "line",
    temporalContext: { date: "2026-08-29", timezone: "Asia/Taipei" },
    env: { AI_FIRST_ORCHESTRATOR_ENABLED: "false" }
  });
  assert.match(bookingAnswer, /checkInDate=2026-09-30/u);
  assert.match(bookingAnswer, /checkOutDate=2026-10-01/u);
  assert.match(bookingAnswer, /把日期帶進官方訂房頁面/u);
});

test("information, booking and staff-action meanings remain distinct", () => {
  const cases = [
    ["櫃檯電話幾號？", { requested: false, category: null }, false, null],
    ["我想在這裡訂房", { requested: false, category: null }, false, null],
    ["可否請飯店人員處理後回電？", { requested: true, category: "真人服務" }, true, "真人服務"],
    ["我只是問退款規定，不要幫我送出", { requested: false, category: null }, false, null]
  ];
  for (const [message, handoff, required, category] of cases) {
    assert.deepEqual(resolveHandoffDecision(message, [], { handoff }), {
      required, category, source: "semantic"
    }, message);
  }
});

test("all previously observed handoff phrasings use one state contract", () => {
  for (const firstMessage of [
    "可否幫我接洽櫃檯呢？",
    "我需要聯絡櫃檯",
    "能請飯店的人處理後回我嗎？"
  ]) {
    let result = advanceHandoffAuthorization({
      message: firstMessage,
      current: { state: "none" },
      decision: { required: true, category: "真人服務" }
    });
    assert.equal(result.handoff.state, "collecting_required_fields", firstMessage);
    const requestId = result.handoff.requestId;

    result = advanceHandoffAuthorization({ message: "好的", current: result.handoff });
    assert.equal(result.handoff.state, "collecting_required_fields", firstMessage);
    result = advanceHandoffAuthorization({ message: "我想訂9月30陳明暉，0927708908。", current: result.handoff });
    assert.equal(result.handoff.state, "ready_for_confirmation", firstMessage);
    assert.equal(result.handoff.requestId, requestId, firstMessage);
    assert.deepEqual(result.handoff.contact, { displayName: "陳明暉", phone: "0927708908" }, firstMessage);
    result = advanceHandoffAuthorization({ message: "好的", current: result.handoff });
    assert.equal(result.handoff.state, "confirmed", firstMessage);
    assert.equal(result.authorized, true, firstMessage);
  }
});

test("guest prose and contact data never send before durable final confirmation", async () => {
  const states = ["none", "collecting_required_fields", "ready_for_confirmation"];
  for (const state of states) {
    let sends = 0;
    const result = await performAuthorizedHandoff(
      { message: "好的", channel: "line" },
      {
        authorization: {
          state,
          category: "真人服務",
          contact: { displayName: "陳明暉", phone: "0927708908" }
        }
      },
      { send: async () => sends++ }
    );
    assert.equal(result.delivered, false, state);
    assert.equal(sends, 0, state);
  }
});

test("cancel is terminal for the pending request and sends nothing", async () => {
  const cancelled = advanceHandoffAuthorization({
    message: "先不用了",
    current: {
      state: "ready_for_confirmation",
      requestId: "request-cancel",
      category: "真人服務",
      contact: { displayName: "陳明暉", phone: "0927708908" }
    }
  });
  assert.deepEqual(cancelled.handoff, { state: "none" });
  assert.equal(cancelled.authorized, false);
  assert.match(cancelled.reply, /取消.*不會送出/u);
});
