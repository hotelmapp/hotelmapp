import { KNOWLEDGE_VERSION } from "../ai-core/knowledge.js";
import { OpenAIResponseError } from "../ai-core/response-service.js";
import { answerGuestMessage } from "../ai-core/guest-response.js";
import { opaqueConversationId } from "../ai-core/conversation/record.js";
import { answerWithConversation, configuredConversationService } from "../ai-core/conversation/runtime.js";

export * from "../ai-core/guest-response.js";

export const config = { maxDuration: 30 };

function sendError(res, status, error, diagnostic) {
  return res.status(status).json({ error, diagnostic });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Chat-Knowledge-Version", KNOWLEDGE_VERSION);
  res.setHeader("X-Chat-Commit", process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "local");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendError(res, 405, "Method not allowed", { source: "chat", code: "method_not_allowed" });
  }

  const message = req.body?.message;
  if (typeof message !== "string" || !message.trim()) {
    return sendError(res, 400, "請輸入問題", { source: "chat", code: "invalid_message" });
  }

  try {
    const suppliedId = typeof req.body?.conversationId === "string" && /^web_[A-Za-z0-9_-]{24,80}$/.test(req.body.conversationId) ? req.body.conversationId : null;
    const conversationId = suppliedId || opaqueConversationId("web");
    let service;
    try { service = configuredConversationService(); } catch { service = null; }
    const result = service
      ? await answerWithConversation({ id: conversationId, channel: "web", message, service })
      : { answer: await answerGuestMessage(message, { history: req.body?.history, channel: "web" }), durable: false };
    return res.status(200).json({
      answer: result.answer,
      conversationId,
      diagnostic: {
        knowledgeVersion: KNOWLEDGE_VERSION,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "local",
        conversationMemory: result.durable ? "durable" : "stateless"
      }
    });
  } catch (error) {
    const failure = error instanceof OpenAIResponseError ? error : new OpenAIResponseError("connection_failed");
    console.error("[api/chat] OpenAI request failed", failure.diagnostic);
    const messages = {
      missing_api_key: "AI 服務尚未設定", timeout: "OpenAI 請求逾時",
      connection_failed: "無法連線至 OpenAI", response_read_failed: "無法讀取 OpenAI 回應",
      invalid_json: "OpenAI 回應格式無法解析", empty_response: "OpenAI 未回傳文字答案",
      http_error: "OpenAI API 請求失敗"
    };
    return sendError(res, failure.status, messages[failure.code] || messages.http_error, failure.diagnostic);
  }
}
