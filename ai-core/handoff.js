import { bookingDates } from "./booking.js";

const MAX_HISTORY_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 2_000;

const HANDOFF_CATEGORIES = Object.freeze([
  ["訂房修改／取消", /(?:修改|更改|取消|改期).{0,12}(?:訂房|預訂|日期|入住)|(?:訂房|預訂).{0,12}(?:修改|更改|取消|改期)/iu],
  ["付款／退款爭議", /退款|退費|重複扣款|付款爭議|付款異常|刷卡失敗|不明扣款|款項.{0,8}(?:異常|爭議|處理)/iu],
  ["設備故障", /(?:冷氣|空調|電視|熱水|門鎖|設備|wifi|網路).{0,12}(?:壞|故障|沒反應|無法使用)|(?:壞|故障|沒反應|無法使用).{0,12}(?:冷氣|空調|電視|熱水|門鎖|設備|wifi|網路)/iu],
  ["遺失物", /遺失|忘了帶走|掉了|失物|lost\s*(?:item|property)/iu],
  ["客訴", /客訴|投訴|抱怨|很不滿|太糟|非常生氣/iu],
  ["私人訂房資料", /訂房編號|預訂編號|訂單資料|私人資料|個人資料/iu],
  ["真人服務", /真人|人工客服|轉接.{0,8}(?:櫃台|櫃檯|飯店人員)|(?:找|請|要).{0,8}(?:櫃台|櫃檯|飯店人員)/iu],
  ["特殊需求", /(?:幫我|請|需要|想要|安排|準備|申請).{0,12}(?:特殊需求|無障礙|過敏|慶生|加床|嬰兒床|寵物)|(?:特殊需求|無障礙|過敏|慶生|加床|嬰兒床|寵物).{0,12}(?:安排|準備|申請)/iu]
]);

export function decideHandoff(message, history = []) {
  const current = typeof message === "string" ? message.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
  if (!current) return { required: false, category: null };
  const category = HANDOFF_CATEGORIES.find(([, pattern]) => pattern.test(current))?.[0];
  return category ? { required: true, category } : { required: false, category: null };
}

export function normalizedGuestMessages(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(item => item?.role === "user" && typeof item.content === "string")
    .map(item => item.content.trim().slice(0, MAX_MESSAGE_LENGTH))
    .filter(Boolean)
    .slice(-MAX_HISTORY_MESSAGES);
}

export function stayDateFromHistory(history, now = new Date()) {
  for (const message of normalizedGuestMessages(history).reverse()) {
    const dates = bookingDates(message, now);
    if (dates) return dates.checkInDate;
  }
  return "";
}

export function contactDetails(history, now = new Date()) {
  const messages = normalizedGuestMessages(history);
  const originalMessage = messages.slice(-3).join("\n") || "（對話中無旅客留言）";
  const text = messages.join("\n");
  const categories = [
    ...HANDOFF_CATEGORIES,
    ["設備問題", /(故障|壞掉|無法使用|沒反應|冷氣|電視|設備|wifi|網路)/iu],
    ["停車", /(停車|車位)/u], ["早餐", /(早餐|餐點)/u],
    ["入住需求", /(提早入住|延後退房|入住需求|check[ -]?in|check[ -]?out|チェックイン|チェックアウト|체크인|체크아웃)/iu],
    ["特殊需求", /(特殊需求|嬰兒|寵物|無障礙|加床|過敏|素食|慶生|baby\s*(?:crib|cot)|crib|cot|ベビーベッド|아기\s*침대)/iu],
    ["訂房詢問", /(訂房|空房|房況|房價|住宿|booking|availability|room|予約|空室|宿泊|예약|객실|숙박)/iu]
  ];
  const reason = categories.find(([, pattern]) => pattern.test(text))?.[0] || "其他";
  const summarySource = messages.slice(-2).join("；");
  const summary = summarySource ? `旅客詢問／反映：${summarySource.slice(0, 900)}${summarySource.length > 900 ? "…" : ""}` : "旅客希望飯店人員主動聯絡，但尚未在對話中說明具體需求。";
  return { reason, summary, originalMessage, stayDate: stayDateFromHistory(history, now) };
}
