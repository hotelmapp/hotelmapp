const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const RECIPIENT = "hotel.mapp158@gmail.com";
const SENDER = "希堤微旅 AI 智慧櫃台 <onboarding@resend.dev>";
const REQUEST_TIMEOUT_MS = 15_000;

const LIMITS = Object.freeze({
  name: 80,
  phone: 30,
  email: 254,
  stayDate: 10
});
const MAX_HISTORY_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 2_000;

export const config = { maxDuration: 20 };

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validateContact(body) {
  const data = Object.fromEntries(Object.keys(LIMITS).map(field => [field, cleanString(body?.[field])]));
  const required = ["name", "phone"];
  const missing = required.filter(field => !data[field]);
  if (missing.length) return { error: "請填寫所有必填欄位", code: "missing_fields", fields: missing };

  const tooLong = Object.entries(LIMITS).find(([field, limit]) => data[field].length > limit);
  if (tooLong) return { error: "欄位內容過長", code: "field_too_long", fields: [tooLong[0]] };
  if (!/^[0-9+()\-\s#]{6,30}$/.test(data.phone)) {
    return { error: "電話格式不正確", code: "invalid_phone", fields: ["phone"] };
  }
  if (data.email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(data.email)) {
    return { error: "Email 格式不正確", code: "invalid_email", fields: ["email"] };
  }
  if (data.stayDate && !validDate(data.stayDate)) {
    return { error: "入住日期格式不正確", code: "invalid_stay_date", fields: ["stayDate"] };
  }
  return { data };
}

function normalizedHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(item => item?.role === "user" && typeof item.content === "string")
    .map(item => cleanString(item.content).slice(0, MAX_MESSAGE_LENGTH))
    .filter(Boolean)
    .slice(-MAX_HISTORY_MESSAGES);
}

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10)
    : "";
}

export function stayDateFromHistory(history, now = new Date()) {
  for (const message of normalizedHistory(history).reverse()) {
    const match = message.match(/(?:(\d{4})\s*[年\/-]\s*)?(\d{1,2})\s*(?:月|[\/-])\s*(\d{1,2})\s*日?/u);
    if (!match) continue;
    let year = match[1] ? Number(match[1]) : now.getUTCFullYear();
    const month = Number(match[2]);
    const day = Number(match[3]);
    let date = isoDate(year, month, day);
    if (!date) continue;
    if (!match[1] && date < now.toISOString().slice(0, 10)) date = isoDate(++year, month, day);
    if (date) return date;
  }
  return "";
}

export function contactDetails(history, now = new Date()) {
  const messages = normalizedHistory(history);
  const originalMessage = messages.slice(-3).join("\n") || "（對話中無旅客留言）";
  const text = messages.join("\n");
  const categories = [
    ["設備問題", /(故障|壞掉|無法使用|沒反應|冷氣|電視|設備|wifi|網路)/iu],
    ["停車", /(停車|車位)/u],
    ["早餐", /(早餐|餐點)/u],
    ["入住需求", /(提早入住|延後退房|入住需求|check[ -]?in|check[ -]?out)/iu],
    ["訂房詢問", /(訂房|空房|房況|房價|住宿)/u],
    ["特殊需求", /(特殊需求|嬰兒|寵物|無障礙|加床|過敏|素食|慶生)/u]
  ];
  const reason = categories.find(([, pattern]) => pattern.test(text))?.[0] || "其他";
  const summarySource = messages.slice(-2).join("；");
  const summary = summarySource
    ? `旅客詢問／反映：${summarySource.slice(0, 900)}${summarySource.length > 900 ? "…" : ""}`
    : "旅客希望飯店人員主動聯絡，但尚未在對話中說明具體需求。";
  return { reason, summary, originalMessage, stayDate: stayDateFromHistory(history, now) };
}

function singleLine(value) {
  return value.replace(/[\r\n\u2028\u2029]+/g, " ");
}

export function emailForContact(data, now = new Date()) {
  return {
    from: SENDER,
    to: [RECIPIENT],
    subject: `【AI 客人留言】${singleLine(data.reason)}－${singleLine(data.name)}`,
    text: [
      `留言時間：${now.toISOString()}`,
      `姓名：${data.name}`,
      `電話：${data.phone}`,
      `Email：${data.email || "未提供"}`,
      `入住日期：${data.stayDate || "未提供"}`,
      `事由分類：${data.reason}`,
      "",
      "AI 整理的事由摘要：",
      data.summary,
      "",
      "客人原始留言：",
      data.originalMessage
    ].join("\n")
  };
}

function reply(res, status, body) {
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return reply(res, 405, { error: "Method not allowed", code: "method_not_allowed" });
  }

  const validation = validateContact(req.body);
  if (validation.error) return reply(res, 400, validation);
  const generated = contactDetails(req.body?.conversationHistory);
  validation.data = {
    ...validation.data,
    ...generated,
    stayDate: validation.data.stayDate || generated.stayDate
  };

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.error("[api/contact] RESEND_API_KEY is not configured");
    return reply(res, 500, {
      error: "目前留言未成功送出，請直接聯絡櫃台",
      code: "email_service_unavailable"
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(RESEND_EMAILS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(emailForContact(validation.data)),
      signal: controller.signal
    });
  } catch (error) {
    console.error("[api/contact] Resend request failed", { name: error?.name });
    return reply(res, 502, {
      error: "目前留言未成功送出，請直接聯絡櫃台",
      code: error?.name === "AbortError" ? "email_timeout" : "email_connection_failed"
    });
  } finally {
    clearTimeout(timeout);
  }

  let body;
  try {
    body = await upstream.json();
  } catch {
    body = null;
  }
  if (!upstream.ok || typeof body?.id !== "string" || !body.id.trim()) {
    console.error("[api/contact] Resend rejected email", { status: upstream.status });
    return reply(res, 502, {
      error: "目前留言未成功送出，請直接聯絡櫃台",
      code: "email_send_failed"
    });
  }

  return reply(res, 200, { message: "已將留言轉交飯店人員" });
}
