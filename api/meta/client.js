const DEFAULT_GRAPH_VERSION = "v26.0";
const SEND_TIMEOUT_MS = 8_000;

export class MetaSendError extends Error {
  constructor(code, { status, requestId, cause } = {}) {
    super(code, { cause }); this.name = "MetaSendError"; this.code = code; this.status = status; this.requestId = requestId;
  }
}

async function sendMetaText({ recipientId, text, accessToken, graphVersion = DEFAULT_GRAPH_VERSION, fetchImpl = fetch, messagingType }) {
  if (!recipientId || !text || !accessToken) throw new MetaSendError("meta_send_not_configured");
  let response;
  try {
    response = await fetchImpl(`https://graph.facebook.com/${graphVersion}/me/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: recipientId }, ...(messagingType ? { messaging_type: messagingType } : {}), message: { text } }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
    });
  } catch (cause) { throw new MetaSendError("meta_send_unavailable", { cause }); }
  if (!response.ok) throw new MetaSendError("meta_send_failed", {
    status: response.status,
    requestId: response.headers?.get?.("x-fb-trace-id") || undefined
  });
  return { sent: true };
}

export function sendMessengerText(options) {
  return sendMetaText({ ...options, messagingType: "RESPONSE" });
}

/** Instagram's Send API uses the same Graph boundary without Messenger's messaging_type. */
export function sendInstagramText(options) {
  return sendMetaText(options);
}
