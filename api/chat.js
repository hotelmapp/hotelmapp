import { KNOWLEDGE_VERSION } from "../ai-core/knowledge.js";
import { OpenAIResponseError } from "../ai-core/response-service.js";
import { answerGuestMessage } from "../ai-core/guest-response.js";
import { decideHandoff } from "../ai-core/handoff.js";
import { performHandoff } from "../ai-core/handoff-service.js";

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
    // Operational intents are resolved before any informational or model path.
    // This keeps Email delivery observable and makes the shared service the
    // only possible source of a delivery-success claim.
    const handoffDecision = decideHandoff(message, req.body?.history);
    if (handoffDecision.required) {
      const handoff = await performHandoff({ message, history: req.body?.history, channel: "web" });
      const answer = await answerGuestMessage(message, {
        history: req.body?.history,
        channel: "web",
        // Reuse the already completed deterministic operation while retaining
        // any factual/direct answer that should accompany it.
        handoffService: async () => handoff
      });
      return res.status(200).json({
        answer,
        diagnostic: {
          knowledgeVersion: KNOWLEDGE_VERSION,
          commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "local",
          handoff: { attempted: handoff.attempted, delivered: handoff.delivered }
        }
      });
    }
    const answer = await answerGuestMessage(message, { history: req.body?.history, channel: "web" });
    return res.status(200).json({
      answer,
      diagnostic: {
        knowledgeVersion: KNOWLEDGE_VERSION,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "local"
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
