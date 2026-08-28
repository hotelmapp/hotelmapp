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
const OFFER_ACCEPT_PATTERN = /^(?:需要|需要喔|要|好|好的|可以|麻煩|麻煩你|請幫我|ok|okay|yes)[！!。,．.～~\s]*$/iu;
const HANDOFF_OFFER_PATTERN = /需要我幫您.{0,12}(?:(?:通知|聯絡|轉告).{0,8}(?:櫃台|櫃檯|飯店人員)|(?:轉請|請).{0,8}(?:櫃台|櫃檯|飯店人員).{0,8}(?:回覆|確認))嗎|(?:留下|提供).{0,24}(?:聯絡方式|電話|email).{0,24}(?:整理|留言|轉交).{0,18}(?:櫃台|櫃檯|飯店人員).{0,24}(?:回覆|聯絡|確認)/iu;
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

function displayNameNearContact(value) {
  const candidate = clean(value, 80).replace(/^[，,：:。.!！?？\s]+|[，,：:。.!！?？\s]+$/gu, "");
  if (!candidate) return "";
  const titled = candidate.match(/(?:我是|我叫|姓名(?:是|叫|為)?|聯絡人(?:是|叫|為)?)?([\p{Script=Han}A-Za-z·]{1,8}(?:先生|小姐|女士|太太))/u)?.[1];
  if (titled) return normalizeDisplayName(titled);
  const explicit = candidate.match(/^(?:我是|我叫|姓名(?:是|叫|為)?|聯絡人(?:是|叫|為)?)[：:\s]*([\p{L}·]{1,20})$/u)?.[1];
  if (explicit) return normalizeDisplayName(explicit);
  const datedName = candidate.match(/(?:\d{1,2}月\d{1,2}(?:日)?|\d{1,2}[/-]\d{1,2})[\s，,]*([\p{Script=Han}]{2,4})$/u)?.[1];
  if (datedName) return normalizeDisplayName(datedName);
  const trailingName = candidate.match(/[，,\s]([\p{Script=Han}]{2,4})$/u)?.[1];
  if (trailingName && !/(?:電話|手機|訂房|入住|需要|聯絡)/u.test(trailingName)) return normalizeDisplayName(trailingName);
  return /^[\p{L}·]{1,20}$/u.test(candidate) ? normalizeDisplayName(candidate) : "";
}

export function extractHandoffContact(message, identity = {}) {
  const text = clean(message, 1_000);
  const phoneInMessage = text.match(PHONE_PATTERN)?.[0] || "";
  const emailInMessage = text.match(EMAIL_PATTERN)?.[0] || "";
  const phone = normalizePhone(identity?.phone) || normalizePhone(phoneInMessage);
  const email = normalizeEmail(identity?.email) || normalizeEmail(emailInMessage);
  let displayName = normalizeDisplayName(identity?.displayName);
  const contactInMessage = phoneInMessage || emailInMessage;
  if (!displayName && contactInMessage) {
    const contactIndex = text.indexOf(contactInMessage);
    const beforeContact = text.slice(0, contactIndex);
    const afterContact = text.slice(contactIndex + contactInMessage.length);
    displayName = displayNameNearContact(afterContact) || displayNameNearContact(beforeContact);
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
  return `好的，我先幫您整理好了。這次要送交櫃檯的是「${clean(category, 80)}」，聯絡資料是 ${maskedContact(contact)}。如果資料正確，回覆「確認送出」或「好的」即可；收到確認後我才會正式寄給櫃檯。`;
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

function acceptsRecentHandoffOffer(message, history) {
  if (!OFFER_ACCEPT_PATTERN.test(clean(message, 80)) || !Array.isArray(history)) return false;
  const latestTurn = [...history].reverse().find(item => item && typeof item.content === "string");
  return latestTurn?.role === "assistant" && HANDOFF_OFFER_PATTERN.test(clean(latestTurn.content, 1_000));
}

/**
 * Durable handoff state machine. Guest prose is never authorization by itself:
 * contact collection and an explicit final confirmation are separate states.
 */
export function advanceHandoffAuthorization({ message, history = [], identity, current } = {}) {
  const existing = current && typeof current === "object" ? current : { state: "none" };
  const state = existing.state || "none";
  const detected = decideHandoff(message, history);
  const decision = detected.required || !acceptsRecentHandoffOffer(message, history)
    ? detected
    : { required: true, category: "真人服務" };

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
    const extracted = extractHandoffContact(message, identity);
    const contact = { ...(existing.contact || {}), ...extracted };
    const hasAnyContact = Object.values(contact).some(value => clean(value, 254));
    if (!hasRequiredHandoffContact(contact) && !hasAnyContact && !decision.required && startsIndependentServiceQuestion(message)) return { handoff: { state: "none" }, authorized: false };
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
  if (!identity || typeof identity !== "object") return {};
  return Object.fromEntries(Object.entries(identity)
    .filter(([key, value]) => SAFE_IDENTIFIER_KEYS.has(key) && typeof value === "string" && value.trim())
    .map(([key, value]) => [key, clean(value, 254)]));
}

function taipeiTime(now) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).format(now).replace(/\s+/gu, " ");
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
  const safeContact = safeIdentity(identity);
  return {
    from: SENDER,
    to: [frontDeskEmail()],
    subject: `【AI 真人轉接】${clean(category, 80)}－${safeChannel}`,
    text: [
      "希堤微旅櫃檯您好：",
      "",
      `有一位旅客透過 ${safeChannel} 請求櫃檯協助，資料如下：`,
      "",
      `需求類型：${clean(category, 80)}`,
      `客人需求：${details.summary}`,
      `旅客姓名：${safeContact.displayName || "未提供"}`,
      `聯絡電話：${safeContact.phone || "未提供"}`,
      `聯絡 Email：${safeContact.email || "未提供"}`,
      `入住日期：${details.stayDate || "未提供"}`,
      `留言時間：${taipeiTime(now)}（台灣時間）`,
      "",
      "最近對話：",
      details.originalMessage,
      "",
      "此信由希堤微旅 AI 智慧櫃台自動寄出，請依上述內容聯絡旅客。"
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
