import { contactDetails, stayDateFromHistory } from "../ai-core/handoff.js";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const RECIPIENT = "hotel.mapp158@gmail.com";
const SENDER = "希堤微旅 AI 智慧櫃台 <onboarding@resend.dev>";
const REQUEST_TIMEOUT_MS = 15_000;

const LIMITS = Object.freeze({
  name: 80,
  phone: 30,
  email: 254,
  stayDate: 10,
  summary: 1_000
});

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

export { contactDetails, stayDateFromHistory };

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
    stayDate: validation.data.stayDate || generated.stayDate,
    summary: validation.data.summary || generated.summary
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
