import test from "node:test";
import assert from "node:assert/strict";
import { hotelKnowledge, KNOWLEDGE_VERSION } from "../ai-core/knowledge.js";
import { answerGuestMessage, responsesPayload } from "../ai-core/guest-response.js";
import { factualContract, resolveKnowledgeGrounding } from "../ai-core/knowledge-grounding.js";
import { voiceInstructions } from "../api/realtime.js";

const noHandoff = async () => ({ attempted: false });
const temporal = date => ({
  date, time: "12:00:00", timeZone: "Asia/Taipei", weekday: "Sunday",
  instant: `${date}T04:00:00.000Z`, frontDesk: { opens: "07:00", closes: "22:00", isOpen: true }
});

async function answer(message, date = "2026-08-23", channel = "web") {
  return answerGuestMessage(message, { channel, temporalContext: temporal(date), handoffService: noHandoff });
}

test("knowledge V2.3 contains only the confirmed public subsidy rules", () => {
  assert.equal(KNOWLEDGE_VERSION, "2.3");
  const subsidy = hotelKnowledge.governmentSubsidy2026;
  assert.deepEqual(subsidy.period, {
    startsOn: "2026-09-01", endsOn: "2026-11-30",
    earlyEndRule: "政府活動經費用罄時可能提前結束。"
  });
  assert.equal(subsidy.participationLimit.perPerson, 1);
  assert.equal(subsidy.weekdayStayAward.firstNight, "NT$800");
  assert.equal(subsidy.weekdayStayAward.consecutiveSecondNight, "NT$1,200");
  assert.equal(subsidy.weekdayStayAward.thirdNight, null);
  assert.equal(subsidy.birthdayVoucher.birthdayRelated, false);
  assert.equal(subsidy.taiwanPass.amountPerRoomPerNight, "NT$1,500");
  assert.equal(subsidy.stacking.allThreeTogetherAllowed, true);
  assert.doesNotMatch(JSON.stringify(subsidy), /隔天中午|小於 1MB|臺灣旅宿網|A4 影印|發票號碼/u);
});

test("subsidy topic has an authoritative intent contract", () => {
  const grounding = resolveKnowledgeGrounding("政府住宿補助有多少？");
  assert.equal(grounding.topic, "subsidy");
  assert.equal(grounding.intent, "subsidy_amount");
  assert.equal(grounding.facts.governmentSubsidy2026.weekdayStayAward.maximumForTwoNightStay, "NT$2,000");
  assert.deepEqual(grounding.contract, factualContract("subsidy", "subsidy_amount"));
  assert.match(grounding.contract.requiredFactIds.join(" "), /weekdayStayAward/u);
});

test("whole-sentence semantics prevent subsidy discounts from being routed to parking", async () => {
  const message = "哈囉～9/14是我們連續住宿的第二天，我看國旅補助第二天是折抵1200$，這樣我需要提供你們前一天住宿的證明嗎～";
  const grounding = resolveKnowledgeGrounding(message);
  assert.equal(grounding.topic, "subsidy");
  assert.equal(grounding.intent, "subsidy_documentation");
  assert.equal(grounding.facts.governmentSubsidy2026.requiredPreviousNightProof, null);

  for (const channel of ["web", "line", "messenger"]) {
    const result = await answerGuestMessage(message, {
      channel, temporalContext: temporal("2026-08-28"), handoffService: noHandoff
    });
    assert.match(result, /第二晚.*第一晚住宿證明.*目前.*沒有確認/u, channel);
    assert.match(result, /櫃檯.*政府活動系統.*最新規定/u, channel);
    assert.doesNotMatch(result, /車牌|停車場|停妥|停好車/u, channel);
  }
});

test("ambiguous discount wording needs a real topic from the sentence or conversation", () => {
  assert.equal(resolveKnowledgeGrounding("折抵要怎麼辦理？").topic, null);

  const parking = resolveKnowledgeGrounding("那折抵要怎麼辦理？", [
    { role: "user", content: "我的車已經停好了" }
  ]);
  assert.equal(parking.topic, "parking");
  assert.equal(parking.intent, "parking_process");

  const subsidy = resolveKnowledgeGrounding("那折抵要怎麼辦理？", [
    { role: "user", content: "我想參加國旅補助" }
  ]);
  assert.equal(subsidy.topic, "subsidy");
  assert.equal(subsidy.intent, "subsidy_registration");

  assert.equal(resolveKnowledgeGrounding("信用卡折抵有嗎？").topic, "payment");
});

test("messages with two explicit topics preserve both for semantic reasoning", () => {
  const grounding = resolveKnowledgeGrounding("國旅補助跟停車折抵是一樣的嗎？");
  assert.equal(grounding.topic, "multi");
  assert.equal(grounding.intent, "multiple");
  assert.deepEqual(grounding.topics, ["parking", "subsidy"]);
  assert.ok(grounding.facts.parking);
  assert.ok(grounding.facts.governmentSubsidy2026);
  assert.match(grounding.contract.coveragePolicy, /every explicit topic/u);
});

