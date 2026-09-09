import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fixture } from "../test-support/front-desk-fixture.js";
import { CONTROL_SCRIPT, LEASE_MS, RETENTION_MS, FrontDeskStore, deskNamespace } from "../ai-core/front-desk/store.js";
import { HUMAN_LABEL, frontDeskService, humanReply, preserveHumanHold, sendStaffText, assertReplyWindow } from "../ai-core/front-desk/service.js";
import { authenticateDesk, loginDesk, logoutDesk, deskCookie, assertDeskOrigin } from "../ai-core/front-desk/auth.js";
import { answerWithConversation } from "../ai-core/conversation/runtime.js";
import { lineConversationId } from "../ai-core/conversation/record.js";
import { createFrontDeskHandler } from "../api/front-desk.js";
import { processLineEvent } from "../api/line/webhook.js";
import { processMetaEvent } from "../api/meta/adapter.js";

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const noCall = () => assert.fail("must not call model or external channel");
const staffRequest = f => ({ id: f.id, epoch: 1, text: "您好，我是櫃檯人員，正在為您確認喔。", requestId: randomUUID() });
async function ready(f) { await f.incoming(); await f.desk.takeover(f.id); f.sent.length = 0; }
function http(f, overrides = {}) {
  const handler = createFrontDeskHandler({ env: f.env, createService: () => f.desk });
  return async (body, req = {}) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; } };
    await handler({ method: "POST", body, headers: { origin: f.env.FRONT_DESK_ORIGIN, "content-type": "application/json", ...overrides }, ...req }, res);
    return res;
  };
}

test("workbench is opt-in, missing configuration locks it, previews are isolated", () => {
  const f = fixture();
  assert.equal(frontDeskService(f.conversations, {}), null);
  assert.throws(() => frontDeskService(f.conversations, { FRONT_DESK_ENABLED: "true" }), /not_configured/);
  assert.throws(() => frontDeskService(f.conversations, { ...f.env, FRONT_DESK_DATA_KEY: "bad" }), /not_configured/);
  assert.throws(() => deskNamespace({ VERCEL_ENV: "preview" }), /preview_namespace_missing/);
  assert.notEqual(deskNamespace(f.env), deskNamespace({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: "a".repeat(40) }));
});

test("route IDs are encrypted, context-bound, and absent from admin responses", async () => {
  const f = fixture(); await f.incoming();
  const encrypted = f.memory.get(f.store.key("route", f.id));
  assert.doesNotMatch(encrypted, /fictional-guest/);
  assert.deepEqual(await f.store.route(f.id), f.route);
  assert.throws(() => f.store.unseal(encrypted, f.id + "other"));
  const wrongKey = new FrontDeskStore({ redis: f.redis, dataKey: Buffer.alloc(32, 1).toString("base64") });
  assert.throws(() => wrongKey.unseal(encrypted, f.id));
  assert.doesNotMatch(JSON.stringify(await f.desk.detail(f.id)), /recipientId|fictional-guest|test-only|line-test-token/);
  assert.doesNotMatch(JSON.stringify(await f.desk.inbox()), /recipientId|fictional-guest/);
});

test("trusted route registration rejects mismatched identities and future timestamps", async () => {
  const f = fixture();
  await assert.rejects(f.desk.register(f.id, { ...f.route, recipientId: "another-guest" }), /invalid_conversation/);
  await assert.rejects(f.desk.register(f.id, { ...f.route, lastInboundAt: f.clock.now + 31_000 }), /invalid_event_time/);
  await assert.rejects(f.desk.register(f.id, { ...f.route, lastInboundAt: undefined }), /invalid_event_time/);
  await f.desk.register(f.id, { ...f.route, lastInboundAt: f.clock.now + 10_000 });
  assert.equal((await f.store.route(f.id)).lastInboundAt, f.clock.now);
});

