import test from "node:test";
import assert from "node:assert/strict";
import { TemporalContextProvider } from "../ai-core/temporal-context.js";
import { appendTurn, CONVERSATION_LIMITS, createConversationRecord, lineConversationId, minimizeConversationText, opaqueConversationId } from "../ai-core/conversation/record.js";
import { ConversationConflictError, ConversationStore } from "../ai-core/conversation/store.js";
import { ConversationService } from "../ai-core/conversation/service.js";
import { answerWithConversation } from "../ai-core/conversation/runtime.js";
import { processLineEvent } from "../api/line/webhook.js";

class DurableFakeStore extends ConversationStore {
  constructor(clock = { now: Date.parse("2026-08-16T00:00:00Z") }, limits = CONVERSATION_LIMITS) { super(); this.clock = clock; this.limits = limits; this.records = new Map(); this.dedupe = new Map(); }
  async get(id) { const value = this.records.get(id); if (!value || value.slidingUntil <= this.clock.now || Date.parse(value.record.expiresAt) <= this.clock.now) { this.records.delete(id); return null; } return structuredClone(value.record); }
  async compareAndSet(id, expected, record) { const current = await this.get(id); if ((current?.revision ?? -1) !== expected) throw new ConversationConflictError(); const saved = structuredClone(record); saved.revision = expected + 1; this.records.set(id, { record: saved, slidingUntil: Math.min(this.clock.now + this.limits.slidingTtlMs, Date.parse(saved.expiresAt)) }); return true; }
  async claimIdempotencyKey(scope, key, ttl = 600_000) { const id = `${scope}:${key}`; if ((this.dedupe.get(id) || 0) > this.clock.now) return false; this.dedupe.set(id, this.clock.now + ttl); return true; }
}

test("Asia/Taipei owns time and front desk boundary decisions", () => {
  const at = iso => new TemporalContextProvider({ now: () => new Date(iso) }).getContext();
  for (const [iso, time, open] of [["2026-08-15T22:59:00Z", "06:59", false], ["2026-08-15T23:00:00Z", "07:00", true], ["2026-08-16T13:59:00Z", "21:59", true], ["2026-08-16T14:00:00Z", "22:00", false]]) { const context = at(iso); assert.equal(context.time.slice(0, 5), time); assert.equal(context.frontDesk.isOpen, open); }
  const context = at("2026-08-16T14:00:00Z"); assert.equal(context.date, "2026-08-16"); assert.equal(context.weekday, "Sunday"); assert.equal(context.timeZone, "Asia/Taipei");
});

test("LINE identity is HMAC-derived and opaque channel identities are generated server-side", () => {
  const raw = "Udeadbeef-private-line-id"; const id = lineConversationId({ type: "user", userId: raw }, "server-side-secret");
  assert.match(id, /^line_[A-Za-z0-9_-]{43}$/); assert.doesNotMatch(id, new RegExp(raw)); assert.notEqual(id, lineConversationId({ type: "user", userId: raw }, "different-secret"));
  assert.match(opaqueConversationId("web"), /^web_/); assert.match(opaqueConversationId("voice"), /^voice_/);
});

test("record minimizes secrets, caps turns and enforces capacity", () => {
  let record = createConversationRecord({ id: "web_safe", channel: "web", now: new Date("2026-08-16T00:00:00Z") });
  for (let i = 0; i < 25; i++) record = appendTurn(record, { role: i % 2 ? "assistant" : "user", content: `turn-${i} card 4111 1111 1111 1111 password: hunter2` });
  assert.equal(record.turns.length, 20); assert.match(record.turns[0].content, /turn-5/); assert.doesNotMatch(JSON.stringify(record), /4111|hunter2/);
  assert.throws(() => appendTurn(createConversationRecord({ id: "web_big", channel: "web" }), { role: "user", content: "x".repeat(2_000) }, { limits: { ...CONVERSATION_LIMITS, maxRecordBytes: 100 } }), /conversation_record_too_large/);
  assert.equal(minimizeConversationText("me@example.com 0912-345-678 CVV 123"), "[redacted] [redacted] [redacted]");
});

