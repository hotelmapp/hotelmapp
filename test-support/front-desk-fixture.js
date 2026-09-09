// Offline Redis command model: never connects to a real account. The actual
// Lua control script has a separate interpreter-based smoke test as well.
import { FrontDeskStore, CONTROL_SCRIPT, REGISTER_SCRIPT } from "../ai-core/front-desk/store.js";
import { FrontDeskService, HOLD_SCRIPT } from "../ai-core/front-desk/service.js";
import { RedisConversationStore } from "../ai-core/conversation/store.js";
import { ConversationService } from "../ai-core/conversation/service.js";
import { lineConversationId, metaConversationId } from "../ai-core/conversation/record.js";

export class MemoryRedis {
  constructor(clock) { this.clock = clock; this.data = new Map(); this.expires = new Map(); this.commands = []; }
  get(key) {
    if ((this.expires.get(key) ?? Infinity) <= this.clock.now) { this.data.delete(key); this.expires.delete(key); }
    return this.data.get(key) ?? null;
  }
  set(key, value, ttl) { this.data.set(key, value); this.expires.delete(key); if (ttl) this.expires.set(key, this.clock.now + ttl); return "OK"; }
  zset(key) { const existing = this.get(key); if (existing) return existing; const next = new Map(); this.set(key, next); return next; }
  setOf(key) { const existing = this.get(key); if (existing) return existing; const next = new Set(); this.set(key, next); return next; }
  async command(input) { this.commands.push(structuredClone(input)); return this.run(input); }
  run([cmd, key, ...args]) {
    if (cmd === "GET") return this.get(key);
    if (cmd === "MGET") return [key, ...args].map(k => this.get(k));
    if (cmd === "SET") {
      if (args.includes("NX") && this.get(key) !== null) return null;
      const px = args.indexOf("PX"), ex = args.indexOf("EX");
      return this.set(key, args[0], px >= 0 ? Number(args[px + 1]) : ex >= 0 ? Number(args[ex + 1]) * 1000 : undefined);
    }
    if (cmd === "DEL") { this.expires.delete(key); return Number(this.data.delete(key)); }
    if (cmd === "ZADD") { this.zset(key).set(args[1], Number(args[0])); return 1; }
    if (cmd === "ZREMRANGEBYSCORE") { const z = this.zset(key); for (const [member, score] of z) if (score <= Number(args[1])) z.delete(member); return 1; }
    if (cmd === "ZREVRANGE") return [...this.zset(key)].sort((a, b) => b[1] - a[1]).slice(Number(args[0]), Number(args[1]) + 1).map(x => x[0]);
    if (cmd === "SMEMBERS") return [...this.setOf(key)];
    if (cmd === "EVAL") {
      const count = Number(args[0]), keys = args.slice(1, count + 1), argv = args.slice(count + 1);
      if (key === CONTROL_SCRIPT) return this.control(keys, argv);
      if (key === REGISTER_SCRIPT) {
        if (Number(argv[1]) >= Number(this.get(keys[3]) ?? -1)) { this.set(keys[1], argv[0], Number(argv[3])); this.set(keys[3], argv[1], Number(argv[3])); }
        if (!this.get(keys[0])) this.set(keys[0], argv[2], Number(argv[3]));
        this.run(["ZADD", keys[2], argv[4], argv[5]]);
        this.run(["ZREMRANGEBYSCORE", keys[2], "-inf", String(Number(argv[4]) - Number(argv[3]))]); return "ok";
      }
      if (key === HOLD_SCRIPT) {
        const raw = this.get(keys[0]); if (!raw) return 0;
        const c = JSON.parse(raw); if (c.mode === "ai") return 0;
        c.inboundVersion = (c.inboundVersion || 0) + 1; this.set(keys[0], JSON.stringify(c)); return 1;
      }
      if (key.includes("local n=redis.call('INCR'")) {
        const n = Number(this.get(keys[0]) || 0) + 1, expiration = this.expires.get(keys[0]);
        this.set(keys[0], String(n)); this.expires.set(keys[0], n === 1 ? this.clock.now + 300_000 : expiration); return n;
      }
      if (key.includes("local expected=tonumber(ARGV[1])")) {
        const raw = this.get(keys[0]); if ((raw ? JSON.parse(raw).revision : -1) !== Number(argv[0])) return 0;
        const next = JSON.parse(argv[1]); next.revision = Number(argv[0]) + 1;
        this.set(keys[0], JSON.stringify(next), Number(argv[2])); return 1;
      }
      throw new Error("unexpected_test_lua");
    }
    throw new Error("unexpected_test_command:" + cmd);
  }
  control([key, leaseKey, activeKey, journalKey], [op, token, rawNow, epoch, leaseMs, retention, id, journal, requestId, status, inboundVersion]) {
    const raw = this.get(key); if (!raw) return "missing";
    const c = JSON.parse(raw), now = Number(rawNow), leases = this.zset(leaseKey);
    for (const [member, expiry] of leases) if (expiry <= now) leases.delete(member);
    const locked = leases.size > 0, own = leases.get(token);
    const save = () => this.set(key, JSON.stringify(c), c.mode === "ai" ? Number(retention) : undefined);
    const lease = () => { leases.set(token, now + Number(leaseMs)); this.expires.set(leaseKey, now + Number(leaseMs)); };
    if (c.mode === "pausing" && !locked) { c.mode = "human"; save(); }
    if (op === "view") return JSON.stringify(c);
    if (op === "takeover") {
      if (c.mode === "ai") { c.mode = locked ? "pausing" : "human"; c.epoch++; c.takenAt = now; c.updatedAt = now; save(); this.setOf(activeKey).add(id); }
      return JSON.stringify(c);
    }
    if (op === "begin_ai") { c.inboundVersion = (c.inboundVersion || 0) + 1; save(); if (c.mode !== "ai") return "paused"; lease(); return String(c.epoch); }
    if (op === "check_ai") return c.mode === "ai" && own > now + 12_000 && String(c.epoch) === epoch ? "ok" : "denied";
    if (op === "release") { leases.delete(token); if (c.mode === "pausing" && !leases.size) { c.mode = "human"; save(); } return "ok"; }
    if (op === "begin_reply" && this.get(journalKey)) return "duplicate";
    if (["begin_reply", "begin_close"].includes(op)) {
      if (c.mode !== "human" || String(c.epoch) !== epoch) return "stale_state";
      if (locked) return "busy";
      if (op === "begin_close" && String(c.inboundVersion || 0) !== inboundVersion) return "new_messages_arrived";
      lease();
      if (op === "begin_reply") { this.set(journalKey, journal, Number(retention)); c.lastSend = { id: requestId, status: "pending", at: now }; save(); }
      return "ok";
    }
    if (op === "complete_reply") { this.set(journalKey, journal, Number(retention)); if (c.lastSend?.id === requestId) { c.lastSend.status = status; save(); } leases.delete(token); return "ok"; }
    if (op === "complete_close") {
      if (!own || c.mode !== "human" || String(c.epoch) !== epoch) return "stale_state";
      if (String(c.inboundVersion || 0) !== inboundVersion) return "new_messages_arrived";
      c.mode = "ai"; c.epoch++; c.updatedAt = now; c.closedAt = now; save(); leases.delete(token); this.setOf(activeKey).delete(id); return "ok";
    }
    return "invalid_operation";
  }
}