test("only explicit closure resumes a held conversation; acknowledgement is not closure", async () => {
  const f = fixture(); await ready(f);
  for (const message of ["好", "謝謝您", "OK", "Thanks", "はい", "ありがとう", "네", "감사합니다", "恢復 AI", "已處理完成"]) {
    assert.equal((await f.incoming(message, { generate: noCall, send: noCall })).outcome, "human");
    assert.equal((await f.store.control(f.id)).mode, "human");
  }
  const before = (await f.store.control(f.id)).epoch;
  await f.close();
  assert.equal((await f.store.control(f.id)).mode, "ai");
  assert.equal((await f.store.control(f.id)).epoch, before + 1);
  assert.equal((await f.incoming("早餐幾點？")).outcome, "replied");
});

test("takeover fences an AI generation and waits before enabling staff replies", async () => {
  const f = fixture(), entered = deferred(), finish = deferred(); let guard;
  const work = f.incoming("還有房間嗎？", { generate: async mayAct => { guard = mayAct; entered.resolve(); await finish.promise; return { answer: "尚未送出的 AI 回覆" }; }, send: noCall });
  await entered.promise;
  assert.equal(await guard(), true);
  const state = await f.desk.takeover(f.id);
  assert.equal(state.mode, "pausing"); assert.equal(await guard(), false);
  await assert.rejects(f.desk.reply(staffRequest(f)), /stale_state/);
  finish.resolve(); assert.equal((await work).outcome, "human");
  assert.equal((await f.store.control(f.id)).mode, "human");
  assert.deepEqual((await f.conversations.context(f.id)).turns.map(x => x.role), ["user"]);
});

test("already-started channel delivery keeps the workbench in pausing until it finishes", async () => {
  const f = fixture(), entered = deferred(), finish = deferred();
  const work = f.incoming("請問入住時間？", { send: async () => { entered.resolve(); await finish.promise; } });
  await entered.promise; assert.equal((await f.desk.takeover(f.id)).mode, "pausing");
  finish.resolve(); await work; assert.equal((await f.store.control(f.id)).mode, "human");
});

test("multiple AI leases drain independently; expired jobs cannot send after takeover", async () => {
  const f = fixture(); await f.desk.register(f.id, f.route);
  await f.store.transition("begin_ai", f.id, { token: "ai-a" });
  await f.store.transition("begin_ai", f.id, { token: "ai-b" });
  await f.desk.takeover(f.id); await f.store.transition("release", f.id, { token: "ai-a" });
  assert.equal((await f.store.control(f.id)).mode, "pausing");
  f.clock.now += LEASE_MS + 1;
  assert.equal((await f.store.control(f.id)).mode, "human");
  assert.equal(await f.store.transition("check_ai", f.id, { token: "ai-b", epoch: 0 }), "denied");
});

test("a near-expiry AI lease cannot start an external request", async () => {
  const f = fixture(); await f.desk.register(f.id, f.route);
  await f.store.transition("begin_ai", f.id, { token: "slow-ai" });
  f.clock.now += LEASE_MS - 12_000;
  assert.equal(await f.store.transition("check_ai", f.id, { token: "slow-ai", epoch: 0 }), "denied");
});

test("takeover is per guest, not a global AI shutdown", async () => {
  const f = fixture(); await ready(f);
  const route = { ...f.route, recipientId: "fictional-guest-002" };
  const id = lineConversationId({ type: "user", userId: route.recipientId }, f.env.CONVERSATION_HMAC_SECRET);
  assert.equal((await f.incoming("另一位客人的問題", { id, route })).outcome, "replied");
  assert.equal((await f.store.control(f.id)).mode, "human");
});

test("held control survives transcript and encrypted-route expiry; no automatic resume", async () => {
  const f = fixture(); await ready(f);
  f.clock.now += RETENTION_MS + 1;
  const detail = await f.desk.detail(f.id);
  assert.equal(detail.control.mode, "human"); assert.equal(detail.routeAvailable, false);
  assert.equal(detail.reminder, true); assert.equal(detail.turns.length, 0);
  assert.ok((await f.store.ids()).includes(f.id));
  await assert.rejects(f.desk.reply(staffRequest(f)), /reply_window_expired/);
  await f.incoming("隔天的新問題", { generate: noCall, send: noCall });
  assert.equal((await f.store.control(f.id)).mode, "human");
  await f.close(); assert.equal((await f.store.control(f.id)).mode, "ai");
});

