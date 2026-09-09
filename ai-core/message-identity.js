// Transport-owned identity, applied after the shared AI has finished its reply.
// Keep it out of prompts/history and do not let generated prose claim staff identity.
export const AI_LABEL = "【AI 小幫手】";
export function aiMessage(text) {
  if (typeof text !== "string") throw new Error("invalid_ai_message");
  const content = text.replace(/【真人櫃檯回覆】/gu, "")
    .replace(/^(?:\s*【AI\s*小幫手】\s*)+/u, "").trim();
  if (!content) throw new Error("invalid_ai_message");
  return AI_LABEL + "\n" + content;
}
