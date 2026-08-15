const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 15_000;

export class EmailDeliveryError extends Error {
  constructor(code) { super(code); this.name = "EmailDeliveryError"; this.code = code; }
}

// The one shared Resend transport used by both the contact form and automatic
// omnichannel handoff. It deliberately returns no upstream body or credentials.
export async function sendEmail(payload, {
  apiKey = process.env.RESEND_API_KEY?.trim(), fetchImpl = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  if (!apiKey) throw new EmailDeliveryError("email_service_unavailable");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(RESEND_EMAILS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: controller.signal
    });
  } catch (error) {
    throw new EmailDeliveryError(error?.name === "AbortError" ? "email_timeout" : "email_connection_failed");
  } finally { clearTimeout(timeout); }
  let body;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok || typeof body?.id !== "string" || !body.id.trim()) {
    throw new EmailDeliveryError("email_send_failed");
  }
  return { delivered: true, id: body.id };
}
