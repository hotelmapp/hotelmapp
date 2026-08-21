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
  assert.equal(parking.intent, "parking_fee");
  assert.equal(parking.facts.parking.feeRule, "每間客房提供 1 台免費停車；第 2 台車加收 NT$200 停車費。");
  const checkIn = resolveKnowledgeGrounding("那晚上十點後呢？", [{ role: "user", content: "幾點可以入住？" }]);
  assert.equal(checkIn.topic, "check_in");
  assert.match(checkIn.facts.stay.afterHoursCheckIn, /提前通知櫃檯取得自助入住密碼/u);
  const contact = resolveKnowledgeGrounding("那晚上十一點設備壞掉呢？", [{ role: "user", content: "櫃檯服務到幾點？" }]);
  assert.equal(contact.topic, "front_desk_contact");
  assert.match(contact.facts.contact.afterHoursEquipment, /0927-708-908/u);
});

test("parking intent selects fee, availability, process, and authoritative follow-up facts", async () => {
  const fee = await answerGuestMessage("停車要收費嗎？", { handoffService: noHandoff });
  assert.match(fee, /每間客房都有 1 台免費停車/u);
  assert.match(fee, /第 2 台車加收 NT\$200/u);
  assert.doesNotMatch(fee, /只有 3 個車位|先跟我們說一聲/u);

  const availability = await answerGuestMessage("飯店有停車位嗎？", { handoffService: noHandoff });
  assert.match(availability, /門口可停 3 台車/u);
  assert.match(availability, /停滿時.*配合停車場/u);

  const history = [
    { role: "user", content: "飯店有停車位嗎？" },
    { role: "assistant", content: "第二台也是免費的。" }
  ];
  const second = await answerGuestMessage("那第二台呢？", { history, handoffService: noHandoff });
  assert.match(second, /第 2 台車加收 NT\$200/u);
  assert.doesNotMatch(second, /第二台.*免費/u);

  const process = await answerGuestMessage("停好之後要怎麼辦？", { handoffService: noHandoff });
  assert.match(process, /告知櫃檯車牌號碼/u);
  assert.match(process, /櫃檯輸入辦理折抵/u);

  const reservation = await answerGuestMessage("可以幫我預留停車位嗎？", { handoffService: noHandoff });
  assert.match(reservation, /沒有提供預留/u);
  assert.match(reservation, /先到先停/u);
  assert.match(reservation, /公平使用/u);
  assert.match(reservation, /門口車位已滿.*現場狀況.*配合停車場/u);
  assert.doesNotMatch(reservation, /目前沒有確認|建議.*櫃檯確認/u);
});

test("Wi-Fi is grounded by room number with the confirmed password", async () => {
  const grounding = resolveKnowledgeGrounding("房間 WiFi 怎麼連？");
  assert.equal(grounding.topic, "wifi");
  assert.equal(grounding.facts.amenities.wifi.password, "00000000");
  assert.deepEqual(grounding.contract.requiredFactIds, ["amenities.wifi.network", "amenities.wifi.password", "amenities.wifi.passwordDescription"]);

  const chinese = await answerGuestMessage("房間 WiFi 怎麼連？", { handoffService: noHandoff });
  assert.match(chinese, /住宿房號相同/u);
  assert.match(chinese, /8 個 0：00000000/u);

  const english = await answerGuestMessage("What is the room Wi-Fi password?", { handoffService: noHandoff });
  assert.match(english, /matching your room number/i);
  assert.match(english, /Password: 00000000/i);
});

test("Web, LINE, and Voice expose the same parking intent contracts", async () => {
  const history = [{ role: "user", content: "飯店有停車位嗎？" }];
  for (const channel of ["web", "line"]) {
    const payload = responsesPayload("那第二台呢？", history, channel);
    assert.equal(payload.input.at(-1).content, "那第二台呢？");
    assert.match(payload.instructions, /parking_availability/u);
    assert.match(payload.instructions, /parking_fee/u);
    assert.match(payload.instructions, /parking_process/u);
    assert.match(payload.instructions, /parking_problem/u);
    assert.match(payload.instructions, /parking\.rules\[1\]/u);
    const answer = await answerGuestMessage("那第二台呢？", { history, channel, handoffService: noHandoff });
    assert.match(answer, /每間客房都有 1 台免費停車/u);
    assert.match(answer, /第 2 台車加收 NT\$200 停車費/u);
  }
  const voice = voiceInstructions();
  for (const intent of ["parking_availability", "parking_fee", "parking_process", "parking_problem"]) assert.match(voice, new RegExp(intent));
  assert.match(voice, /parking\.rules\[1\]/u);
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
