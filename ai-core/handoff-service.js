import { hotelKnowledge } from "./knowledge.js";
import { contactDetails, decideHandoff } from "./handoff.js";
import { sendEmail } from "./email-transport.js";
import { frontDeskEmail } from "./operational-config.js";
import { hasBookingIntent } from "./booking.js";
import { explicitTopic } from "./knowledge-grounding.js";

const SENDER = "希堤微旅 AI 智慧櫃台 <onboarding@resend.dev>";
const SAFE_IDENTIFIER_KEYS = new Set(["displayName", "email", "phone"]);
const PHONE_PATTERN = /(?<!\d)(?:\+?886[- ]?)?0?9\d{2}[- ]?\d{3}[- ]?\d{3}(?!\d)/u;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const CONFIRM_PATTERN = /^(?:好|好的|可以|確認|確認送出|同意|送出|麻煩送出|ok|okay|yes|可以送出)[！!。,.\s]*$/iu;
const CANCEL_PATTERN = /^(?:不要|不用|取消|先不用|不用了|no|cancel)[！!。,.\s]*$/iu;

function clean(value, limit = 2_000) {
  return typeof value === "string" ? value.trim().slice(0, limit).replace(/[\r\n\u2028\u2029]+/g, " ") : "";
}

function normalizePhone(value) {
  const raw = clean(value, 40);
  if (!raw) return "";
  const match = raw.match(PHONE_PATTERN)?.[0] || "";
  return match.replace(/[ -]/g, "");
}

function normalizeEmail(value) {
  return clean(value, 254).match(EMAIL_PATTERN)?.[0]?.toLowerCase() || "";
}

function normalizeDisplayName(value) {
  return clean(value, 80).replace(/[，,;；].*$/u, "");
}

export function extractHandoffContact(message, identity = {}) {
  const text = clean(message, 1_000);
  const phone = normalizePhone(identity?.phone) || normalizePhone(text);
  const email = normalizeEmail(identity?.email) || normalizeEmail(text);
  let displayName = normalizeDisplayName(identity?.displayName);
  if (!displayName && (phone || email)) {
    const beforeContact = text.split(phone || email)[0].replace(/[，,：:\s]+$/u, "").trim();
    if (beforeContact && beforeContact.length <= 40 && !/^(?:電話|手機|email|e-mail)$/iu.test(beforeContact)) displayName = beforeContact;
  }
  return { ...(displayName ? { displayName } : {}), ...(phone ? { phone } : {}), ...(email ? { email } : {}) };
}

export function hasRequiredHandoffContact(contact = {}) {
  return Boolean(clean(contact.displayName, 80) && (normalizePhone(contact.phone) || normalizeEmail(contact.email)));
}

function maskedContact(contact = {}) {
  const phone = normalizePhone(contact.phone);
  const email = normalizeEmail(contact.email);
  const name = clean(contact.displayName, 80);
  const phoneText = phone ? `${phone.slice(0, 4)}***${phone.slice(-3)}` : "";
  const emailText = email ? email.replace(/^(.{1,2}).*(@.*)$/u, "$1***$2") : "";
  return [name, phoneText || emailText].filter(Boolean).join("／");
}

function confirmationReply({ category, contact }) {
  return `好的，我先幫您整理好了。這次要送交櫃檯的是「${clean(category, 80)}」，聯絡資料是 ${maskedContact(contact)}。為了避免誤送，請您最後確認一次：回覆「確認送出」後，我才會正式送交櫃檯。`;
}

function collectContactReply() {
  return "好的，我可以幫您整理給櫃檯。送出前需要先確認必要聯絡資料，請提供您的姓名，以及聯絡電話或 Email；收到後我會再整理內容請您做最後確認。";
}

function cancelHandoffReply() {
  return "沒問題，我先取消這次轉接，不會送出資料。如果之後需要櫃檯協助，再告訴我就可以了。";
}

function startsIndependentServiceQuestion(message) {
  return Boolean(explicitTopic(message) || hasBookingIntent(message));
}

/**
 * Durable handoff state machine. Guest prose is never authorization by itself:
 * contact collection and an explicit final confirmation are separate states.
 */
export function advanceHandoffAuthorization({ message, history = [], identity, current } = {}) {
  const existing = current && typeof current === "object" ? current : { state: "none" };
  const state = existing.state || "none";
  const decision = decideHandoff(message, history);

  if (state === "ready_for_confirmation") {
    if (CANCEL_PATTERN.test(clean(message, 80))) return { handoff: { state: "none" }, reply: cancelHandoffReply(), authorized: false };
    if (CONFIRM_PATTERN.test(clean(message, 80)) && hasRequiredHandoffContact(existing.contact)) {
      return { handoff: { ...existing, state: "confirmed" }, authorized: true };
    }
    if (!decision.required && startsIndependentServiceQuestion(message)) return { handoff: { state: "none" }, authorized: false };
    return { handoff: existing, reply: confirmationReply(existing), authorized: false };
  }

  if (state === "collecting_required_fields") {
    if (CANCEL_PATTERN.test(clean(message, 80))) return { handoff: { state: "none" }, reply: cancelHandoffReply(), authorized: false };
    if (!decision.required && startsIndependentServiceQuestion(message)) return { handoff: { state: "none" }, authorized: false };
    const contact = { ...(existing.contact || {}), ...extractHandoffContact(message, identity) };
    if (!hasRequiredHandoffContact(contact)) return { handoff: { ...existing, contact, state: "collecting_required_fields" }, reply: collectContactReply(), authorized: false };
    const handoff = { ...existing, contact, state: "ready_for_confirmation" };
    return { handoff, reply: confirmationReply(handoff), authorized: false };
  }

  if (state === "confirmed") return { handoff: existing, authorized: true };
  if (state === "sent" || state === "failed") {
    if (!decision.required) return { handoff: existing, authorized: false };
  }
  if (!decision.required) return { handoff: existing, authorized: false };

  const contact = extractHandoffContact(message, identity);
  if (!hasRequiredHandoffContact(contact)) {
    return {
      handoff: { state: "collecting_required_fields", category: decision.category, contact },
      reply: collectContactReply(),
      authorized: false
    };
  }
  const handoff = { state: "ready_for_confirmation", category: decision.category, contact };
  return { handoff, reply: confirmationReply(handoff), authorized: false };
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
    "訂房修改／取消": "好的，您的修改需求已成功送交櫃檯信箱，請等櫃檯確認；目前尚未完成任何訂房變更。",
    "付款／退款爭議": "好的，您的付款或退款需求已成功送交櫃檯信箱，請等櫃檯確認；目前尚未完成任何款項處理。"
  };
  const response = responses[category] || "好的～您的需求已成功送交櫃檯信箱，請等櫃檯確認後再協助您處理。";
  return channel === "voice" ? response.replace("好的～", "好的，") : response;
}

export async function performHandoff({ message, history = [], channel = "web", identity, now, category }, { send = sendEmail } = {}) {
  const decision = category ? { required: true, category } : decideHandoff(message, history);
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
  const decision = authorization?.category
    ? { required: true, category: authorization.category }
    : decideHandoff(request?.message, request?.history);
  if (!decision.required) return { attempted: false, delivered: false, decision };
  if (authorization?.state !== "confirmed" || !hasRequiredHandoffContact(authorization?.contact)) {
    return {
      attempted: false, delivered: false, authorized: false, decision,
      answer: "目前尚未送出。需要先完成聯絡資料與最後確認，我才會正式送交櫃檯。"
    };
  }
  return performHandoff({ ...request, category: decision.category, identity: { ...(request?.identity || {}), ...authorization.contact } }, dependencies);
}
