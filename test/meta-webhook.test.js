import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import handler, { metaConfiguration } from "../api/meta/webhook.js";
import legacyHandler, { config as legacyConfig } from "../api/meta-webhook.js";
import { config as canonicalConfig } from "../api/meta/webhook.js";
import { instagramEvents, metaMessagingEvents, processMetaEvent } from "../api/meta/adapter.js";
import { validMetaSignature } from "../api/meta/security.js";
import { metaConversationId } from "../ai-core/conversation/record.js";
import { ConversationService } from "../ai-core/conversation/service.js";
import { ConversationConflictError, ConversationStore } from "../ai-core/conversation/store.js";
import { performAuthorizedHandoff } from "../ai-core/handoff-service.js";

class MemoryStore extends ConversationStore {
  constructor() { super(); this.records = new Map(); this.claims = new Set(); this.keys = []; }
  async get(id) { this.keys.push(id); return structuredClone(this.records.get(id) || null); }
  async compareAndSet(id, expected, record) {
    const current = this.records.get(id); if ((current?.revision ?? -1) !== expected) throw new ConversationConflictError();
    const saved = structuredClone(record); saved.revision = expected + 1; this.records.set(id, saved); return true;
  }
  async claimIdempotencyKey(scope, key) { this.keys.push(`${scope}:${key}`); const id = `${scope}:${key}`; if (this.claims.has(id)) return false; this.claims.add(id); return true; }
}

const metaEvent = (overrides = {}) => ({
  pageId: "page-123", event: { sender: { id: "psid-private-456" }, recipient: { id: "page-123" }, timestamp: 1,
    message: { mid: "m_private_mid", text: "停車要收費嗎？" }, ...overrides }
});