test("disabling the UI opt-in does not clear an existing human hold", async () => {
  const f = fixture(); await ready(f);
  assert.equal(await preserveHumanHold({ conversations: f.conversations, id: f.id, channel: "line", message: "好", env: { ...f.env, FRONT_DESK_ENABLED: "false" } }), true);
  assert.equal((await f.store.control(f.id)).mode, "human");
});

test("human prefix is server-owned and emitted once; empty or oversized replies are denied", () => {
  assert.equal(humanReply(HUMAN_LABEL + " 您好 "), HUMAN_LABEL + "\n您好");
  for (const text of ["", "   ", HUMAN_LABEL, "x".repeat(1501), null]) assert.throws(() => humanReply(text), /invalid_reply/);
});

test("AI text cannot use the exact staff identity label", async () => {
  const f = fixture(); await f.incoming("問題", { generate: async () => ({ answer: HUMAN_LABEL + "\nAI 回覆" }) });
  assert.equal(f.sent[0].ai, "AI 回覆");
  assert.equal((await f.desk.detail(f.id)).turns[1].source, undefined);
});

test("staff sends carry the prefix and staff history source, without resuming AI", async () => {
  const f = fixture(); await ready(f);
  assert.equal((await f.desk.reply(staffRequest(f))).status, "accepted");
  assert.match(f.sent[0].text, /^【真人櫃檯回覆】\n/);
  const detail = await f.desk.detail(f.id);
  assert.equal(detail.turns.at(-1).source, "staff"); assert.equal(detail.control.mode, "human");
});

test("same request retried concurrently sends once; reused ID cannot change its content", async () => {
  const f = fixture(); await ready(f); const request = staffRequest(f);
  const results = await Promise.all([f.desk.reply(request), f.desk.reply(request), f.desk.reply(request)]);
  assert.equal(f.sent.length, 1); assert.ok(results.some(x => x.duplicate));
  await assert.rejects(f.desk.reply({ ...request, text: "不同內容" }), /request_id_reused/);
});

test("a second shared workstation cannot send or close during an active send", async () => {
  const f = fixture(); await ready(f); const entered = deferred(), finish = deferred();
  f.desk.send = async () => { entered.resolve(); await finish.promise; };
  const pending = f.desk.reply(staffRequest(f)); await entered.promise;
  await assert.rejects(f.desk.reply(staffRequest(f)), /conversation_busy/);
  await assert.rejects(f.close(), /conversation_busy/);
  finish.resolve(); await pending;
});

test("uncertain channel response or history write never automatically repeats the send", async () => {
  for (const failure of ["channel", "history"]) {
    const f = fixture(); await ready(f); let sends = 0;
    f.desk.send = async () => { sends++; if (failure === "channel") throw new Error("timeout"); };
    if (failure === "history") f.conversations.append = async () => { throw new Error("lost write acknowledgement"); };
    const request = staffRequest(f);
    assert.equal((await f.desk.reply(request)).status, "uncertain");
    assert.equal((await f.desk.reply(request)).status, "uncertain"); assert.equal(sends, 1);
    assert.doesNotMatch(JSON.stringify(await f.store.journal(f.id, request.requestId)), /您好|recipientId|test-token/);
    assert.equal((await f.store.control(f.id)).mode, "human");
  }
});

test("invalid request IDs and stale epochs cannot send or close a later takeover", async () => {
  const f = fixture(); await ready(f);
  await assert.rejects(f.desk.reply({ ...staffRequest(f), requestId: "invalid" }), /invalid_request/);
  await f.close(); await f.desk.takeover(f.id);
  await assert.rejects(f.desk.reply(staffRequest(f)), /stale_state/);
  await assert.rejects(f.close({ epoch: 1 }), /stale_state/); assert.equal(f.sent.length, 0);
});