export function fixture(channel = "line") {
  const clock = { now: Date.parse("2026-09-09T01:00:00Z") };
  const env = { FRONT_DESK_ENABLED: "true", FRONT_DESK_ADMIN_KEY: "test-only-admin-key-1234567890123456789", FRONT_DESK_DATA_KEY: Buffer.alloc(32, 42).toString("base64"), CONVERSATION_HMAC_SECRET: "test-only-hmac", FRONT_DESK_ORIGIN: "https://desk.example.test", LINE_CHANNEL_ACCESS_TOKEN: "line-test-token", META_PAGE_ACCESS_TOKEN: "meta-test-token" };
  const memory = new MemoryRedis(clock);
  const redis = new RedisConversationStore({ url: "https://offline.invalid", token: "test", now: () => clock.now, fetchImpl: async (_url, options) => ({ ok: true, json: async () => ({ result: await memory.command(JSON.parse(options.body)) }) }) });
  const conversations = new ConversationService({ store: redis, now: () => new Date(clock.now) });
  const store = new FrontDeskStore({ redis, dataKey: env.FRONT_DESK_DATA_KEY, now: () => clock.now });
  const sent = [];
  const desk = new FrontDeskService({ store, conversations, env, send: async value => { sent.push(value); return { sent: true }; } });
  const route = { channel, recipientId: "fictional-guest-001", ...(channel === "messenger" ? { pageId: "test-page" } : {}), lastInboundAt: clock.now };
  const id = channel === "line" ? lineConversationId({ type: "user", userId: route.recipientId }, env.CONVERSATION_HMAC_SECRET) : metaConversationId({ platform: channel, pageId: route.pageId, senderId: route.recipientId }, env.CONVERSATION_HMAC_SECRET);
  const incoming = (message = "請問停車場在哪裡？", extra = {}) => desk.incoming({ id, channel, message, route: { ...route, lastInboundAt: clock.now }, generate: async () => ({ answer: "請至青海路的特約停車場。", metadata: {} }), send: async text => sent.push({ ai: text }), ...extra });
  const close = async (extra = {}) => { const current = await desk.detail(id); return desk.close({ id, epoch: current.control.epoch, revision: current.revision, inboundVersion: current.control.inboundVersion || 0, summary: "已提供停車位置，客人已了解。", ...extra }); };
  return { clock, env, memory, redis, conversations, store, desk, sent, route, id, incoming, close };
}
