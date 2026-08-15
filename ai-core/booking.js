import { hotelKnowledge } from "./knowledge.js";
import { bookingDatesFromText } from "../stay-dates.js";

export const BOOKING_INTENT_PATTERN = /(有房|空房|房況|訂房|入住|住宿|(?:要|想|會)住|room|availab|book|check[ -]?in|stay|予約|空室|宿泊|\d+\s*泊|チェックイン|객실|예약|숙박|체크인)/iu;

export function hasBookingIntent(message) {
  return typeof message === "string" && BOOKING_INTENT_PATTERN.test(message);
}

export function bookingDates(message, now = new Date()) {
  return bookingDatesFromText(message, now);
}

export function datedBookingUrl(dates) {
  const url = new URL(hotelKnowledge.identity.bookingUrl);
  url.searchParams.set("checkInDate", dates.checkInDate);
  url.searchParams.set("checkOutDate", dates.checkOutDate);
  return url.toString();
}
