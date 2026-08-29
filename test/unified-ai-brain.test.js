import test from "node:test";
import assert from "node:assert/strict";
import { orchestrateHospitalityTurn } from "../ai-core/ai-orchestrator.js";
import { answerGuestMessage } from "../ai-core/guest-response.js";
import { resolveKnowledgeGrounding } from "../ai-core/knowledge-grounding.js";

const silentLogger = { info() {} };
const temporalContext = { date: "2026-08-29", timezone: "Asia/Taipei" };

function semanticallyGrounded(message) {
  return {
    ...resolveKnowledgeGrounding(message),
    semanticRoute: {
      currentNeed: "確認希堤微旅是否參加平日住宿補助",
      usedHistory: false,
      clarificationNeeded: false,
      handoff: { requested: false, category: null },
      routerVersion: "test"
    }
  };
}

test("the screenshot question is answered directly and concisely even without a model", async () => {
  for (const message of [
    "請問，你們沒有參加國旅補助嗎？",
    "請問你們有參加住宿補助嗎？",
    "所以飯店沒加入平日住宿補助嗎？"
  ]) {
    const grounding = resolveKnowledgeGrounding(message);
    assert.equal(grounding.intent, "subsidy_participation", message);
    const answer = await answerGuestMessage(message, {
      grounding,
      temporalContext,
      env: { AI_FIRST_ORCHESTRATOR_ENABLED: "false" },
      logger: silentLogger
    });
    assert.match(answer, /^您好～有參加喔，/u, message);
    assert.match(answer, /2026 年 9 月 1 日.*11 月 30 日/u, message);
    assert.doesNotMatch(answer, /第一晚|第二晚|每位旅客|額度與經費/u, message);
  }
});

test("one semantic plan feeds one unified composer instead of another intent decision", async () => {
  const message = "請問，你們沒有參加國旅補助嗎？";
  const calls = [];
  const result = await orchestrateHospitalityTurn({
    message,
    grounding: semanticallyGrounded(message),
    logger: silentLogger,
    request: async ({ payload }) => {
      calls.push(payload);
      return { answer: "有參加喔，希堤微旅將於 2026 年 9 月 1 日起參加平日住宿補助，活動至 11 月 30 日止。" };
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, undefined, "the prose call is not another JSON routing decision");
  assert.match(calls[0].instructions, /one unified answer composer/u);
  assert.equal(JSON.parse(calls[0].input).semantic_route.currentNeed, "確認希堤微旅是否參加平日住宿補助");
  assert.match(result.answer, /^有參加喔，/u);
});

test("an answer that misses the current need is corrected once before fallback", async () => {
  const message = "請問，你們沒有參加國旅補助嗎？";
  const answers = [
    "希堤微旅將於 2026 年 9 月 1 日起參加平日住宿補助，活動至 11 月 30 日止。",
    "有參加喔，活動從 2026 年 9 月 1 日開始，到 11 月 30 日為止。"
  ];
  const calls = [];
  const result = await orchestrateHospitalityTurn({
    message,
    grounding: semanticallyGrounded(message),
    logger: silentLogger,
    request: async ({ payload }) => {
      calls.push(payload);
      return { answer: answers.shift() };
    }
  });

  assert.equal(calls.length, 2);
  assert.match(calls[1].instructions, /current_need_not_answered_first/u);
  assert.match(result.answer, /^有參加喔，/u);
});

test("the unified brain remains channel-neutral", async () => {
  const message = "請問，你們沒有參加國旅補助嗎？";
  for (const channel of ["web", "line", "messenger"]) {
    const calls = [];
    await orchestrateHospitalityTurn({
      message,
      channel,
      grounding: semanticallyGrounded(message),
      logger: silentLogger,
      request: async ({ payload }) => {
        calls.push(payload);
        return { answer: "有參加喔，活動從 2026 年 9 月 1 日開始，到 11 月 30 日為止。" };
      }
    });
    assert.equal(calls.length, 1, channel);
    assert.equal(JSON.parse(calls[0].input).current_user_message, message, channel);
    assert.match(calls[0].instructions, new RegExp(`${channel === "line" ? "LINE" : channel === "messenger" ? "Messenger" : "Web"} 呈現`), channel);
  }
});

test("provider failure still answers every confirmed part of a multi-topic question", async () => {
  const message = "停車要收費嗎？早餐幾點？";
  const grounding = resolveKnowledgeGrounding(message);
  assert.equal(grounding.topic, "multi");
  const answer = await answerGuestMessage(message, {
    grounding,
    temporalContext,
    env: { AI_FIRST_ORCHESTRATOR_ENABLED: "false" },
    logger: silentLogger,
    request: async () => {
      throw new Error("provider_unavailable");
    }
  });

  assert.match(answer, /免費停 1 台車.*第 2 台車.*NT\$200/u);
  assert.match(answer, /早餐時間.*08:00–10:00/u);
});
