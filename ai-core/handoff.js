import { bookingDates } from "./booking.js";

const MAX_HISTORY_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 2_000;

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
