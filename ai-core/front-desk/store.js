import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const RETENTION_MS = 48 * 60 * 60_000;
export const LEASE_MS = 90_000;
export const REGISTER_SCRIPT = [
  "local last=tonumber(redis.call('GET',KEYS[4]) or '-1')",
  "if tonumber(ARGV[2])>=last then redis.call('SET',KEYS[2],ARGV[1],'PX',ARGV[4]); redis.call('SET',KEYS[4],ARGV[2],'PX',ARGV[4]) end",
  "redis.call('SET',KEYS[1],ARGV[3],'NX','PX',ARGV[4]); redis.call('ZADD',KEYS[3],ARGV[5],ARGV[6]); redis.call('ZREMRANGEBYSCORE',KEYS[3],'-inf',tonumber(ARGV[5])-tonumber(ARGV[4])); return 'ok'"
].join("\n");
export const CONTROL_SCRIPT = [
  "local raw=redis.call('GET',KEYS[1]); if not raw then return 'missing' end",
  "local c=cjson.decode(raw); local op=ARGV[1]; local token=ARGV[2]; local now=tonumber(ARGV[3]); redis.call('ZREMRANGEBYSCORE',KEYS[2],'-inf',now); local locked=redis.call('ZCARD',KEYS[2])>0; local own=redis.call('ZSCORE',KEYS[2],token)",
  "local function save() redis.call('SET',KEYS[1],cjson.encode(c)); if c.mode=='ai' then redis.call('PEXPIRE',KEYS[1],ARGV[6]) end end",
  "if c.mode=='pausing' and not locked then c.mode='human'; save() end",
  "if op=='view' then return cjson.encode(c) end",
  "if op=='takeover' then if c.mode=='ai' then c.mode=locked and 'pausing' or 'human'; c.epoch=c.epoch+1; c.takenAt=now; c.updatedAt=now; save(); redis.call('SADD',KEYS[3],ARGV[7]) end; return cjson.encode(c) end",
  "local function lease() redis.call('ZADD',KEYS[2],now+tonumber(ARGV[5]),token); redis.call('PEXPIRE',KEYS[2],ARGV[5]) end",
  "if op=='begin_ai' then c.inboundVersion=(c.inboundVersion or 0)+1; save(); if c.mode~='ai' then return 'paused' end; lease(); return tostring(c.epoch) end",
  "if op=='check_ai' then if c.mode=='ai' and own and tonumber(own)>now+12000 and tostring(c.epoch)==ARGV[4] then return 'ok' end; return 'denied' end",
  "if op=='release' then redis.call('ZREM',KEYS[2],token); if c.mode=='pausing' and redis.call('ZCARD',KEYS[2])==0 then c.mode='human'; save() end; return 'ok' end",
  "if op=='begin_reply' then if redis.call('EXISTS',KEYS[4])==1 then return 'duplicate' end end",
  "if op=='begin_reply' or op=='begin_close' then",
  " if c.mode~='human' or tostring(c.epoch)~=ARGV[4] then return 'stale_state' end; if locked then return 'busy' end",
  " if op=='begin_close' and tostring(c.inboundVersion or 0)~=ARGV[11] then return 'new_messages_arrived' end",
  " lease();",
  " if op=='begin_reply' then redis.call('SET',KEYS[4],ARGV[8],'PX',ARGV[6]); c.lastSend={id=ARGV[9],status='pending',at=now}; save() end",
  " return 'ok'",
  "end",
  "if op=='complete_reply' then redis.call('SET',KEYS[4],ARGV[8],'PX',ARGV[6]); if c.lastSend and c.lastSend.id==ARGV[9] then c.lastSend.status=ARGV[10]; save() end; redis.call('ZREM',KEYS[2],token); return 'ok' end",
  "if op=='complete_close' then if not own or c.mode~='human' or tostring(c.epoch)~=ARGV[4] then return 'stale_state' end; if tostring(c.inboundVersion or 0)~=ARGV[11] then return 'new_messages_arrived' end; c.mode='ai'; c.epoch=c.epoch+1; c.updatedAt=now; c.closedAt=now; save(); redis.call('ZREM',KEYS[2],token); redis.call('SREM',KEYS[3],ARGV[7]); return 'ok' end",
  "return 'invalid_operation'"
].join("\n");

