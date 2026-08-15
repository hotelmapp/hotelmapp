import test from "node:test";
import assert from "node:assert/strict";
import { sendEmail, EmailDeliveryError } from "../ai-core/email-transport.js";

const payload = { from: "a@example.com", to: ["b@example.com"], subject: "test", text: "test" };
const failsWith = code => error => error instanceof EmailDeliveryError && error.code === code;

test("email transport rejects a missing RESEND_API_KEY before fetching", async () => {
  let fetched = false;
  await assert.rejects(sendEmail(payload, { apiKey: "", fetchImpl: async () => { fetched = true; } }), failsWith("email_service_unavailable"));
  assert.equal(fetched, false);
});

test("email transport aborts a timed-out request", async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
  await assert.rejects(sendEmail(payload, { apiKey: "key", fetchImpl, timeoutMs: 5 }), failsWith("email_timeout"));
});

test("email transport maps network rejection safely", async () => {
  await assert.rejects(sendEmail(payload, { apiKey: "key", fetchImpl: async () => { throw new Error("socket secret"); } }), failsWith("email_connection_failed"));
});

for (const [name, response] of [
  ["upstream non-2xx", { ok: false, json: async () => ({ id: "id" }) }],
  ["invalid JSON", { ok: true, json: async () => { throw new SyntaxError("bad json"); } }],
  ["missing email id", { ok: true, json: async () => ({}) }],
  ["invalid email id", { ok: true, json: async () => ({ id: "   " }) }]
]) test(`email transport rejects ${name}`, async () => {
  await assert.rejects(sendEmail(payload, { apiKey: "key", fetchImpl: async () => response }), failsWith("email_send_failed"));
});

