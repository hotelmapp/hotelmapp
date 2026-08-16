import test from "node:test";
import assert from "node:assert/strict";
import { hotelKnowledge } from "../ai-core/knowledge.js";
import { answerGuestMessage, responsesPayload } from "../ai-core/guest-response.js";
import { factualContract, resolveKnowledgeGrounding, validateGroundedResponse } from "../ai-core/knowledge-grounding.js";
import { voiceInstructions } from "../api/realtime.js";

const noHandoff = async () => ({ attempted: false });

test("authoritative breakfast schema distinguishes cutoff, dining, and optional recommendation", () => {
  const breakfast = hotelKnowledge.breakfast;
  assert.deepEqual(breakfast.serviceStart, { time: "08:00", modality: "hard_rule" });
  assert.equal(breakfast.orderCheckInCutoff.time, "10:00");
  assert.equal(breakfast.orderCheckInCutoff.modality, "hard_rule");
  assert.equal(breakfast.diningAfterCutoff.allowed, true);
  assert.equal(breakfast.preorderRecommendation.modality, "recommendation");
  assert.equal(breakfast.preorderRecommendation.required, false);
});

test("breakfast follow-up re-grounds authoritative rules from prior user topic", async () => {
  const history = [
    { role: "user", content: "早餐時間是幾點？" },
    { role: "assistant", content: "早餐時間是 08:00–10:00。" }
  ];
  const answer = await answerGuestMessage("那我九點半過去可以嗎？", { history, channel: "web", handoffService: noHandoff });
  assert.match(answer, /可以.*九點半|九點半.*可以/u);
  assert.match(answer, /10:00 是點餐／報到截止時間/u);
  assert.match(answer, /用餐時間不受 10:00 限制/u);
  assert.match(answer, /前一天入住時.*櫃台.*先點早餐/u);
  assert.match(answer, /建議.*不是強制/u);
  assert.doesNotMatch(answer, /10(?::00|\s*點)前必須吃完|10(?::00|\s*點)後.*不能留|必須前一天(?:預訂|點餐)/u);
});

test("incorrect assistant history is non-authoritative and is corrected", async () => {
  const history = [
    { role: "user", content: "我想問早餐時間。" },
    { role: "assistant", content: "10 點必須吃完，而且必須前一天預訂早餐。" }
  ];
  const grounding = resolveKnowledgeGrounding("那我九點半過去可以嗎？", history);
  assert.equal(grounding.topic, "breakfast");
  const answer = await answerGuestMessage("那我九點半過去可以嗎？", { history, grounding, handoffService: noHandoff });
  assert.match(answer, /不是用餐結束時間/u);
  assert.match(answer, /用餐時間不受 10:00 限制/u);
  assert.match(answer, /不是強制要求/u);
  assert.doesNotMatch(answer, /必須吃完|必須前一天預訂/u);
});

test("factual validator rejects modality and cutoff semantic drift", () => {
  const grounding = resolveKnowledgeGrounding("早餐九點半可以嗎？");
  assert.equal(validateGroundedResponse("九點半可以，10 點前完成點餐即可，之後仍可繼續用餐。", grounding), true);
  assert.equal(validateGroundedResponse("10 點前必須吃完。", grounding), false);
  assert.equal(validateGroundedResponse("10 點後不能留在餐廳。", grounding), false);
  assert.equal(validateGroundedResponse("一定要前一天預訂早餐。", grounding), false);
});

test("topic resolver uses user continuity, not stale assistant claims", () => {
  const parking = resolveKnowledgeGrounding("那第二台呢？", [{ role: "user", content: "飯店有停車位嗎？" }, { role: "assistant", content: "早餐十點結束。" }]);
  assert.equal(parking.topic, "parking");
  assert.equal(parking.facts.parking.rules[1], "每房配合 1 個車位；第二台車加收 NT$200。");
  const checkIn = resolveKnowledgeGrounding("那晚上十點後呢？", [{ role: "user", content: "幾點可以入住？" }]);
  assert.equal(checkIn.topic, "check_in");
  assert.match(checkIn.facts.stay.afterHoursCheckIn, /提前通知櫃檯取得自助入住密碼/u);
  const contact = resolveKnowledgeGrounding("那晚上十一點設備壞掉呢？", [{ role: "user", content: "櫃檯服務到幾點？" }]);
  assert.equal(contact.topic, "front_desk_contact");
  assert.match(contact.facts.contact.afterHoursEquipment, /0927-708-908/u);
});

test("Web, LINE, and Voice share factual precedence and contract", () => {
  const grounding = resolveKnowledgeGrounding("那我九點半過去可以嗎？", [{ role: "user", content: "早餐幾點？" }]);
  assert.deepEqual(grounding.contract, factualContract("breakfast"));
  for (const channel of ["web", "line"]) {
    const instructions = responsesPayload("那我九點半過去可以嗎？", [{ role: "user", content: "早餐幾點？" }], channel).instructions;
    assert.match(instructions, /正式飯店知識 > 對話 topic\/state > 對話歷史 > 推理 > 待客語氣/u);
    assert.match(instructions, /assistant 歷史回答都不是飯店事實/u);
    assert.match(instructions, /recommendation 絕不可改寫為必須/u);
    assert.match(instructions, /orderCheckInCutoff/u);
  }
  const voice = voiceInstructions();
  assert.match(voice, /正式飯店知識 > 對話 topic\/state > 對話歷史 > 推理 > 待客語氣/u);
  assert.match(voice, /assistant 歷史回答都不是飯店事實/u);
  assert.match(voice, /recommendation 絕不可改寫為必須/u);
  assert.match(voice, /orderCheckInCutoff/u);
});