export class FrontDeskError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
export function validDeskId(id) { return typeof id === "string" && /^(?:line|messenger)_[A-Za-z0-9_-]{43}$/.test(id); }
export function deskEnabled(env = process.env) { return env.FRONT_DESK_ENABLED === "true"; }
export function deskNamespace(env = process.env) {
  if (env.VERCEL_ENV === "preview") {
    if (!/^[a-f0-9]{40}$/i.test(env.VERCEL_GIT_COMMIT_SHA || "")) throw new FrontDeskError("preview_namespace_missing", 503);
    return "hm:desk:v1:preview:" + env.VERCEL_GIT_COMMIT_SHA + ":";
  }
  return "hm:desk:v1:production:";
}

export class FrontDeskStore {
  constructor({ redis, dataKey, prefix = "hm:desk:v1:production:", now = () => Date.now() }) {
    this.redis = redis; this.now = now; this.prefix = prefix;
    this.dataKey = Buffer.from(dataKey || "", "base64");
    if (this.dataKey.length !== 32 || typeof redis?.command !== "function") throw new FrontDeskError("front_desk_not_configured", 503);
  }
  key(kind, id = "") { return this.prefix + kind + ":" + id; }
  command(args) { return this.redis.command(args); }
  seal(value, context) {
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.dataKey, iv);
    cipher.setAAD(Buffer.from(this.prefix + context));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
  }
  unseal(value, context) {
    const bytes = Buffer.from(value, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.dataKey, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(this.prefix + context)); decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
  }
  async register(id, route) {
    if (!validDeskId(id)) throw new FrontDeskError("invalid_conversation", 400);
    // A redelivery cannot extend a platform response window. The original
    // validated webhook timestamp, not the dashboard visit, owns this value.
    await this.command(["EVAL", REGISTER_SCRIPT, "4", this.key("control", id), this.key("route", id), this.key("inbox"), this.key("inbound_time", id),
      this.seal(route, id), String(route.lastInboundAt), JSON.stringify({ mode: "ai", epoch: 0, updatedAt: this.now() }), String(RETENTION_MS), String(this.now()), id]);
  }
  async route(id) {
    const raw = await this.command(["GET", this.key("route", id)]);
    return raw ? this.unseal(raw, id) : null;
  }
  async control(id) {
    const result = await this.transition("view", id);
    return result === "missing" ? null : JSON.parse(result);
  }
  transition(op, id, { token = "", epoch = -1, requestId = "", journal = "", status = "", inboundVersion = -1 } = {}) {
    if (!validDeskId(id)) throw new FrontDeskError("invalid_conversation", 400);
    return this.command(["EVAL", CONTROL_SCRIPT, "4", this.key("control", id), this.key("lease", id), this.key("active"), this.key("outgoing", id + ":" + requestId),
      op, token, String(this.now()), String(epoch), String(LEASE_MS), String(RETENTION_MS), id, journal, requestId, status, String(inboundVersion)]);
  }
  async journal(id, requestId) {
    const raw = await this.command(["GET", this.key("outgoing", id + ":" + requestId)]);
    return raw ? JSON.parse(raw) : null;
  }
  async ids() {
    const [active, recent] = await Promise.all([
      this.command(["SMEMBERS", this.key("active")]),
      this.command(["ZREVRANGE", this.key("inbox"), "0", "49"])
    ]);
    // Never hide unresolved holds behind an arbitrary recent-inbox limit.
    return [...new Set([...(active || []), ...(recent || [])])].filter(validDeskId);
  }
  digest(value) { return createHash("sha256").update(value).digest("hex"); }
}
