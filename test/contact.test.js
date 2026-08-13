import test from "node:test";
import assert from "node:assert/strict";
import handler, { emailForContact, validateContact } from "../api/contact.js";

function recorder() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

const validContact = {
  name: "王小明",
  phone: "0912-345-678",
  email: "guest@example.com",
  stayDate: "2026-08-20",
  reason: "設備問題",
  summary: "房內冷氣無法啟動，希望飯店協助。",
  originalMessage: "您好，我 8/20 入住，房間冷氣按了沒有反應，麻煩協助，謝謝。"
};

async function withResendMock(t, implementation, callback) {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "resend-server-secret";
  globalThis.fetch = implementation;
  t.after(() => {
    globalThis.fetch = originalFetch;
    originalKey === undefined ? delete process.env.RESEND_API_KEY : process.env.RESEND_API_KEY = originalKey;
  });
  await callback();
}

test("sends the complete contact email and only confirms after Resend succeeds", async t => {
  await withResendMock(t, async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(options.headers.Authorization, "Bearer resend-server-secret");
    const email = JSON.parse(options.body);
    assert.equal(email.from, "希堤微旅 AI 智慧櫃台 <onboarding@resend.dev>");
    assert.deepEqual(email.to, ["hotel.mapp158@gmail.com"]);
    assert.equal(email.subject, "【AI 客人留言】設備問題－王小明");
    assert.match(email.text, /姓名：王小明/);
    assert.match(email.text, /電話：0912-345-678/);
    assert.match(email.text, /Email：guest@example\.com/);
    assert.match(email.text, /入住日期：2026-08-20/);
    assert.match(email.text, /AI 整理的事由摘要：[\s\S]*房內冷氣無法啟動/);
    assert.match(email.text, /客人原始留言：[\s\S]*房間冷氣按了沒有反應/);
    assert.equal("html" in email, false);
    return new Response(JSON.stringify({ id: "email_123" }), { status: 200 });
  }, async () => {
    const res = recorder();
    await handler({ method: "POST", body: validContact }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { message: "已將留言轉交飯店人員" });
  });
});

test("does not claim delivery when Resend fails", async t => {
  await withResendMock(t, async () => new Response(JSON.stringify({ message: "restricted recipient" }), { status: 403 }), async () => {
    const res = recorder();
    await handler({ method: "POST", body: validContact }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.error, "目前留言未成功送出，請直接聯絡櫃台");
    assert.equal(res.body.code, "email_send_failed");
    assert.equal(JSON.stringify(res.body).includes("restricted recipient"), false);
  });
});

test("rejects missing required fields without contacting Resend", async t => {
  let fetched = false;
  await withResendMock(t, async () => { fetched = true; }, async () => {
    const res = recorder();
    await handler({ method: "POST", body: { name: "王小明", phone: "0912345678" } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "missing_fields");
    assert.deepEqual(res.body.fields, ["reason", "summary", "originalMessage"]);
    assert.equal(fetched, false);
  });
});

test("keeps malicious HTML inert in a plain-text email and strips subject newlines", () => {
  const malicious = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const validation = validateContact({
    ...validContact,
    name: "王小明\r\nBcc: attacker@example.com",
    reason: "設備問題\nInjected",
    originalMessage: malicious
  });
  assert.ok(validation.data);
  const email = emailForContact(validation.data, new Date("2026-08-13T12:34:56Z"));
  assert.equal(email.subject, "【AI 客人留言】設備問題 Injected－王小明 Bcc: attacker@example.com");
  assert.equal("html" in email, false);
  assert.match(email.text, /<img src=x onerror="alert\(1\)"><script>alert\(2\)<\/script>/);
  assert.match(email.text, /留言時間：2026-08-13T12:34:56\.000Z/);
});

test("returns a safe failure when RESEND_API_KEY is missing", async t => {
  const originalKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  t.after(() => {
    if (originalKey !== undefined) process.env.RESEND_API_KEY = originalKey;
  });
  const res = recorder();
  await handler({ method: "POST", body: validContact }, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, {
    error: "目前留言未成功送出，請直接聯絡櫃台",
    code: "email_service_unavailable"
  });
  assert.equal(JSON.stringify(res.body).includes("RESEND_API_KEY"), false);
});

test("validates phone, optional email/date, and field lengths", () => {
  assert.equal(validateContact({ ...validContact, phone: "javascript:alert(1)" }).code, "invalid_phone");
  assert.equal(validateContact({ ...validContact, email: "not-an-email" }).code, "invalid_email");
  assert.equal(validateContact({ ...validContact, stayDate: "2026-02-30" }).code, "invalid_stay_date");
  assert.equal(validateContact({ ...validContact, email: "", stayDate: "" }).data.email, "");
  assert.deepEqual(validateContact({ ...validContact, originalMessage: "x".repeat(5001) }).fields, ["originalMessage"]);
});