test("activity wording follows the authoritative Asia/Taipei date", async () => {
  const upcoming = await answer("飯店有政府住宿補助嗎？", "2026-08-23");
  assert.match(upcoming, /將於 2026 年 9 月 1 日起參加/u);
  assert.doesNotMatch(upcoming, /目前有參加/u);

  const upcomingAmount = await answer("平日住宿補助可以折多少？", "2026-08-23");
  assert.match(upcomingAmount, /將於 2026 年 9 月 1 日起參加/u);
  assert.match(upcomingAmount, /第一晚折抵 NT\$800/u);

  const active = await answer("飯店有政府住宿補助嗎？", "2026-10-15");
  assert.match(active, /目前有參加/u);

  const ended = await answer("飯店有政府住宿補助嗎？", "2026-12-01");
  assert.match(ended, /已於 11 月 30 日結束/u);
  assert.match(ended, /政府最新公告/u);

  const endedChannel = await answer("Agoda 訂房可以使用住宿補助嗎？", "2026-12-01");
  assert.match(endedChannel, /已於 11 月 30 日結束/u);
  assert.match(endedChannel, /Agoda.*不能使用/u);
});

test("amount, participation limit, and OTA boundaries are deterministic", async () => {
  const amount = await answer("平日住宿補助可以折多少？");
  assert.match(amount, /第一晚折抵 NT\$800/u);
  assert.match(amount, /第二晚折抵 NT\$1,200/u);
  assert.match(amount, /兩晚最高 NT\$2,000/u);

  const once = await answer("住宿補助每個人可以參加幾次？");
  assert.match(once, /每位旅客.*限參與一次/u);
  assert.match(once, /同一次連續住宿.*第一晚.*第二晚/u);

  for (const platform of ["Agoda", "Booking.com"]) {
    const ota = await answer(`${platform} 訂房可以使用住宿補助嗎？`);
    assert.match(ota, new RegExp(platform.replace(".", "\\."), "u"));
    assert.match(ota, /不能使用/u);
    assert.match(ota, /官網、電話、LINE 或現場/u);
    assert.doesNotMatch(ota, /^(?:可以的|當然可以|沒問題)/u);
  }
});

test("voucher acquisition, Taiwan PASS, and stacking cap stay explicit", async () => {
  const birthday = await answer("壽星生日券一定要生日才能用嗎？");
  assert.match(birthday, /與旅客生日無關/u);
  assert.match(birthday, /參加活動抽獎並中獎/u);
  assert.match(birthday, /每房可折抵 NT\$1,200/u);

  const pass = await answer("Taiwan PASS 住宿券多少錢？");
  assert.match(pass, /每房每晚折抵 NT\$1,500/u);

  const stacking = await answer("平日補助、生日券跟 Taiwan PASS 可以三項一起用嗎？");
  assert.match(stacking, /三項可以同時疊加/u);
  assert.match(stacking, /不得超過當天實際全額房價/u);
  assert.match(stacking, /不能退現、找現或保留/u);
});

test("registration protects identity data and unknown third-night rules remain unknown", async () => {
  const registration = await answer("住宿補助要怎麼用 QR Code 登錄？");
  assert.match(registration, /政府活動官方網站/u);
  assert.match(registration, /不要.*聊天中傳送證件照片、身分證字號或健保卡資料/u);

  const unknown = await answer("住宿補助第三晚還有嗎？");
  assert.match(unknown, /沒有確認到正確資料/u);
  assert.match(unknown, /04-2707-8378.*幫我轉接櫃檯/u);
  assert.doesNotMatch(unknown, /第三晚.*NT\$/u);
});

test("Web, LINE, Messenger, and Voice share the same subsidy facts", async () => {
  for (const channel of ["web", "line", "messenger", "voice"]) {
    const result = await answer("平日補助、生日券跟 Taiwan PASS 可以三項一起用嗎？", "2026-10-15", channel);
    assert.match(result, /三項可以同時疊加/u, channel);
    assert.match(result, /當天實際全額房價/u, channel);
    assert.match(result, /不能退現、找現或保留/u, channel);
  }
});

test("text and Realtime Voice receive the same subsidy and privacy contract", () => {
  const prompt = responsesPayload("政府住宿補助怎麼申請？", [], "line", temporal("2026-08-23")).instructions;
  const voice = voiceInstructions(temporal("2026-08-23"));
  for (const instructions of [prompt, voice]) {
    assert.match(instructions, /governmentSubsidy2026/u);
    assert.match(instructions, /2026-08-23/u);
    assert.match(instructions, /不得.*索取證件或個資/u);
    assert.match(instructions, /不得揭露內部核銷 SOP/u);
    assert.doesNotMatch(instructions, /隔天中午 12:00|小於 1MB|A4 影印/u);
  }
});
