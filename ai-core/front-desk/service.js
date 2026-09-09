import { randomUUID } from "node:crypto";
import { lineConversationId, metaConversationId, minimizeConversationText } from "../conversation/record.js";
import { FrontDeskStore, FrontDeskError, deskEnabled, deskNamespace, validDeskId } from "./store.js";
import { assertDeskConfiguration } from "./auth.js";
import { sendMessengerText } from "../../api/meta/client.js";

export const HUMAN_LABEL = "【真人櫃檯回覆】";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function frontDeskService(conversations, env = process.env) {
  if (!deskEnabled(env)) return null;
  assertDeskConfiguration(env);
  return new FrontDeskService({
    store: new FrontDeskStore({ redis: conversations?.store, dataKey: env.FRONT_DESK_DATA_KEY, prefix: deskNamespace(env) }),
    conversations, env
  });
}
export function humanReply(text) {
  if (typeof text !== "string" || !text.trim() || text.length > 1500) throw new FrontDeskError("invalid_reply", 400);
  const content = text.split(HUMAN_LABEL).join("").trim();
  if (!content) throw new FrontDeskError("invalid_reply", 400);
  return HUMAN_LABEL + "\n" + content;
}
// Switching off the workbench UI is not consent to resume an existing hold.
// This check needs no decryption key and remains active when the opt-in is off.
export async function preserveHumanHold({ conversations, id, channel, message, env = process.env }) {
  if (typeof conversations?.store?.command !== "function") return false;
  if (!validDeskId(id)) throw new FrontDeskError("invalid_conversation", 400);
  const held = await conversations.store.command(["EVAL", HOLD_SCRIPT, "1", deskNamespace(env) + "control:" + id]);
  if (Number(held) !== 1) return false;
  // Fail closed on an unknown stored mode as well as an active human hold.
  await conversations.append(id, channel, [{ role: "user", content: message }]);
  return true;
}
export const HOLD_SCRIPT = "local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end; local c=cjson.decode(raw); if c.mode=='ai' then return 0 end; c.inboundVersion=(c.inboundVersion or 0)+1; redis.call('SET',KEYS[1],cjson.encode(c)); return 1";
export function assertReplyWindow(route, now) {
  const windowMs = route?.channel === "messenger" ? 24 * 60 * 60_000 : 7 * 24 * 60 * 60_000;
  if (!route || !Number.isFinite(route.lastInboundAt) || route.lastInboundAt > now || now - route.lastInboundAt >= windowMs) throw new FrontDeskError("reply_window_expired", 409);
}
export async function sendStaffText({ route, text, requestId, env = process.env, fetchImpl = fetch }) {
  if (route.channel === "messenger") {
    return sendMessengerText({ recipientId: route.recipientId, text, accessToken: env.META_PAGE_ACCESS_TOKEN, graphVersion: env.META_GRAPH_API_VERSION, fetchImpl });
  }
  if (route.channel !== "line" || !env.LINE_CHANNEL_ACCESS_TOKEN) throw new FrontDeskError("channel_not_configured", 503);
  const response = await fetchImpl("https://api.line.me/v2/bot/message/push", {
    method: "POST", headers: { Authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN, "Content-Type": "application/json", "X-Line-Retry-Key": requestId },
    body: JSON.stringify({ to: route.recipientId, messages: [{ type: "text", text }] }), signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new FrontDeskError("channel_send_rejected", 502);
  return { sent: true };
}

export class FrontDeskService {
  constructor({ store, conversations, env = process.env, send = sendStaffText }) {
    this.store = store; this.conversations = conversations; this.env = env; this.send = send;
  }
  async register(id, route) {
    const expected = route.channel === "line"
      ? lineConversationId({ type: "user", userId: route.recipientId }, this.env.CONVERSATION_HMAC_SECRET)
      : metaConversationId({ platform: "messenger", pageId: route.pageId, senderId: route.recipientId }, this.env.CONVERSATION_HMAC_SECRET);
    if (id !== expected || !["line", "messenger"].includes(route.channel)) throw new FrontDeskError("invalid_conversation", 400);
    if (!Number.isFinite(route.lastInboundAt) || route.lastInboundAt < 0 || route.lastInboundAt > this.store.now() + 30_000) throw new FrontDeskError("invalid_event_time", 400);
    await this.store.register(id, { ...route, lastInboundAt: Math.min(route.lastInboundAt, this.store.now()) });
  }
  async incoming({ id, channel, message, route, generate, send }) {
    if (channel !== route.channel) throw new FrontDeskError("invalid_conversation", 400);
    await this.register(id, route);
    const token = randomUUID();
    const epoch = await this.store.transition("begin_ai", id, { token });
    if (epoch === "paused") {
      await this.conversations.append(id, channel, [{ role: "user", content: message }]);
      return { outcome: "human", conversationId: id };
    }
    if (!/^\d+$/.test(String(epoch))) throw new FrontDeskError("conversation_busy", 503);
    const mayAct = async () => (await this.store.transition("check_ai", id, { token, epoch })) === "ok";
    let persistenceAttempted = false;
    try {
      const result = await generate(mayAct);
      const visible = typeof result.answer === "string" && result.answer.trim() && !result.suppressed && await mayAct();
      const text = visible ? result.answer.split(HUMAN_LABEL).join("").trim() : "";
      if (text) await send(text);
      // Only messages accepted by the channel become assistant history.
      persistenceAttempted = true;
      await this.conversations.append(id, channel, [
        { role: "user", content: message },
        ...(text ? [{ role: "assistant", content: text }] : [])
      ], result.metadata || {});
      return { outcome: text ? "replied" : "human", conversationId: id };
    } catch (error) {
      // A failed model/channel call must not hide the guest's question from
      // staff. Never repeat an append whose result itself is uncertain.
      if (!persistenceAttempted) await this.conversations.append(id, channel, [{ role: "user", content: message }]);
      throw error;
    } finally {
      await this.store.transition("release", id, { token });
    }
  }
  async detail(id) {
    if (!validDeskId(id)) throw new FrontDeskError("invalid_conversation", 400);
    const [control, context, route] = await Promise.all([this.store.control(id), this.conversations.context(id), this.store.route(id)]);
    if (!control) throw new FrontDeskError("conversation_not_found", 404);
    const mode = control.mode;
    return {
      id, channel: id.startsWith("line_") ? "line" : "messenger", control, revision: context?.revision ?? -1,
      turns: (context?.turns || []).map(({ role, content, at, source }) => ({ role, content, at, ...(source ? { source } : {}) })),
      routeAvailable: Boolean(route),
      replyWindowOpen: Boolean(route && this.store.now() >= route.lastInboundAt && this.store.now() - route.lastInboundAt < (route.channel === "messenger" ? 24 : 7 * 24) * 60 * 60_000),
      reminder: mode !== "ai" && this.store.now() - control.takenAt > 30 * 60_000
    };
  }
  async inbox() {
    const ids = await this.store.ids(), items = [];
    // Small batched reads avoid a route decryption and three HTTP requests
    // per sidebar row on every refresh. Reconciliation happens on detail.
    for (let start = 0; start < ids.length; start += 10) {
      const batch = ids.slice(start, start + 10);
      const values = await this.store.command(["MGET", ...batch.flatMap(id => [this.store.key("control", id), this.conversations.store.key(id)])]);
      for (let i = 0; i < batch.length; i++) {
        if (!values[i * 2]) continue;
        const control = JSON.parse(values[i * 2]), context = values[i * 2 + 1] ? JSON.parse(values[i * 2 + 1]) : null;
        const last = context && Date.parse(context.expiresAt) > this.store.now() ? context.turns?.at(-1) : null;
        items.push({ id: batch[i], channel: batch[i].startsWith("line_") ? "line" : "messenger", control, reminder: control.mode !== "ai" && this.store.now() - control.takenAt > 30 * 60_000, preview: last?.content?.slice(0, 100) || "對話內容已過期，請在原平台確認", lastAt: last?.at || null });
      }
    }
    return items;
  }
  async takeover(id) {
    const result = await this.store.transition("takeover", id);
    if (result === "missing") throw new FrontDeskError("conversation_not_found", 404);
    return JSON.parse(result);
  }
  async reply({ id, text, epoch, requestId }) {
    if (!validDeskId(id) || !UUID.test(requestId || "") || !Number.isSafeInteger(epoch)) throw new FrontDeskError("invalid_request", 400);
    const body = humanReply(text);
    const route = await this.store.route(id);
    assertReplyWindow(route, this.store.now());
    const token = randomUUID();
    const journal = { status: "pending", at: this.store.now(), requestId, fingerprint: this.store.digest(body + ":" + epoch) };
    const acquired = await this.store.transition("begin_reply", id, { token, epoch, requestId, journal: JSON.stringify(journal) });
    if (acquired === "duplicate") {
      const previous = await this.store.journal(id, requestId);
      if (previous?.fingerprint !== journal.fingerprint) throw new FrontDeskError("request_id_reused");
      return { requestId, status: previous.status, duplicate: true };
    }
    if (acquired !== "ok") throw new FrontDeskError(acquired === "busy" ? "conversation_busy" : "stale_state");
    let status = "uncertain";
    try {
      await this.send({ route, text: body, requestId, env: this.env });
      await this.conversations.append(id, route.channel, [{ role: "assistant", content: body, source: "staff" }]);
      status = "accepted";
    } catch {
      // A timeout or an uncertain write must never be retried automatically.
      // API acceptance means sent to the platform, NOT read by the guest.
    }
    await this.store.transition("complete_reply", id, { token, epoch, requestId, status, journal: JSON.stringify({ ...journal, status }) });
    return { requestId, status };
  }
  async replyStatus({ id, requestId }) {
    if (!validDeskId(id) || !UUID.test(requestId || "")) throw new FrontDeskError("invalid_request", 400);
    const previous = await this.store.journal(id, requestId);
    // Status lookup never invokes send, even if the journal has expired.
    return { requestId, status: previous?.status || "unknown" };
  }
  async close({ id, epoch, summary, revision, inboundVersion }) {
    if (!Number.isSafeInteger(epoch) || !Number.isSafeInteger(revision) || !Number.isSafeInteger(inboundVersion) || typeof summary !== "string" || !summary.trim() || summary.length > 500) throw new FrontDeskError("summary_required", 400);
    const token = randomUUID();
    const acquired = await this.store.transition("begin_close", id, { token, epoch, inboundVersion });
    if (acquired !== "ok") throw new FrontDeskError(acquired === "busy" ? "conversation_busy" : acquired === "new_messages_arrived" ? acquired : "stale_state");
    try {
      await this.conversations.append(id, id.startsWith("line_") ? "line" : "messenger", [{
        role: "assistant", source: "staff_note", content: "【櫃檯處理摘要：僅作對話背景，不是新的飯店規則】" + minimizeConversationText(summary)
      }], { handoff: { state: "none" }, expectedRevision: revision });
      const result = await this.store.transition("complete_close", id, { token, epoch, inboundVersion });
      if (result !== "ok") throw new FrontDeskError(result === "new_messages_arrived" ? result : "stale_state");
      return { mode: "ai" };
    } finally { await this.store.transition("release", id, { token }); }
  }
}
