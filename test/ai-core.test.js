import test from "node:test";
import assert from "node:assert/strict";
import {
  hotelKnowledge, KNOWLEDGE_VERSION, groundedKnowledgePrompt,
  hasBookingIntent, bookingDates, datedBookingUrl,
  contactDetails
} from "../ai-core/index.js";

test("shared core exposes the canonical hotel and breakfast knowledge", () => {
  assert.equal(KNOWLEDGE_VERSION, "2.1");
  assert.equal(hotelKnowledge.breakfast.serviceHours, "08:00–10:00");
  const prompt = groundedKnowledgePrompt();
  assert.match(prompt, /唯一正式資料/);
  assert.match(prompt, /childPrice 為 null.*不得估算/);
  assert.match(prompt, /"bookingUrl": "https:\/\/book-directonline\.com/);
  assert.match(prompt, /未記載、missing 或 null.*不得猜測/);
  assert.match(prompt, /先回答已確認部分.*不想提供錯誤答案/u);
  assert.match(prompt, /未實際成功送達櫃檯前.*不得聲稱已通知/u);
});

test("shared booking interface detects intent and preserves canonical URL dates", () => {
  assert.equal(hasBookingIntent("我想 8/20 入住兩晚"), true);
  assert.equal(hasBookingIntent("早餐幾點？"), false);
  const dates = bookingDates("我想 8/20 入住兩晚", new Date("2026-08-15T00:00:00Z"));
  assert.deepEqual(dates, { checkInDate: "2026-08-20", checkOutDate: "2026-08-22" });
  const url = new URL(datedBookingUrl(dates));
  assert.equal(`${url.origin}${url.pathname}`, "https://book-directonline.com/properties/HotelMappTaichungDIrect");
  assert.equal(url.searchParams.get("locale"), "zh-TW");
  assert.equal(url.searchParams.get("checkInDate"), "2026-08-20");
  assert.equal(url.searchParams.get("checkOutDate"), "2026-08-22");
});

test("shared handoff interface categorizes and carries booking dates", () => {
  const handoff = contactDetails([
    { role: "assistant", content: "請問需要什麼協助？" },
    { role: "user", content: "8/20 入住兩晚，嬰兒床可以準備嗎？" }
  ], new Date("2026-08-15T00:00:00Z"));
  assert.equal(handoff.reason, "特殊需求");
  assert.equal(handoff.stayDate, "2026-08-20");
  assert.match(handoff.summary, /嬰兒床/);
});
