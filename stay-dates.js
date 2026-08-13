const MONTHS = Object.freeze({
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9,
  sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12
});

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10) : "";
}

function dateParts(message) {
  const numeric = message.match(/(?:(\d{4})\s*(?:年|년|[\/-])\s*)?(\d{1,2})\s*(?:月|월|[\/-])\s*(\d{1,2})\s*(?:日|일)?/u);
  if (numeric) return { year: numeric[1], month: numeric[2], day: numeric[3] };
  const named = message.match(/\b(January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sept?|October|Oct|November|Nov|December|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/iu);
  if (!named) return null;
  return { year: named[3], month: MONTHS[named[1].toLowerCase()], day: named[2] };
}

function chineseNumber(text) {
  if (/^\d+$/u.test(text)) return Number(text);
  const digits = { 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (text === "十") return 10;
  if (text.includes("十")) return (digits[text.split("十")[0]] || 1) * 10 + (digits[text.split("十")[1]] || 0);
  return digits[text] || 1;
}

export function stayNights(message) {
  const patterns = [
    /(?:入住|住)?\s*(\d{1,2}|[一二兩两三四五六七八九十]+)\s*晚/u,
    /(\d{1,2})\s*(?:nights?|泊|박)/iu,
    /(?:for\s+)?(one|two|three|four|five|six|seven|eight|nine|ten)\s+nights?/iu
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match) continue;
    const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    return Math.max(1, words[match[1].toLowerCase?.()] || chineseNumber(match[1]));
  }
  return 1;
}

export function bookingDatesFromText(message, now = new Date()) {
  if (typeof message !== "string") return null;
  const parts = dateParts(message);
  if (!parts) return null;
  let year = parts.year ? Number(parts.year) : now.getUTCFullYear();
  let checkInDate = isoDate(year, Number(parts.month), Number(parts.day));
  if (!checkInDate) return null;
  if (!parts.year && checkInDate < now.toISOString().slice(0, 10)) {
    checkInDate = isoDate(++year, Number(parts.month), Number(parts.day));
  }
  if (!checkInDate) return null;
  const departure = new Date(`${checkInDate}T00:00:00Z`);
  departure.setUTCDate(departure.getUTCDate() + stayNights(message));
  return { checkInDate, checkOutDate: departure.toISOString().slice(0, 10) };
}