test("replayed inbound timestamps and dashboard visits cannot extend reply windows", async () => {
  const f = fixture("messenger"); await ready(f);
  f.clock.now += 24 * 60 * 60_000;
  await f.desk.register(f.id, f.route); await f.desk.detail(f.id);
  await assert.rejects(f.desk.reply(staffRequest(f)), /reply_window_expired/);
  assert.throws(() => assertReplyWindow({ ...f.route, channel: "line" }, f.route.lastInboundAt + 7 * 24 * 60 * 60_000), /reply_window_expired/);
  await f.incoming("新的提問", { generate: noCall });
  assert.equal((await f.desk.reply(staffRequest(f))).status, "accepted");
});

test("close retains an internal redacted summary and clears obsolete email handoff state", async () => {
  const f = fixture(); await ready(f);
  await f.conversations.append(f.id, "line", [], { handoff: { state: "ready_for_confirmation", requestId: "old-request", category: "真人服務" } });
  await f.close({ summary: "已聯絡 test@example.com，請勿再寄信。" });
  const context = await f.conversations.context(f.id);
  assert.equal(context.turns.at(-1).source, "staff_note");
  assert.doesNotMatch(context.turns.at(-1).content, /test@example.com/);
  assert.deepEqual(context.handoff, { state: "none" }); assert.equal(f.sent.length, 0);
});

test("stale transcript revision prevents closure even if the inbound counter is unchanged", async () => {
  const f = fixture(); await ready(f); const old = await f.desk.detail(f.id);
  await f.desk.reply(staffRequest(f));
  await assert.rejects(f.close({ revision: old.revision }), /conversation_conflict/);
  assert.equal((await f.store.control(f.id)).mode, "human");
});

test("inbound messages during the final summary write invalidate closure atomically", async () => {
  const f = fixture(); await ready(f); const append = f.conversations.append.bind(f.conversations);
  f.conversations.append = async (...args) => {
    const result = await append(...args);
    if (args[2].some(turn => turn.source === "staff_note")) await f.incoming("等一下，還有一個問題", { generate: noCall, send: noCall });
    return result;
  };
  await assert.rejects(f.close(), /new_messages_arrived/);
  assert.equal((await f.store.control(f.id)).mode, "human");
});

test("failed closure persistence keeps the guest in human mode", async () => {
  const f = fixture(); await ready(f);
  f.conversations.append = async () => { throw new Error("redis_unavailable"); };
  await assert.rejects(f.close(), /redis_unavailable/);
  assert.equal((await f.store.control(f.id)).mode, "human");
});

test("a compare-and-set rejected at the transcript expiry boundary cannot be treated as saved", async () => {
  const f = fixture(); await ready(f);
  f.conversations.store.compareAndSet = async () => false;
  await assert.rejects(f.close(), /conversation_conflict/);
  assert.equal((await f.store.control(f.id)).mode, "human");
});

test("failed AI generation or delivery preserves the question without inventing a sent answer", async () => {
  for (const stage of ["generate", "send"]) {
    const f = fixture();
    await assert.rejects(f.incoming("這個問題需要協助", { [stage]: async () => { throw new Error("offline"); } }), /offline/);
    assert.deepEqual((await f.desk.detail(f.id)).turns.map(x => x.role), ["user"]);
  }
});

test("email handoff checks the human-takeover fence before any delivery claim", async () => {
  const f = fixture(); let appended = 0;
  const current = { state: "ready_for_confirmation", requestId: "ready-1", category: "真人服務", summary: "訂房問題", contact: { displayName: "測試旅客", phone: "0912345678" } };
  const result = await answerWithConversation({
    id: f.id, channel: "line", message: "確認送出", service: { context: async () => ({ turns: [], handoff: current }), append: async () => { appended++; } },
    route: async () => ({ semanticRoute: { handoff: { requested: true, category: "真人服務" } } }),
    reviewHandoff: async () => ({ required: true, category: "真人服務" }),
    beforeExternalAction: async () => false, claimDelivery: noCall, handoffService: noCall, answer: noCall, deferPersistence: true
  });
  assert.equal(result.suppressed, true); assert.equal(appended, 0);
});