function recorder() { return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } }; }
function signedRequest(payload, secret = "app-secret") { const rawBody = Buffer.from(JSON.stringify(payload)); return { method: "POST", rawBody, headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}` } }; }

async function environment(t) {
  const names = ["META_WEBHOOK_VERIFY_TOKEN", "META_APP_SECRET", "META_PAGE_ACCESS_TOKEN", "META_INSTAGRAM_ACCESS_TOKEN", "CONVERSATION_HMAC_SECRET", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
  const old = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { META_WEBHOOK_VERIFY_TOKEN: "verify-secret", META_APP_SECRET: "app-secret", META_PAGE_ACCESS_TOKEN: "page-token", META_INSTAGRAM_ACCESS_TOKEN: "instagram-token", CONVERSATION_HMAC_SECRET: "identity-secret", UPSTASH_REDIS_REST_URL: "https://redis.invalid", UPSTASH_REDIS_REST_TOKEN: "redis-token" });
  t.after(() => names.forEach(name => old[name] === undefined ? delete process.env[name] : process.env[name] = old[name]));
}

test("Meta GET verification accepts the configured token and rejects a wrong token", async t => {
  await environment(t);
  const good = recorder(); await handler({ method: "GET", query: { "hub.mode": "subscribe", "hub.verify_token": "verify-secret", "hub.challenge": "challenge-42" } }, good);
  assert.equal(good.statusCode, 200); assert.equal(good.body, "challenge-42");
  const bad = recorder(); await handler({ method: "GET", query: { "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "challenge-42" } }, bad);
  assert.equal(bad.statusCode, 403); assert.equal(bad.body.diagnostic.code, "invalid_verification");
});

test("legacy Meta callback delegates to the production handler with raw body parsing", async t => {
  await environment(t);
  assert.equal(legacyHandler, handler);
  assert.deepEqual(legacyConfig, canonicalConfig);
  assert.equal(legacyConfig.api.bodyParser, false);

  const payload = { object: "page", entry: [] };
  const response = recorder();
  await legacyHandler(signedRequest(payload), response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true, processed: 0, ignored: 0, duplicates: 0 });
});

test("Meta POST signature uses x-hub-signature-256 and rejects tampering", () => {
  const body = Buffer.from('{"object":"page"}'); const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
  assert.equal(validMetaSignature(body, signature, "secret"), true); assert.equal(validMetaSignature(Buffer.from("tampered"), signature, "secret"), false);
});

test("valid signed empty POST is accepted and invalid signature is rejected", async t => {
  await environment(t); const payload = { object: "page", entry: [] };
  const valid = recorder(); await handler(signedRequest(payload), valid); assert.equal(valid.statusCode, 200);
  const invalidReq = signedRequest(payload); invalidReq.headers["x-hub-signature-256"] = "sha256=bad";
  const invalid = recorder(); await handler(invalidReq, invalid); assert.equal(invalid.statusCode, 401);
});

test("signed Instagram POST shares Meta verification and filters account-originated echoes", async t => {
  await environment(t);
  const payload = { object: "instagram", entry: [{ id: "ig-account", messaging: [{ sender: { id: "ig-account" }, recipient: { id: "ig-user" }, message: { mid: "echo-mid", text: "echo" } }] }] };
  assert.equal(instagramEvents(payload)[0].channel, "instagram");
  assert.equal(metaMessagingEvents(payload).length, 1);
  const response = recorder(); await handler(signedRequest(payload), response);
  assert.equal(response.statusCode, 200); assert.deepEqual(response.body, { ok: true, processed: 0, ignored: 1, duplicates: 0 });
});

test("Messenger identity is stable, separated by sender and platform, and opaque", () => {
  const input = { platform: "messenger", pageId: "page", senderId: "raw-private-id" };
  const id = metaConversationId(input, "secret"); assert.equal(id, metaConversationId(input, "secret"));
  assert.notEqual(id, metaConversationId({ ...input, senderId: "someone-else" }, "secret"));
  assert.notEqual(id.slice(id.indexOf("_") + 1), metaConversationId({ ...input, platform: "instagram" }, "secret").split("_")[1]);
  assert.doesNotMatch(id, /raw-private-id/);
});

test("text events use durable shared runtime, redact IDs from keys/logs, and dedupe mid", async () => {
  const store = new MemoryStore(); const service = new ConversationService({ store }); const logs = []; let answers = 0; let sends = 0;
  const options = { conversationService: service, hmacSecret: "secret", accessToken: "token",
    answer: async (message, { history, channel }) => { answers++; assert.equal(channel, "messenger"); return `${history.at(-1)?.content || "start"}|${message}`; },
    send: async ({ recipientId, text }) => { sends++; assert.equal(recipientId, "psid-private-456"); assert.match(text, /停車/); },
    logger: { info: (...args) => logs.push(args) } };
  assert.equal((await processMetaEvent(metaEvent(), options)).outcome, "replied");
  assert.equal((await processMetaEvent(metaEvent(), options)).outcome, "duplicate");
  assert.equal(answers, 1); assert.equal(sends, 1);
  assert.doesNotMatch(JSON.stringify([store.keys, logs]), /psid-private-456|m_private_mid/);
});

test("echo and page-generated events cannot trigger an answer or send", async () => {
  let called = 0; const options = { answer: async () => called++, send: async () => called++ };
  assert.equal((await processMetaEvent(metaEvent({ message: { mid: "echo", text: "bot", is_echo: true } }), options)).outcome, "ignored");
  assert.equal((await processMetaEvent(metaEvent({ sender: { id: "page-123" }, recipient: { id: "user" }, message: { mid: "page", text: "bot" } }), options)).outcome, "ignored");
  assert.equal(called, 0);
});

test("Instagram text DM uses shared conversation runtime, isolated identity, and channel-scoped dedupe", async () => {
  const store = new MemoryStore(); const service = new ConversationService({ store }); let answers = 0; let sends = 0;
  const event = { channel: "instagram", accountId: "ig-account", event: { sender: { id: "shared-raw-user" }, recipient: { id: "ig-account" }, message: { mid: "ig-mid", text: "停車要收費嗎？" } } };
  const options = { conversationService: service, hmacSecret: "secret", accessToken: "ig-token", logger: { info() {} },
    answer: async (message, { channel }) => { answers++; assert.equal(channel, "instagram"); return `shared:${message}`; },
    send: async ({ recipientId, text, accessToken }) => { sends++; assert.equal(recipientId, "shared-raw-user"); assert.equal(accessToken, "ig-token"); assert.match(text, /^shared:/); } };
  const first = await processMetaEvent(event, options); const duplicate = await processMetaEvent(event, options);
  assert.equal(first.outcome, "replied"); assert.equal(duplicate.outcome, "duplicate"); assert.equal(answers, 1); assert.equal(sends, 1);
  const messengerId = metaConversationId({ platform: "messenger", pageId: "ig-account", senderId: "shared-raw-user" }, "secret");
  assert.notEqual(first.conversationId, messengerId);
});

test("Instagram ignores echoes and unsupported events before AI", async () => {
  let calls = 0; const invoke = event => processMetaEvent({ channel: "instagram", accountId: "ig-account", event }, { answer: async () => calls++, send: async () => calls++ });
  assert.equal((await invoke({ sender: { id: "guest" }, message: { mid: "echo", text: "x", is_echo: true } })).outcome, "ignored");
  assert.equal((await invoke({ sender: { id: "ig-account" }, message: { mid: "page", text: "x" } })).outcome, "ignored");
  assert.equal((await invoke({ sender: { id: "guest" }, message: { mid: "image", attachments: [{}] } })).outcome, "ignored");
  assert.equal(calls, 0);
});

test("Instagram uses the same grounded answer semantics as Messenger, LINE and Web", async () => {
  const answers = [];
  for (const channel of ["instagram", "messenger", "line", "web"]) {
    const service = new ConversationService({ store: new MemoryStore() });
    const { answerWithConversation } = await import("../ai-core/conversation/runtime.js");
    answers.push((await answerWithConversation({ id: `${channel}_grounding`, channel, message: "停車要收費嗎？", service })).answer);
  }
  for (const answer of answers) { assert.match(answer, /免費/); assert.match(answer, /第 2 台車/); }
});

test("Instagram durable handoff requires fields and exact final confirmation, then shares executor truth", async () => {
  const run = async delivered => {
    const service = new ConversationService({ store: new MemoryStore() }); let emailAttempts = 0; const replies = [];
    const handoffService = (request, { authorization }) => performAuthorizedHandoff(request, { authorization }, { send: async () => { emailAttempts++; if (!delivered) throw new Error("mail unavailable"); } });
    const answer = async (message, options) => (await options.handoffService({ message, history: options.history, channel: options.channel, identity: options.identity })).answer;
    for (const [index, text] of ["請幫我取消訂房", "王小明 0912-345-678", "OK", "確認送出"].entries()) {
      const result = await processMetaEvent({ channel: "instagram", accountId: "ig-account", event: { sender: { id: "ig-user" }, message: { mid: `handoff-${delivered}-${index}`, text } } },
        { conversationService: service, hmacSecret: "secret", accessToken: "token", answer, handoffService, send: async ({ text: reply }) => replies.push(reply), logger: { info() {} } });
      assert.equal(result.outcome, "replied");
    }
    assert.equal(emailAttempts, 1); assert.match(replies[0], /姓名/); assert.match(replies[1], /確認送出/); assert.match(replies[2], /確認送出/);
    return replies.at(-1);
  };
  assert.match(await run(true), /已成功送交櫃檯/);
  const failed = await run(false); assert.match(failed, /沒辦法成功/); assert.doesNotMatch(failed, /已成功送交/);
});

test("short follow-ups retain late-arrival and parking context through shared memory", async () => {
  for (const messages of [["我今天晚上10點半才會到，可以嗎？", "那11點呢？", "那如果更晚呢？"], ["停車要收費嗎？", "那第二台呢？", "那我要停哪？"]]) {
    const store = new MemoryStore(); const service = new ConversationService({ store }); const seen = [];
    for (let i = 0; i < messages.length; i++) await processMetaEvent(metaEvent({ message: { mid: `m-${i}`, text: messages[i] } }), {
      conversationService: service, hmacSecret: "secret", accessToken: "token", send: async () => {}, logger: { info() {} },
      answer: async (message, { history }) => { seen.push({ message, history: history.map(turn => turn.content) }); return `answer-${i}`; }
    });
    assert.deepEqual(seen[2].history, [messages[0], "answer-0", messages[1], "answer-1"]);
  }
});

test("Meta fails closed for missing credentials and unavailable durable memory", async () => {
  assert.ok(metaConfiguration({}).missing.length >= 6);
  const unavailable = { store: { claimIdempotencyKey: async () => { throw new Error("redis down"); } } };
  await assert.rejects(processMetaEvent(metaEvent(), { conversationService: unavailable, hmacSecret: "secret", accessToken: "token", logger: { info() {} } }), /meta_memory_unavailable/);
});

test("Messenger prose or consent cannot bypass durable handoff confirmation", async () => {
  let sends = 0;
  for (const state of [null, "handoff_offered", "consent_received", "ready_for_confirmation"]) {
    const result = await performAuthorizedHandoff(
      { message: "麻煩你通知櫃檯，我確認要修改訂房", channel: "messenger" },
      { authorization: state ? { state } : null }, { send: async () => sends++ }
    );
    assert.equal(result.authorized, false); assert.match(result.answer, /目前尚未送出/);
  }
  assert.equal(sends, 0);
});

test("Messenger adapter contains no hotel facts or channel-specific handoff rules", async () => {
  const source = await import("node:fs/promises").then(fs => fs.readFile(new URL("../api/meta/adapter.js", import.meta.url), "utf8"));
  assert.match(source, /answerWithConversation/); assert.doesNotMatch(source, /NT\$|早餐|10點半|handoff_offered|ready_for_confirmation/u);
});

test("Instagram adapter is transport-only and contains no personality or Email business logic", async () => {
  const source = await import("node:fs/promises").then(fs => fs.readFile(new URL("../api/meta/adapter.js", import.meta.url), "utf8"));
  assert.match(source, /answerWithConversation/); assert.doesNotMatch(source, /hospitality|personality|sendEmail|確認送出|姓名|電話|Email executor/iu);
});
