import { CONVERSATION_LIMITS } from "./record.js";

export class ConversationStoreError extends Error { constructor(code, cause) { super(code, { cause }); this.name = "ConversationStoreError"; this.code = code; } }
export class ConversationConflictError extends ConversationStoreError { constructor() { super("conversation_conflict"); } }

export class ConversationStore {
  async get() { throw new Error("not_implemented"); }
  async compareAndSet() { throw new Error("not_implemented"); }
  async claimIdempotencyKey() { throw new Error("not_implemented"); }
}

const CAS_SCRIPT = `local current=redis.call('GET',KEYS[1]); local expected=tonumber(ARGV[1]); if current then local decoded=cjson.decode(current); if decoded.revision~=expected then return 0 end elseif expected~=-1 then return 0 end; local next=cjson.decode(ARGV[2]); next.revision=expected+1; local encoded=cjson.encode(next); redis.call('SET',KEYS[1],encoded,'PX',ARGV[3]); return 1`;

export class RedisConversationStore extends ConversationStore {
  constructor({ url, token, fetchImpl = fetch, prefix = "hm:conv:v1:", limits = CONVERSATION_LIMITS, now = () => Date.now() } = {}) {
    super(); this.url = url?.replace(/\/$/, ""); this.token = token; this.fetch = fetchImpl; this.prefix = prefix; this.limits = limits; this.now = now;
    if (!this.url || !this.token) throw new ConversationStoreError("redis_not_configured");
  }
  key(id) { return `${this.prefix}${id}`; }
  async command(command) {
    try {
      const response = await this.fetch(this.url, { method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" }, body: JSON.stringify(command), signal: AbortSignal.timeout(4_000) });
      if (!response.ok) throw new Error(`redis_http_${response.status}`);
      const body = await response.json(); if (body?.error) throw new Error("redis_command_failed"); return body?.result;
    } catch (error) { throw new ConversationStoreError("redis_unavailable", error); }
  }
  async get(id) {
    const raw = await this.command(["GET", this.key(id)]); if (!raw) return null;
    const record = JSON.parse(raw);
    if (Date.parse(record.expiresAt) <= this.now()) { await this.command(["DEL", this.key(id)]); return null; }
    return record;
  }
  async compareAndSet(id, expectedRevision, record) {
    const absoluteRemaining = Date.parse(record.expiresAt) - this.now();
    if (absoluteRemaining <= 0) return false;
    const ttl = Math.min(this.limits.slidingTtlMs, absoluteRemaining);
    const result = await this.command(["EVAL", CAS_SCRIPT, "1", this.key(id), String(expectedRevision), JSON.stringify(record), String(ttl)]);
    if (Number(result) !== 1) throw new ConversationConflictError();
    return true;
  }
  async claimIdempotencyKey(scope, key, ttlMs = 10 * 60_000) {
    const safe = `${scope}:${key}`.replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 300);
    return (await this.command(["SET", `${this.prefix}dedupe:${safe}`, "1", "NX", "PX", String(ttlMs)])) === "OK";
  }
}

export function conversationStoreFromEnv(env = process.env, options = {}) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  return new RedisConversationStore({ url, token, ...options });
}