test("shared-admin cookies expire and revoke without ending human holds", async () => {
  const f = fixture(); await ready(f);
  const token = await loginDesk(f.env.FRONT_DESK_ADMIN_KEY, f.store, f.env);
  const req = { headers: { cookie: deskCookie(token) } };
  assert.equal(await authenticateDesk(req, f.store, f.env), token);
  assert.match(deskCookie(token), /HttpOnly; Secure; SameSite=Strict/);
  await assert.rejects(authenticateDesk(req, f.store, { ...f.env, FRONT_DESK_ADMIN_KEY: "rotated-admin-key-12345678901234567890" }), /login_required/);
  await logoutDesk(req, f.store, f.env); await assert.rejects(authenticateDesk(req, f.store, f.env), /login_required/);
  const second = await loginDesk(f.env.FRONT_DESK_ADMIN_KEY, f.store, f.env);
  f.clock.now += 12 * 60 * 60_000 + 1;
  await assert.rejects(authenticateDesk({ headers: { cookie: deskCookie(second) } }, f.store, f.env), /login_required/);
  assert.equal((await f.store.control(f.id)).mode, "human");
});

test("login is rate-limited and does not leak credential material", async () => {
  const f = fixture(); const request = http(f);
  for (let i = 0; i < 30; i++) assert.equal((await request({ action: "login", password: "incorrect" })).statusCode, 401);
  const response = await request({ action: "login", password: f.env.FRONT_DESK_ADMIN_KEY });
  assert.equal(response.statusCode, 429); assert.doesNotMatch(JSON.stringify(response.body), /test-only/);
});

test("all reads and writes require the admin session; Origin and JSON cannot be bypassed", async () => {
  const f = fixture(); await ready(f); const request = http(f);
  for (const action of ["session", "inbox", "detail", "takeover", "reply", "reply_status", "close"]) {
    const body = { action, ...(["detail", "takeover", "reply", "reply_status", "close"].includes(action) ? { id: f.id } : {}) };
    assert.equal((await request(body)).statusCode, 401, action);
  }
  assert.equal((await request({ action: "login", password: f.env.FRONT_DESK_ADMIN_KEY }, { headers: { origin: "https://attacker.example", "content-type": "application/json" } })).statusCode, 403);
  assert.equal((await request({ action: "login" }, { method: "GET" })).statusCode, 405);
  assert.equal((await request({ action: "login" }, { headers: { origin: f.env.FRONT_DESK_ORIGIN, "content-type": "application/jsonfake" } })).statusCode, 415);
  for (const body of [{ action: "toString" }, { action: "inbox", recipientId: "forged" }, []]) assert.equal((await request(body)).statusCode, 400);
  assert.throws(() => assertDeskOrigin({ headers: { host: "desk.example.test" } }, f.env), /origin_rejected/);
  const login = await request({ action: "login", password: f.env.FRONT_DESK_ADMIN_KEY });
  const authenticated = http(f, { cookie: login.headers["Set-Cookie"] });
  const inbox = await authenticated({ action: "inbox" });
  assert.equal(inbox.statusCode, 200); assert.equal(inbox.headers["Cache-Control"], "no-store");
  assert.equal((await authenticated({ action: "reply", ...staffRequest(f), recipientId: "forged" })).statusCode, 400);
});

test("LINE staff transport uses a server-stored destination, push retry key and fixed identity prefix", async () => {
  const f = fixture(); const requestId = randomUUID(); let request;
  await sendStaffText({ route: f.route, text: humanReply("您好"), requestId, env: f.env, fetchImpl: async (url, options) => { request = { url, options, body: JSON.parse(options.body) }; return { ok: true }; } });
  assert.equal(request.url, "https://api.line.me/v2/bot/message/push");
  assert.equal(request.options.headers["X-Line-Retry-Key"], requestId);
  assert.equal(request.body.to, f.route.recipientId); assert.equal(request.body.messages[0].text, HUMAN_LABEL + "\n您好");
});