test("sliding TTL refresh cannot extend absolute 48-hour lifetime", async () => {
  const clock = { now: Date.parse("2026-08-16T00:00:00Z") }; const store = new DurableFakeStore(clock); const service = new ConversationService({ store, now: () => new Date(clock.now) });
  await service.append("web_ttl", "web", [{ role: "user", content: "one" }]); clock.now += 23 * 60 * 60_000; assert.ok(await store.get("web_ttl"));
  await service.append("web_ttl", "web", [{ role: "assistant", content: "two" }]); clock.now += 23 * 60 * 60_000; assert.ok(await store.get("web_ttl")); clock.now += 2 * 60 * 60_000; assert.equal(await store.get("web_ttl"), null);
});

test("CAS rejects stale writers", async () => {
  const store = new DurableFakeStore(); const service = new ConversationService({ store }); const initial = createConversationRecord({ id: "web_cas", channel: "web" }); await store.compareAndSet(initial.id, -1, initial);
  const a = await store.get(initial.id); const b = await store.get(initial.id); await store.compareAndSet(initial.id, a.revision, appendTurn(a, { role: "user", content: "a" }));
  await assert.rejects(store.compareAndSet(initial.id, b.revision, appendTurn(b, { role: "user", content: "b" })), ConversationConflictError); await service.append(initial.id, "web", [{ role: "user", content: "c" }]); assert.equal((await store.get(initial.id)).turns.length, 2);
});

test("separate LINE instances share durable history and event dedupe", async () => {
  const store = new DurableFakeStore(); const serviceA = new ConversationService({ store }); const serviceB = new ConversationService({ store }); const source = { type: "user", userId: "raw-line-id-must-not-leak" }; const hmacSecret = "hmac-secret";
  const replies = []; const fetchImpl = async (_url, options) => { replies.push(JSON.parse(options.body).messages[0].text); return { ok: true, headers: { get: () => null } }; }; const answer = async (message, { history }) => `${history.at(-1)?.content || "none"}|${message}`;
  await processLineEvent({ webhookEventId: "evt-1", type: "message", message: { type: "text", text: "first" }, replyToken: "r1", source }, { accessToken: "token", fetchImpl, conversationService: serviceA, hmacSecret, answer });
  await processLineEvent({ webhookEventId: "evt-2", type: "message", message: { type: "text", text: "second" }, replyToken: "r2", source }, { accessToken: "token", fetchImpl, conversationService: serviceB, hmacSecret, answer });
  assert.equal(replies[1], "none|first|second"); const duplicate = await processLineEvent({ webhookEventId: "evt-2", type: "message", message: { type: "text", text: "second" }, replyToken: "r3", source }, { accessToken: "token", fetchImpl, conversationService: serviceA, hmacSecret, answer }); assert.equal(duplicate.outcome, "duplicate"); assert.equal([...store.records.keys()].some(key => key.includes(source.userId)), false);
});

test("memory outage permits FAQ but fails closed before handoff", async () => {
  const service = { history: async () => { throw new Error("redis down"); } }; const faq = await answerWithConversation({ id: "web_x", channel: "web", message: "早餐幾點？", service }); assert.equal(faq.durable, false); assert.match(faq.answer, /08:00–10:00/);
  const handoff = await answerWithConversation({ id: "web_x", channel: "web", message: "幫我取消訂房", service }); assert.equal(handoff.durable, false); assert.match(handoff.answer, /尚未.*執行/); assert.doesNotMatch(handoff.answer, /已經幫您.*留言/);
});

test("Web, LINE and Messenger answer a new FAQ instead of replaying stale handoff collection", async () => {
  for (const channel of ["web", "line", "messenger"]) {
    let savedHandoff;
    const service = {
      context: async () => ({
        turns: [{ role: "assistant", content: "請提供姓名與電話或 Email" }],
        handoff: { state: "collecting_required_fields", category: "真人服務", contact: {} }
      }),
      append: async (_id, _channel, _turns, metadata) => { savedHandoff = metadata.handoff; }
    };
    const result = await answerWithConversation({
      id: `${channel}_stale_handoff`, channel, message: "請問 Wi-Fi 密碼是多少？", service
    });
    assert.match(result.answer, /00000000/u, channel);
    assert.doesNotMatch(result.answer, /提供您的姓名/u, channel);
    assert.deepEqual(savedHandoff, { state: "none" }, channel);
  }
});
