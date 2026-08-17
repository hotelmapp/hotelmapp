import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import handler, { processLineEvent, validLineSignature } from "../api/line/webhook.js";

function recorder() {
  return {
    statusCode: 200, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function signedRequest(payload, secret = "line-secret") {
  const rawBody = Buffer.from(JSON.stringify(payload));
  return {
    method: "POST", rawBody,
    headers: { "x-line-signature": createHmac("sha256", secret).update(rawBody).digest("base64") }
  };
}

function redisOr(fallback) {
  return async (url, options) => {
    if (url === "https://redis.example") {
      const command = JSON.parse(options.body);
      const result = command[0] === "GET" ? null : command[0] === "EVAL" ? 1 : "OK";
      return new Response(JSON.stringify({ result }), { status: 200 });
    }
    return fallback(url, options);
  };
}

async function withConfig(t) {
  const previous = { secret: process.env.LINE_CHANNEL_SECRET, token: process.env.LINE_CHANNEL_ACCESS_TOKEN, key: process.env.OPENAI_API_KEY, hmac: process.env.CONVERSATION_HMAC_SECRET, redisUrl: process.env.UPSTASH_REDIS_REST_URL, redisToken: process.env.UPSTASH_REDIS_REST_TOKEN, fetch: globalThis.fetch };
  process.env.LINE_CHANNEL_SECRET = "line-secret";
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "line-access-token";
  process.env.OPENAI_API_KEY = "openai-secret";
  process.env.CONVERSATION_HMAC_SECRET = "conversation-secret";
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
  process.env.UPSTASH_REDIS_REST_TOKEN = "redis-token";
  t.after(() => {
    for (const [name, value] of [["LINE_CHANNEL_SECRET", previous.secret], ["LINE_CHANNEL_ACCESS_TOKEN", previous.token], ["OPENAI_API_KEY", previous.key], ["CONVERSATION_HMAC_SECRET", previous.hmac], ["UPSTASH_REDIS_REST_URL", previous.redisUrl], ["UPSTASH_REDIS_REST_TOKEN", previous.redisToken]]) value === undefined ? delete process.env[name] : process.env[name] = value;
    globalThis.fetch = previous.fetch;
  });
}

test("validates LINE HMAC-SHA256 signatures", () => {
  const body = Buffer.from('{"events":[]}');
  const signature = createHmac("sha256", "secret").update(body).digest("base64");
  assert.equal(validLineSignature(body, signature, "secret"), true);
  assert.equal(validLineSignature(body, "invalid", "secret"), false);
});

test("rejects an invalid webhook signature", async t => {
  await withConfig(t);
  const req = signedRequest({ events: [] });
  req.headers["x-line-signature"] = "invalid";
  const res = recorder();
  await handler(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.diagnostic.code, "invalid_signature");
});

test("fails safely when LINE configuration is missing", async t => {
  await withConfig(t);
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const res = recorder();
  await handler(signedRequest({ events: [] }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.diagnostic.code, "missing_configuration");
  assert.doesNotMatch(JSON.stringify(res.body), /line-secret|line-access-token/u);
});

test("reports deployment configuration errors when durable memory identity or Redis is missing", async t => {
  await withConfig(t);
  delete process.env.CONVERSATION_HMAC_SECRET;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const res = recorder();
  await handler(signedRequest({ events: [{ type: "message", message: { type: "text", text: "10點半" }, replyToken: "r" }] }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.diagnostic.code, "missing_configuration");
});

test("accepts verification and empty-event webhooks without external calls", async t => {
  await withConfig(t);
  globalThis.fetch = async () => assert.fail("empty verification must not call an upstream API");
  const res = recorder();
  await handler(signedRequest({ destination: "channel", events: [] }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, processed: 0 });
});

test("answers a text event with shared breakfast knowledge", async t => {
  await withConfig(t);
  let reply;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.line.me/v2/bot/message/reply");
    reply = JSON.parse(options.body);
    return new Response("{}", { status: 200 });
  };
  const event = { webhookEventId: "breakfast-1", type: "message", replyToken: "reply-sensitive", message: { type: "text", text: "早餐是自助式嗎？" } };
  const result = await processLineEvent(event, { accessToken: "line-access-token" });
  assert.equal(result.outcome, "replied");
  assert.match(reply.messages[0].text, /Brunch 式套餐，一人一套/);
  assert.match(reply.messages[0].text, /咖啡.*自助式/);
});

test("does not guess an unknown child breakfast price", async t => {
  await withConfig(t);
  let text;
  globalThis.fetch = async (_url, options) => {
    text = JSON.parse(options.body).messages[0].text;
    return new Response("{}", { status: 200 });
  };
  await processLineEvent({ webhookEventId: "child-1", type: "message", replyToken: "r", message: { type: "text", text: "小朋友早餐多少錢？" } }, { accessToken: "token" });
  assert.match(text, /兒童早餐的價格.*沒有確認到/);
  assert.doesNotMatch(text, /NT\$\s*\d+/u);
});

test("reuses shared booking intent, date parsing, and dated official URL", async t => {
  await withConfig(t);
  let text;
  globalThis.fetch = async (_url, options) => { text = JSON.parse(options.body).messages[0].text; return new Response("{}", { status: 200 }); };
  await processLineEvent({ webhookEventId: "booking-1", type: "message", replyToken: "r", message: { type: "text", text: "我想 2026/8/20 入住兩晚" } }, { accessToken: "token" });
  assert.match(text, /checkInDate=2026-08-20/);
  assert.match(text, /checkOutDate=2026-08-22/);
  assert.doesNotMatch(text, /有空房/u);
});

test("ignores unsupported messages and processes multiple events", async t => {
  await withConfig(t);
  let replies = 0;
  globalThis.fetch = redisOr(async () => { replies += 1; return new Response("{}", { status: 200 }); });
  const res = recorder();
  await handler(signedRequest({ events: [
    { webhookEventId: "sticker-1", type: "message", replyToken: "secret-sticker-token", message: { type: "sticker", id: "1" } },
    { webhookEventId: "text-multi-1", type: "message", replyToken: "secret-text-token", source: { type: "user", userId: "U-multi" }, message: { type: "text", text: "早餐幾點？" } }
  ] }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.processed, 1);
  assert.equal(res.body.ignored, 1);
  assert.equal(replies, 1);
});

test("suppresses an obvious duplicate event in the current instance", async t => {
  await withConfig(t);
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response("{}", { status: 200 }); };
  const event = { webhookEventId: "duplicate-1", type: "message", replyToken: "r", message: { type: "text", text: "早餐在哪裡？" } };
  const claimed = new Set();
  const conversationService = { store: { claimIdempotencyKey: async (_scope, key) => claimed.has(key) ? false : (claimed.add(key), true) } };
  assert.equal((await processLineEvent(event, { accessToken: "token", conversationService })).outcome, "replied");
  assert.equal((await processLineEvent(event, { accessToken: "token", conversationService })).outcome, "duplicate");
  assert.equal(calls, 1);
});

test("returns safe diagnostics for OpenAI and LINE reply failures", async t => {
  await withConfig(t);
  globalThis.fetch = redisOr(async url => url.includes("openai.com")
    ? new Response(JSON.stringify({ error: { message: "openai-secret reply-sensitive", type: "server_error", code: "internal" } }), { status: 500 })
    : new Response(JSON.stringify({ message: "line-access-token reply-sensitive" }), { status: 500, headers: { "x-line-request-id": "line_req_1" } }));

  const aiRes = recorder();
  await handler(signedRequest({ events: [{ webhookEventId: "ai-fail-1", type: "message", replyToken: "reply-sensitive", source: { type: "user", userId: "U-ai" }, message: { type: "text", text: "飯店地址在哪裡？" } }] }), aiRes);
  assert.equal(aiRes.statusCode, 502);
  assert.equal(aiRes.body.diagnostic.source, "openai");

  const lineRes = recorder();
  await handler(signedRequest({ events: [{ webhookEventId: "line-fail-1", type: "message", replyToken: "reply-sensitive", source: { type: "user", userId: "U-line" }, message: { type: "text", text: "早餐幾點？" } }] }), lineRes);
  assert.equal(lineRes.statusCode, 502);
  assert.equal(lineRes.body.diagnostic.code, "reply_failed");
  const diagnostics = JSON.stringify([aiRes.body, lineRes.body]);
  assert.doesNotMatch(diagnostics, /openai-secret|line-secret|line-access-token|reply-sensitive/u);
});

test("LINE adapter contains no duplicated hotel knowledge or booking logic", async () => {
  const source = await import("node:fs/promises").then(fs => fs.readFile(new URL("../api/line/webhook.js", import.meta.url), "utf8"));
  assert.doesNotMatch(source, /08:00|NT\$150|book-directonline|checkInDate|childPrice/u);
  assert.match(source, /answerGuestMessage/);
});
