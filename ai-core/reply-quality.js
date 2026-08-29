import { detectGuestLanguage } from "../guest-language.js";
import { validateGroundedResponse } from "./knowledge-grounding.js";
import { verifyFinalResponse } from "./reasoning-core.js";

const GENERIC_PERMISSION_OPENING = /^(?:(?:您好|哈囉|嗨)[～~，,。.!！\s]*)?(?:好的|了解|可以(?:的|喔)?|當然可以|沒問題)(?:[～~，,。.!！\s]|$)/u;
const EXPLICIT_PERMISSION_REQUEST = /(?:可以|可不可以|可否|能不能|能否|請幫|幫我|協助我|\b(?:can|could|may|would)\b.{0,24}\b(?:you|i|we)\b|できますか|可能ですか|お願い|할 수 있|가능한가|도와)/iu;
const NEGATIVE_SUBSIDY_PARTICIPATION = /(?:(?:你們|飯店|希堤微旅).{0,10})?(?:沒有|沒|不)(?:參加|加入).{0,12}(?:國旅|旅遊|住宿|平日)?(?:補助|獎助|活動)|(?:國旅|旅遊|住宿|平日)?(?:補助|獎助|活動).{0,12}(?:沒有|沒|不)(?:參加|加入)/u;
const GREETING_PREFIX = /^(?:(?:您好|哈囉|嗨)[～~，,。.!！\s]*)/u;
const CONTEXTUAL_ACKNOWLEDGEMENT = /^(?:(?:您好|哈囉|嗨)[～~，,。.!！\s]*)?了解[～~，,。.!！\s]*您.{0,30}(?:想|詢問|確認|在意|擔心|提到)/u;

function normalizedHistory(history) {
  return Array.isArray(history)
    ? history.filter(turn => turn && (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string")
    : [];
}

export function openingMatchesSpeechAct(answer, message) {
  const text = String(answer || "").trim();
  return CONTEXTUAL_ACKNOWLEDGEMENT.test(text) || !GENERIC_PERMISSION_OPENING.test(text) || EXPLICIT_PERMISSION_REQUEST.test(String(message || ""));
}

export function presentationHasContextualWarmth(answer, message, history = []) {
  const text = String(answer || "").trim();
  const language = detectGuestLanguage(message, normalizedHistory(history));
  if (language === "en") return /\b(?:please|you|your|we|our|glad|welcome|complimentary)\b/iu.test(text);
  if (language === "ja") return /(?:です|ます|ください|いただ|いたします)/u.test(text);
  if (language === "ko") return /(?:요|니다|세요|드립니다)/u.test(text);
  // 「請以規定為準」 is formal politeness, not contextual hospitality.
  // Warmth must contain a guest-facing relation, a natural particle, or a
  // service-oriented next step rather than a lone polite imperative.
  return /(?:您|喔|呢|我們|～|方便告訴|我可以|先幫您|別擔心)/u.test(text);
}

export function answerMatchesCurrentNeed(answer, message, grounding) {
  if (grounding?.topic !== "subsidy") return true;
  const text = String(answer || "").trim();
  if (["subsidy_overview", "subsidy_participation"].includes(grounding?.intent) && NEGATIVE_SUBSIDY_PARTICIPATION.test(String(message || ""))) {
    const opening = text.replace(GREETING_PREFIX, "");
    return /^有參加(?:過|的)?(?:喔|哦|唷|，|。|！|!|～|~|\s)/u.test(opening);
  }
  if (grounding?.intent !== "subsidy_date_applicability") return true;
  const requestContext = grounding?.facts?.requestContext || {};
  const hasPublishedDayRule = /(?:週日.{0,8}週四|週五.{0,12}週六|國定.{0,8}(?:連續假日|連假)|Sunday.{0,20}Thursday|Friday.{0,12}Saturday|日曜.{0,12}木曜|금요일.{0,12}토요일)/iu.test(text);
  const givesApplicability = /(?:適用|不適用|符合|不符合|対象|対象外|covered|not covered|appl(?:y|ies|icable)|해당|적용)/iu.test(text);
  if (!requestContext.requestedStayDate) {
    const asksForDate = /(?:入住日期|入住日|哪一天|幾月幾日|預計入住|check-?in date|stay date|チェックイン日|宿泊日|체크인 날짜|숙박 날짜)/iu.test(text);
    return hasPublishedDayRule && asksForDate;
  }
  return givesApplicability && (text.includes(requestContext.requestedWeekday || "") || text.includes(requestContext.requestedStayDate));
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