test("status lookup remains read-only after the idempotency journal expires", async () => {
  const f = fixture(); await ready(f); const request = staffRequest(f);
  await f.desk.reply(request); assert.equal((await f.desk.replyStatus(request)).status, "accepted");
  f.clock.now += RETENTION_MS + 1; await f.incoming("新的問題", { generate: noCall });
  assert.equal((await f.desk.replyStatus(request)).status, "unknown"); assert.equal(f.sent.length, 1);
});

test("out-of-order route registration never overwrites a newer inbound timestamp", async () => {
  const f = fixture(); await f.desk.register(f.id, f.route);
  f.clock.now += 60_000;
  await Promise.all([f.desk.register(f.id, { ...f.route, lastInboundAt: f.clock.now }), f.desk.register(f.id, f.route)]);
  assert.equal((await f.store.route(f.id)).lastInboundAt, f.clock.now);
});

test("Messenger staff transport does not bypass the standard-response contract with HUMAN_AGENT tags", async () => {
  const f = fixture("messenger"); let body;
  await sendStaffText({ route: f.route, text: humanReply("Hello"), requestId: randomUUID(), env: f.env, fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return { ok: true }; } });
  assert.equal(body.messaging_type, "RESPONSE"); assert.equal(body.tag, undefined); assert.equal(body.recipient.id, f.route.recipientId);
});

test("both channel adapters preserve holds without calling AI, and still deduplicate incoming events", async () => {
  for (const channel of ["line", "messenger"]) {
    const f = fixture(channel); await ready(f);
    const process = channel === "line"
      ? () => processLineEvent({ webhookEventId: "test-event", type: "message", replyToken: "test-reply", timestamp: f.clock.now, source: { type: "user", userId: f.route.recipientId }, message: { type: "text", text: "好" } }, { accessToken: "test", hmacSecret: f.env.CONVERSATION_HMAC_SECRET, conversationService: f.conversations, answer: noCall, fetchImpl: noCall, env: f.env, desk: f.desk })
      : () => processMetaEvent({ pageId: f.route.pageId, event: { timestamp: f.clock.now, sender: { id: f.route.recipientId }, message: { mid: "test-message", text: "好" } } }, { accessToken: "test", hmacSecret: f.env.CONVERSATION_HMAC_SECRET, conversationService: f.conversations, answer: noCall, send: noCall, env: f.env, desk: f.desk, logger: {} });
    assert.equal((await process()).outcome, "human"); assert.equal((await process()).outcome, "duplicate");
  }
});

test("LINE cannot use an unguarded stateless response when a configured control store fails", async () => {
  await assert.rejects(processLineEvent({ type: "message", message: { type: "text", text: "好" } }, { conversationService: { store: { claimIdempotencyKey: async () => { throw new Error("redis down"); } } }, answer: noCall, fetchImpl: noCall, env: {} }), /front_desk_state_unavailable/);
});

test("workbench shell keeps code external and renders user contents as inert text", async () => {
  const html = await readFile(new URL("../front-desk.html", import.meta.url), "utf8");
  const js = await readFile(new URL("../front-desk.js", import.meta.url), "utf8");
  const headers = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8")).headers;
  assert.match(html, /<script src="\/front-desk.js" type="module"><\/script>/);
  assert.doesNotMatch(html, /on(?:click|submit|error)=/i); assert.doesNotMatch(js, /innerHTML|localStorage|sessionStorage|document\.cookie/);
  assert.match(js, /createTextNode\(turn.content\)/);
  assert.ok(headers.some(entry => entry.headers.some(h => h.key === "Content-Security-Policy" && h.value.includes("frame-ancestors 'none'"))));
});

test("actual Lua control script executes the lease, idempotency and close-race invariants", t => {
  const result = spawnSync("texlua", [new URL("../test-support/front-desk-control.lua", import.meta.url).pathname], { input: CONTROL_SCRIPT, encoding: "utf8", timeout: 5000 });
  if (result.error?.code === "ENOENT") { t.skip("optional texlua interpreter is not installed; run on the release QA host"); return; }
  assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /control Lua invariants passed/);
});
