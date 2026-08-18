import { hotelKnowledge } from "./knowledge.js";
import { contactDetails, decideHandoff } from "./handoff.js";
import { sendEmail } from "./email-transport.js";
import { frontDeskEmail } from "./operational-config.js";

const SENDER = "希堤微旅 AI 智慧櫃台 <onboarding@resend.dev>";
const SAFE_IDENTIFIER_KEYS = new Set(["displayName", "email", "phone"]);

function clean(value, limit = 2_000) {
  return typeof value === "string" ? value.trim().slice(0, limit).replace(/[\r\n\u2028\u2029]+/g, " ") : "";
}

function safeIdentity(identity) {
  if (!identity || typeof identity !== "object") return [];
  return Object.entries(identity)
    .filter(([key, value]) => SAFE_IDENTIFIER_KEYS.has(key) && typeof value === "string" && value.trim())
    .map(([key, value]) => `${key}：${clean(value, 254)}`);
}

function minimizedMessage(value, category) {
  let result = clean(value, 1_000);
  if (category === "付款／退款爭議" || category === "私人訂房資料") {
    result = result
      .replace(/\b\d{6,19}\b/g, "[敏感號碼已遮蔽]")
      .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, "[Email 已遮蔽]");
  }
  return result;
}

export function handoffEmail({ channel, message, history = [], category, identity, now = new Date() }) {
  const sensitive = category === "付款／退款爭議" || category === "私人訂房資料";
  const minimizedCurrent = minimizedMessage(message, category);
  const safeHistory = sensitive ? [] : history;
  const conversation = [...safeHistory, { role: "user", content: minimizedCurrent }];
  const details = contactDetails(conversation, now);
  const safeChannel = ["line", "web", "voice", "messenger", "instagram"].includes(channel) ? channel.toUpperCase() : "UNKNOWN";
  const identityLines = safeIdentity(identity);
  return {
    from: SENDER,
    to: [frontDeskEmail()],
    subject: `【AI 真人轉接】${clean(category, 80)}－${safeChannel}`,
    text: [
      `來源 channel：${safeChannel}`,
      `handoff category：${clean(category, 80)}`,
      `時間：${now.toISOString()}`,
      `客人需求摘要：${details.summary}`,
      "最近對話摘要：", details.originalMessage,
      "可用客人識別資訊：", ...(identityLines.length ? identityLines : ["未提供"])
    ].join("\n")
  };
}

export function handoffGuestReply({ delivered, category, channel = "web" }) {
  const contact = `櫃檯電話 ${hotelKnowledge.contact.frontDeskPhone}（07:00–22:00）`;
  if (!delivered) return `不好意思，我這邊目前沒辦法成功把留言送到櫃台。您可以直接聯絡櫃台，我把聯絡方式提供給您：${contact}。`;
  const responses = {
    "停車需求": "可以喔～我已經幫您把停車需求留言給櫃台同仁了。不過車位仍會依當天現場狀況安排，這則留言不代表已保留車位 😊",
    "訂房修改／取消": "我已經幫您把修改需求留言給櫃台同仁了，請等櫃台確認；目前尚未完成任何訂房變更。",
    "付款／退款爭議": "我已經幫您把付款或退款需求留言給櫃台同仁了，請等櫃台確認；目前尚未完成任何款項處理。"
  };
  const response = responses[category] || "可以喔～我已經幫您把需求留言給櫃台同仁了，請等櫃台確認後再協助您處理。";
  return channel === "voice" ? response.replace("可以喔～", "好的，") : response;
}

export async function performHandoff({ message, history = [], channel = "web", identity, now }, { send = sendEmail } = {}) {
  const decision = decideHandoff(message, history);
  if (!decision.required) return { attempted: false, delivered: false, decision };
  const email = handoffEmail({ channel, message, history, category: decision.category, identity, now });
  try {
    await send(email);
    return { attempted: true, delivered: true, decision, answer: handoffGuestReply({ delivered: true, category: decision.category, channel }) };
  } catch (error) {
    console.error("[handoff] Email delivery failed", { code: error?.code || "email_send_failed", channel, category: decision.category });
    return { attempted: true, delivered: false, decision, answer: handoffGuestReply({ delivered: false, category: decision.category, channel }) };
  }
}

export const HANDOFF_AUTHORIZATION_STATES = Object.freeze([
  "needs_human", "handoff_offered", "consent_received", "collecting_required_fields",
  "ready_for_confirmation", "confirmed", "sent", "failed"
]);

/**
 * Channel webhooks may only create the external side effect from durable,
 * server-side confirmation state. Transport history and guest prose never count.
 */
export async function performAuthorizedHandoff(request, { authorization } = {}, dependencies) {
  const decision = decideHandoff(request?.message, request?.history);
  if (!decision.required) return { attempted: false, delivered: false, decision };
  if (authorization?.state !== "confirmed") {
    return {
      attempted: true, delivered: false, authorized: false, decision,
      answer: "我可以先幫您整理這項需求；在送交飯店人員前，還需要由您確認要送出的內容與必要聯絡資料，目前尚未送出。"
    };
  }
  return performHandoff(request, dependencies);
}
