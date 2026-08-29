import test from "node:test";
import assert from "node:assert/strict";
import {
  answerGuestMessage, composeGroundedPresentation, groundedPresentationPayload
} from "../ai-core/guest-response.js";
import { resolveKnowledgeGrounding } from "../ai-core/knowledge-grounding.js";

const silentLogger = { info() {} };

test("screenshot parking questions use speech-act-matched fallback openings", async () => {
  const options = { env: { AI_FIRST_ORCHESTRATOR_ENABLED: "false" }, logger: silentLogger };
  const location = await answerGuestMessage("我不知道要停哪裡。", options);
  const fee = await answerGuestMessage("停車需要費用嗎？", options);

  assert.match(location, /^如果您現在不確定要停哪裡/u);
  assert.match(location, /門口的 3 個路邊停車格.*步行約 3 分鐘.*青海路全國電子逢甲店隔壁/u);
  assert.match(fee, /^每間客房可免費停 1 台車/u);
  assert.match(fee, /第 2 台車.*NT\$200/u);
  assert.doesNotMatch(`${location}\n${fee}`, /^(?:可以喔|可以的|當然可以|沒問題)/mu);
});

test("known hotel facts are composed by Terra when the API is available", async () => {
  const grounding = resolveKnowledgeGrounding("停車需要費用嗎？");
  let payload;
  const answer = await answerGuestMessage("停車需要費用嗎？", {
    grounding,
    env: { OPENAI_API_KEY: "server-secret", AI_FIRST_ORCHESTRATOR_ENABLED: "false" },
    logger: silentLogger,
    request: async options => {
      payload = options.payload;
      const generated = "每間客房可免費停 1 台車；若有第 2 台車，停車費是 NT$200。";
      assert.equal(options.validate(generated), true);
      return { answer: generated };
    }
  });

  assert.equal(payload.model, "gpt-5.6-terra");
  assert.equal(payload.reasoning.effort, "medium");
  assert.match(payload.instructions, /cost question must state the fee first/u);
  assert.match(payload.instructions, /Never begin with 可以/u);
  assert.equal(answer, "每間客房可免費停 1 台車；若有第 2 台車，停車費是 NT$200。");
});

test("a model failure falls back to the verified intent-aware draft", async () => {
  const grounding = resolveKnowledgeGrounding("我不知道要停哪裡。");
  const draft = "如果您現在不確定要停哪裡，可以先停飯店門口的 3 個路邊停車格。";
  const answer = await composeGroundedPresentation({
    message: "我不知道要停哪裡。",
    grounding,
    draft,
    env: { OPENAI_API_KEY: "server-secret" },
    logger: silentLogger,
    request: async () => { throw new Error("timeout"); }
  });
  assert.equal(answer, draft);
});

test("a factually correct but irrelevant permission opening is rejected", async () => {
  const grounding = resolveKnowledgeGrounding("停車需要費用嗎？");
  const draft = "每間客房可免費停 1 台車；第 2 台車加收 NT$200 停車費。";
  const answer = await composeGroundedPresentation({
    message: "停車需要費用嗎？",
    grounding,
    draft,
    env: { OPENAI_API_KEY: "server-secret" },
    logger: silentLogger,
    request: async options => {
      const invalid = "可以喔～每間客房可免費停 1 台車；第 2 台車加收 NT$200 停車費。";
      assert.equal(options.validate(invalid), false);
      throw new Error("grounding_violation");
    }
  });
  assert.equal(answer, draft);
});

test("presentation payload contains only selected grounding and the verified draft", () => {
  const grounding = resolveKnowledgeGrounding("停車需要費用嗎？");
  const payload = groundedPresentationPayload({
    message: "停車需要費用嗎？",
    grounding,
    draft: "每間客房可免費停 1 台車；第 2 台車加收 NT$200 停車費。",
    env: {}
  });
  const input = JSON.parse(payload.input);
  assert.equal(input.intent, "parking_fee");
  assert.equal(input.grounded_facts.parking.additionalCarFee, "NT$200");
  assert.equal(payload.input.includes("frontDeskPhone"), false);
  assert.equal(payload.input.includes("partnerLots"), false);
});

test("unconfirmed hotel details use one concise phone-or-message reply", async () => {
  for (const question of ["房內有熨斗嗎？", "有機場接駁服務嗎？", "家庭房有浴缸嗎？", "小朋友早餐多少錢？"]) {
    const answer = await answerGuestMessage(question, { env: {}, logger: silentLogger });
    assert.match(answer, /^不好意思，這個問題我目前沒有確認到正確資料/u, question);
    assert.match(answer, /櫃檯電話 04-2707-8378/u, question);
    assert.match(answer, /回覆「幫我轉接櫃檯」/u, question);
    assert.doesNotMatch(answer, /知識庫|資料庫|已通知|已轉接/u, question);
  }
});
