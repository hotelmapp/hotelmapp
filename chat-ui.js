import { bookingDatesFromText } from "./stay-dates.js";

const URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;

export function renderTextWithLinks(container, text) {
  const document = container.ownerDocument;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    fragment.append(document.createTextNode(text.slice(lastIndex, match.index)));

    const link = document.createElement("a");
    link.href = match[0];
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = match[0];
    fragment.append(link);

    lastIndex = match.index + match[0].length;
  }

  fragment.append(document.createTextNode(text.slice(lastIndex)));
  container.replaceChildren(fragment);
}

export function dateFromConversation(history, now = new Date()) {
  if (!Array.isArray(history)) return "";
  for (const item of [...history].reverse()) {
    if (item?.role !== "user" || typeof item.content !== "string") continue;
    const dates = bookingDatesFromText(item.content, now);
    if (dates) return dates.checkInDate;
  }
  return "";
}

export function summaryFromConversation(history) {
  if (!Array.isArray(history)) return "";
  const messages = history
    .filter(item => item?.role === "user" && typeof item.content === "string")
    .map(item => item.content.trim())
    .filter(Boolean);
  if (!messages.length) return "";
  const text = `旅客詢問／需求：${messages.join("；")}`;
  return `${text.slice(0, 997)}${text.length > 1000 ? "…" : ""}`;
}
