import test from "node:test";
import assert from "node:assert/strict";
import { answerGuestMessage } from "../ai-core/guest-response.js";
import { planConversationTurn, SERVICE_PRIORITY } from "../ai-core/conversation-flow.js";
import { voiceInstructions } from "../api/realtime.js";

const noHandoff = async () => ({ attempted: false });

test("parking fee answers progressively and offers one relevant continuation", async () => {
  const answer = await answerGuestMessage("停車要收費嗎？", { handoffService: noHandoff });
  assert.match(answer, /每間客房都有 1 台免費停車/u);
  assert.match(answer, /第 2 台車加收 NT\$200/u);
  assert.match(answer, /停哪裡比較方便/u);
  assert.doesNotMatch(answer, /門口可停 3 台|車牌號碼|0927/u);
});

test("short acceptance consumes the pending parking-location offer", async () => {
  const history = [
    { role: "user", content: "停車要收費嗎？" },
    { role: "assistant", content: "每房一台免費。如果您開車過來，我也可以跟您說停哪裡比較方便。" }
  ];
  const plan = planConversationTurn({ message: "好啊", history, state: { pendingAction: { type: "explain_parking_location", topic: "parking", intent: "parking_location" } } });
  assert.equal(plan.resolvedIntent, "parking_location");
  const answer = await answerGuestMessage("好啊", { history, plan, grounding: plan.grounding, handoffService: noHandoff });
  assert.match(answer, /門口.*3.*車位/u);
  assert.doesNotMatch(answer, /還需要什麼協助/u);
});

test("parking location does not repeat fee facts", async () => {
  const answer = await answerGuestMessage("那我要停哪裡？", { history: [{ role: "user", content: "停車要收費嗎？" }], handoffService: noHandoff });
  assert.match(answer, /門口.*3.*車位/u);
  assert.doesNotMatch(answer, /NT\$200|免費停車/u);
});

test("late arrival creates a required proactive notice", async () => {
  const plan = planConversationTurn({ message: "我大概晚上十點半到。" });
  assert.equal(plan.servicePriority, SERVICE_PRIORITY.REQUIRED);
  assert.equal(plan.proactiveNotice, "late_arrival_procedure");
  const answer = await answerGuestMessage("我大概晚上十點半到。", { plan, grounding: plan.grounding, handoffService: noHandoff });
  assert.match(answer, /提前通知櫃檯.*自助入住密碼/u);
  assert.match(answer, /領取.*房卡/u);
});

test("equipment complaint empathizes and requires consent before handoff", async () => {
  let calls = 0;
  const answer = await answerGuestMessage("冷氣好像壞掉了。", { handoffService: async () => { calls++; return { attempted: true }; } });
  assert.match(answer, /住起來確實會不舒服/u);
  assert.match(answer, /需要我幫您通知/u);
  assert.equal(calls, 0);
  assert.doesNotMatch(answer, /換房|賠償|已經.*通知/u);
});

test("front-desk offer is not sent until a later explicit acceptance", async () => {
  let calls = 0;
  const first = await answerGuestMessage("我想找櫃檯。", { handoffService: async () => { calls++; return { attempted: true }; } });
  assert.match(first, /04-2707-8378/u);
  assert.equal(calls, 0);
  const history = [{ role: "user", content: "我想找櫃檯。" }, { role: "assistant", content: first }];
  const plan = planConversationTurn({ message: "好，麻煩你。", history, state: { pendingAction: { type: "request_handoff", topic: "front_desk_contact" } } });
  assert.equal(plan.handoffConsent, true);
});

test("checkout has no artificial continuation", async () => {
  const plan = planConversationTurn({ message: "退房時間幾點？" });
  assert.equal(plan.conversationContinuation, SERVICE_PRIORITY.NONE);
  assert.equal(plan.shouldAskQuestion, false);
});

test("all channels share the planner policy and only presentation constraints vary", () => {
  const plans = ["web", "line", "voice"].map(channel => planConversationTurn({ message: "我晚上十點半到。", channel }));
  for (const plan of plans) {
    assert.equal(plan.proactiveNotice, "late_arrival_procedure");
    assert.equal(plan.servicePriority, SERVICE_PRIORITY.REQUIRED);
    assert.equal(plan.guestGoal, "check_in");
  }
  assert.equal(plans[2].channelConstraints.voiceBrevity, true);
  assert.match(voiceInstructions(), /progressive disclosure/u);
});
