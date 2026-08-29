import { detectGuestLanguage } from "../guest-language.js";
import { validateGroundedResponse } from "./knowledge-grounding.js";
import { verifyFinalResponse } from "./reasoning-core.js";

const GENERIC_PERMISSION_OPENING = /^(?:(?:您好|哈囉|嗨)[～~，,。.!！\s]*)?(?:好的|了解|可以(?:的|喔)?|當然可以|沒問題)(?:[～~，,。.!！\s]|$)/u;
const EXPLICIT_PERMISSION_REQUEST = /(?:可以|可不可以|可否|能不能|能否|請幫|幫我|協助我|\b(?:can|could|may|would)\b.{0,24}\b(?:you|i|we)\b|できますか|可能ですか|お願い|할 수 있|가능한가|도와)/iu;
const NEGATIVE_SUBSIDY_PARTICIPATION = /(?:(?:你們|飯店|希堤微旅).{0,10})?(?:沒有|沒|不)(?:參加|加入).{0,12}(?:國旅|旅遊|住宿|平日)?(?:補助|獎助|活動)|(?:國旅|旅遊|住宿|平日)?(?:補助|獎助|活動).{0,12}(?:沒有|沒|不)(?:參加|加入)/u;
const GREETING_PREFIX = /^(?:(?:您好|哈囉|嗨)[～~，,。.!！\s]*)/u;

function normalizedHistory(history) {
  return Array.isArray(history)
    ? history.filter(turn => turn && (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string")
    : [];
}

export function openingMatchesSpeechAct(answer, message) {
  return !GENERIC_PERMISSION_OPENING.test(String(answer || "").trim()) || EXPLICIT_PERMISSION_REQUEST.test(String(message || ""));
}

export function presentationHasContextualWarmth(answer, message, history = []) {
  const text = String(answer || "").trim();
  const language = detectGuestLanguage(message, normalizedHistory(history));
  if (language === "en") return /\b(?:please|you|your|we|our|glad|welcome|complimentary)\b/iu.test(text);
  if (language === "ja") return /(?:です|ます|ください|いただ|いたします)/u.test(text);
  if (language === "ko") return /(?:요|니다|세요|드립니다)/u.test(text);
  return /(?:您|請|喔|呢|我們|～)/u.test(text);
}

export function answerMatchesCurrentNeed(answer, message, grounding) {
  if (grounding?.topic !== "subsidy" || !["subsidy_overview", "subsidy_participation"].includes(grounding?.intent) || !NEGATIVE_SUBSIDY_PARTICIPATION.test(String(message || ""))) return true;
  const opening = String(answer || "").trim().replace(GREETING_PREFIX, "");
  return /^有參加(?:過|的)?(?:喔|哦|唷|，|。|！|!|～|~|\s)/u.test(opening);
}

export function validateUnifiedReply({ answer, message, history = [], grounding, selectedFacts = [], toolResult = { status: "not_requested" } }) {
  const factual = verifyFinalResponse({ answer, selectedFacts, toolResult });
  if (!factual.valid) return factual;
  if (!validateGroundedResponse(answer, grounding)) return { valid: false, reason: "grounding_contract_violation" };
  if (!answerMatchesCurrentNeed(answer, message, grounding)) return { valid: false, reason: "current_need_not_answered_first" };
  if (!openingMatchesSpeechAct(answer, message)) return { valid: false, reason: "irrelevant_permission_opening" };
  if (!presentationHasContextualWarmth(answer, message, history)) return { valid: false, reason: "missing_contextual_warmth" };
  return { valid: true };
}
