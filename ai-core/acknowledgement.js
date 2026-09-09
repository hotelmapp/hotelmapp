// A deny-only safety boundary, not a business-topic keyword router. Match the
// WHOLE utterance so "OK, please contact reception" remains a real request.
// The semantic router still runs first and can recognize other paraphrases.
function normalizedReceipt(value) {
  if (typeof value !== "string" || value.length > 240) return "";
  return value.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\p{Z}\p{Cf}\s\uFE0F]/gu, "");
}

const RECEIPT = /^(?:(?:好(?:的|喔|哦|呀|啊|啦)?|可以(?:的|喔)?|沒問題|了解(?:了)?|知道了|收到(?:了)?|明白(?:了)?|嗯|需要(?:喔)?|要|同意|麻煩(?:你|您)?(?:了)?|謝謝(?:你|您)?|感謝(?:你|您)?|ok(?:ay)?|yes|sure|alright|understood|gotit|thanks|thankyou|はい|ええ|わかりました|分かりました|承知しました|了解しました|ありがとうございます|ありがとう|네|예|알겠습니다|알겠어요|감사합니다|고마워요))+$/u;
const AFFIRMATIVE = /^(?:好(?:的|喔|哦)?|可以(?:的|喔)?|沒問題|同意|ok(?:ay)?|yes|sure|はい|ええ|네|예)(?:謝謝(?:你|您)?|thanks|thankyou|ありがとうございます|감사합니다)?$/u;
const EXPLICIT_SEND = /^(?:確認送出|確認|送出|麻煩送出|可以送出|confirmsend|sendit|pleasesendit|confirm|送信してください|送信を確認|보내주세요|전송확인)$/u;

export function isStandaloneAcknowledgement(message) {
  return RECEIPT.test(normalizedReceipt(message));
}

// This only recognizes the text. Durable ready_for_confirmation state plus
// contact data and the runtime's delivery claim remain mandatory.
export function isHandoffConfirmation(message) {
  const text = normalizedReceipt(message);
  return AFFIRMATIVE.test(text) || EXPLICIT_SEND.test(text);
}

export function isAcknowledgementTurn(message, grounding) {
  return isStandaloneAcknowledgement(message) || grounding?.topic === "acknowledgement";
}

export function withAcknowledgementBoundary(message, grounding) {
  if (!isAcknowledgementTurn(message, grounding)) return grounding;
  return {
    topic: "acknowledgement", intent: "acknowledgement", facts: {},
    contract: { responseMode: "acknowledgement_only", requiredFactIds: [], historyPolicy: "context_only_not_action_authorization" },
    semanticRoute: {
      ...grounding?.semanticRoute,
      currentNeed: "Acknowledge receipt or thanks only; no new request or action consent.",
      usedHistory: Boolean(grounding?.semanticRoute?.usedHistory),
      clarificationNeeded: false,
      handoff: { requested: false, category: null }
    }
  };
}

export function acknowledgementFallback(language) {
  return { "zh-TW": "好的，謝謝您。", en: "Thank you!", ja: "ありがとうございます。", ko: "감사합니다." }[language] || "好的，謝謝您。";
}

// A receipt must not become another collection form, offer, hotel policy, or
// unverified operational promise, even if a model ignores its instructions.
export function validateAcknowledgementReply(answer) {
  const text = String(answer || "");
  return text.trim().length > 0 && text.length <= 240 && !/\d|[?？]|姓名|電話|聯絡|聯繫|聯系|個資|資料|櫃[檯台]|轉接|轉交|寄信|送出|通知|安排|預留|訂房|付款|收款|款項|退款|入住|停車|早餐|name|phone|e-?mail|contact|reception|front\s*desk|forward|send|sent|book|reserv|payment|refund|parking|breakfast|名前|氏名|電話|メール|フロント|連絡|送信|転送|手配|予約|支払|入金|返金|駐車|朝食|성함|이름|전화|이메일|메일|연락|프런트|프론트|전송|예약|결제|입금|환불|주차|조식/iu.test(text);
}
