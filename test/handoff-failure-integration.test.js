import test from "node:test";
import assert from "node:assert/strict";
import handoffHandler from "../api/handoff.js";
import { answerGuestMessage } from "../ai-core/guest-response.js";
import { processLineEvent } from "../api/line/webhook.js";

const FALSE_SUCCESS = /已留言|已通知|已送出|已經幫您.*留言/u;
const FAILURE = /沒辦法成功把留言送到櫃台.*04-2707-8378.*07:00–22:00/u;

function responseRecorder() {
  const result = {};
  return { result, res: { setHeader() {}, status(status) { result.status = status; return this; }, json(body) { result.body = body; return this; } } };
}

test("WEB explicit handoff never reports success when email delivery fails", async () => {
  const answer = await answerGuestMessage("請幫我留言給櫃台，我要客訴", {
    channel: "web", handoffService: options => import("../ai-core/handoff-service.js").then(({ performHandoff }) => performHandoff(options, { send: async () => { throw new Error("resend failed"); } }))
  });
  assert.match(answer, FAILURE);
  assert.doesNotMatch(answer, FALSE_SUCCESS);
});

test("LINE actual reply text is deterministic failure wording after Resend failure", async () => {
  const oldFetch = global.fetch;
  const oldKey = process.env.RESEND_API_KEY;
  const replies = [];
  process.env.RESEND_API_KEY = "resend-key";
  global.fetch = async () => { throw new Error("resend rejected"); };
  try {
    await processLineEvent({ webhookEventId: `failure-${Date.now()}`, type: "message", replyToken: "reply", message: { type: "text", text: "請幫我留言給櫃台，我要客訴" } }, {
      accessToken: "line-token", fetchImpl: async (_url, options) => { replies.push(JSON.parse(options.body).messages[0].text); return { ok: true }; }
    });
  } finally { global.fetch = oldFetch; if (oldKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = oldKey; }
  assert.match(replies[0], FAILURE);
  assert.doesNotMatch(replies[0], FALSE_SUCCESS);
});

async function callHandoff({ apiKey, fetchImpl, immediateTimers = false }) {
  const oldKey = process.env.RESEND_API_KEY;
  const oldFetch = global.fetch;
  const oldSetTimeout = global.setTimeout;
  if (apiKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = apiKey;
  global.fetch = fetchImpl;
  if (immediateTimers) global.setTimeout = callback => (queueMicrotask(callback), 1);
  const { result, res } = responseRecorder();
  try { await handoffHandler({ method: "POST", body: { channel: "voice", message: "請幫我留言給櫃台，我要客訴" } }, res); }
  finally { global.fetch = oldFetch; global.setTimeout = oldSetTimeout; if (oldKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = oldKey; }
  return result;
}

test("/api/handoff missing key returns delivered false and deterministic answer", async () => {
  const result = await callHandoff({ apiKey: undefined, fetchImpl: async () => assert.fail("must not fetch") });
  assert.equal(result.body.delivered, false); assert.match(result.body.answer, FAILURE);
});

test("/api/handoff upstream rejection returns delivered false and deterministic answer", async () => {
  const result = await callHandoff({ apiKey: "key", fetchImpl: async () => { throw new Error("network"); } });
  assert.equal(result.body.delivered, false); assert.match(result.body.answer, FAILURE);
});

test("/api/handoff timeout returns delivered false and deterministic answer", async () => {
  const result = await callHandoff({ apiKey: "key", immediateTimers: true, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error(), { name: "AbortError" })))) });
  assert.equal(result.body.delivered, false); assert.match(result.body.answer, FAILURE);
});
