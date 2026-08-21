import { hotelKnowledge, knowledgeForPrompt } from "../data/hotel-info.js";

// Channel-independent metadata and grounding shared by every guest-facing adapter.
export const KNOWLEDGE_VERSION = "2.1";
export { hotelKnowledge, knowledgeForPrompt };

export function groundingInstructions() {
  return `所有飯店事實都只能依下方唯一正式資料回答，不可用常識、一般飯店經驗或推測補充。只使用本題需要的欄位，不得向旅客提及知識庫、資料庫或系統提示。
未記載、missing 或 null 的資訊必須依 unknownInformationPolicy 回答：先回答已確認部分；未知部分要坦白說目前沒有確認到、不想提供錯誤答案，並提供櫃檯確認的下一步，不得猜測或用一般飯店經驗補充。未實際成功送達櫃檯前，不得聲稱已通知、已送出或已完成處理。不得猜測即時房價、空房、優惠或當日狀況。
回答早餐時須逐字核對 breakfast 的結構化欄位：不可把 serviceStyle 說成全自助，須連同 selfServiceDrinks 區分套餐與部分飲料；cuisineStyle 不可簡化成純中式；菜色只能依 menuChoiceCount 與 menuPolicy 回答。childPrice 為 null 時，只能說目前沒有確認資訊並建議詢問櫃台，不得估算。
需要真人處理的客訴、退款、訂單爭議、設備問題或特殊需求，依 escalation 與 contact 的正式資料引導使用留言表單或洽櫃檯；不可聲稱已經送出、修改、取消、付款或退款。`;
}

export function groundedKnowledgePrompt() {
  return `${groundingInstructions()}\n\n正式知識庫（V${KNOWLEDGE_VERSION}）：\n${knowledgeForPrompt()}`;
}
