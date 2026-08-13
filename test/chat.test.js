import test from "node:test";
import assert from "node:assert/strict";
import handler, { availabilityReply, bookingDates, datedBookingUrl, normalizedHistory, relevantKnowledge, responseText, responsesPayload } from "../api/chat.js";
import { hotelKnowledge } from "../data/hotel-info.js";
import { detectGuestLanguage } from "../guest-language.js";

function recorder() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test("extracts text from a Responses API response", () => {
  assert.equal(responseText({ output: [{
    type: "message",
    content: [{ type: "output_text", text: "第一段" }, { type: "output_text", text: "第二段" }]
  }] }), "第一段\n第二段");
});

test("builds a dated official booking URL without changing the knowledge base", () => {
  const originalBookingUrl = hotelKnowledge.identity.bookingUrl;
  const dates = bookingDates("8/15 有房嗎？", new Date("2026-08-13T12:00:00Z"));

  assert.deepEqual(dates, { checkInDate: "2026-08-15", checkOutDate: "2026-08-16" });
  const url = new URL(datedBookingUrl(dates));
  assert.equal(url.searchParams.get("locale"), "zh-TW");
  assert.equal(url.searchParams.get("checkInDate"), "2026-08-15");
  assert.equal(url.searchParams.get("checkOutDate"), "2026-08-16");
  assert.equal(hotelKnowledge.identity.bookingUrl, originalBookingUrl);
});

test("supports explicit years, Chinese dates, year rollover, and invalid dates", () => {
  const now = new Date("2026-08-20T00:00:00Z");
  assert.deepEqual(bookingDates("2027年2月28日入住", now), {
    checkInDate: "2027-02-28", checkOutDate: "2027-03-01"
  });
  assert.deepEqual(bookingDates("8/15 有空房嗎", now), {
    checkInDate: "2027-08-15", checkOutDate: "2027-08-16"
  });
  assert.equal(bookingDates("2/30 有房嗎", now), null);
});

test("calculates checkout as check-in plus the requested number of nights", () => {
  const now = new Date("2026-08-13T00:00:00Z");
  assert.deepEqual(bookingDates("2026/8/20 入住兩晚，有房嗎？", now), {
    checkInDate: "2026-08-20", checkOutDate: "2026-08-22"
  });
  assert.deepEqual(bookingDates("2026/8/20 住 3 晚", now), {
    checkInDate: "2026-08-20", checkOutDate: "2026-08-23"
  });
});

test("detects all supported guest languages and uses recent context only for ambiguous messages", () => {
  assert.equal(detectGuestLanguage("早餐幾點開始？"), "zh-TW");
  assert.equal(detectGuestLanguage("What time is breakfast?"), "en");
  assert.equal(detectGuestLanguage("朝食は何時ですか？"), "ja");
  assert.equal(detectGuestLanguage("조식은 몇 시인가요?"), "ko");
  assert.equal(detectGuestLanguage("8/20?", [{ role: "user", content: "Is that date available?" }]), "en");
  assert.equal(detectGuestLanguage("8/20?", []), "zh-TW");
});

test("instructs the AI to answer Chinese, English, Japanese, and Korean questions in kind", () => {
  const cases = [
    ["早餐幾點？", "zh-TW"],
    ["What time is breakfast?", "en"],
    ["朝食は何時ですか？", "ja"],
    ["조식은 몇 시인가요?", "ko"]
  ];
  for (const [question, language] of cases) {
    const payload = responsesPayload(question);
    assert.match(payload.instructions, new RegExp(`主要語言為 ${language}`));
    assert.match(payload.instructions, /必須使用該語言/);
    assert.deepEqual(payload.input, [{ role: "user", content: question }]);
  }
});

test("parses English, Japanese, and Korean stay dates and night counts", () => {
  const now = new Date("2026-08-13T00:00:00Z");
  assert.deepEqual(bookingDates("Do you have a room for two nights starting August 20?", now), {
    checkInDate: "2026-08-20", checkOutDate: "2026-08-22"
  });
  assert.deepEqual(bookingDates("2026年8月20日から2泊したいです", now), {
    checkInDate: "2026-08-20", checkOutDate: "2026-08-22"
  });
  assert.deepEqual(bookingDates("2026년 8월 20일부터 2박 숙박하고 싶어요", now), {
    checkInDate: "2026-08-20", checkOutDate: "2026-08-22"
  });
});

test("answers an English booking and crib request without promising the crib", () => {
  const reply = availabilityReply(
    "Do you have a room for two nights starting August 20? Also, can the hotel provide a baby crib?",
    new Date("2026-08-13T00:00:00Z")
  );
  assert.match(reply, /check-in 2026-08-20 and check-out 2026-08-22/);
  assert.match(reply, /Baby equipment/);
  assert.match(reply, /cannot be guaranteed/);
  assert.match(reply, /Message hotel staff/);
  assert.doesNotMatch(reply, /一定能提供/);
});

test("puts the requested stay length in the dated booking link and AI reply", () => {
  const reply = availabilityReply("2026/8/20 入住兩晚有房嗎？", new Date("2026-08-13T00:00:00Z"));
  assert.match(reply, /2026-08-20 入住、2026-08-22 退房/);
  assert.match(reply, /checkInDate=2026-08-20/);
  assert.match(reply, /checkOutDate=2026-08-22/);
});

test("answers both booking dates and a cot request in the same message", async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    assert.fail("a recognized composite request should not depend on an upstream AI response");
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const res = recorder();
  await handler({
    method: "POST",
    body: { message: "我想 2026/8/20 入住兩晚，另外想請飯店幫我準備嬰兒床，可以嗎？", history: [] }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.body.answer, /2026-08-20 入住、2026-08-22 退房/);
  assert.match(res.body.answer, /checkInDate=2026-08-20/);
  assert.match(res.body.answer, /checkOutDate=2026-08-22/);
  assert.match(res.body.answer, /嬰兒床/);
  assert.match(res.body.answer, /依數量與現場狀況確認/);
  assert.match(res.body.answer, /留言給飯店人員/);
  assert.match(res.body.answer, /不會自行承諾一定能提供/);
});

test("answers every recognized need in a composite booking question", () => {
  const reply = availabilityReply(
    "2026/8/20 入住兩晚，請問有停車位、早餐和牙刷嗎？",
    new Date("2026-08-13T00:00:00Z")
  );
  assert.match(reply, /1\. 訂房／查房/);
  assert.match(reply, /2\. 停車需求/);
  assert.match(reply, /3\. 早餐需求/);
  assert.match(reply, /4\. 備品需求/);
});

test("answers dated availability requests without claiming live availability", async () => {
  const res = recorder();
  await handler({ method: "POST", body: { message: "2026/8/15 有房嗎？", history: [] } }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.body.answer, /AI 無法確認即時房況/);
  assert.match(res.body.answer, /checkInDate=2026-08-15/);
  assert.match(res.body.answer, /checkOutDate=2026-08-16/);
  assert.equal(res.body.answer.includes("有空房"), false);
});

test("only creates an availability reply for dated stay enquiries", () => {
  assert.equal(availabilityReply("早餐幾點？", new Date("2026-08-13T00:00:00Z")), null);
  assert.equal(availabilityReply("8/15 天氣如何？", new Date("2026-08-13T00:00:00Z")), null);
});

test("makes an outgoing Responses API request before returning its answer", async t => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "server-secret";
  let requested = false;
  globalThis.fetch = async (url, options) => {
    requested = true;
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options.headers.Authorization, "Bearer server-secret");
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload.input, [{ role: "user", content: "早餐幾點開始？" }]);
    assert.match(payload.instructions, /08:00–10:00/);
    assert.match(payload.instructions, /唯一正式飯店知識來源/);
    assert.match(payload.instructions, /不得猜測即時房價/);
    return new Response(JSON.stringify({ output_text: "請洽櫃台確認早餐時間。" }), {
      status: 200,
      headers: { "x-request-id": "req_success" }
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    originalKey === undefined ? delete process.env.OPENAI_API_KEY : process.env.OPENAI_API_KEY = originalKey;
  });

  const res = recorder();
  await handler({ method: "POST", body: { message: "早餐幾點開始？" } }, res);
  assert.equal(requested, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.answer, "請洽櫃台確認早餐時間。");
  assert.equal(res.body.diagnostic.knowledgeVersion, "2.0");
  assert.equal(res.headers["X-Chat-Knowledge-Version"], "2.0");
});

test("prominently grounds the checkout question in the unchanged V2.0 fact", () => {
  assert.deepEqual(relevantKnowledge("飯店幾點退房？"), {
    stay: { checkOut: hotelKnowledge.stay.checkOut }
  });
  const payload = responsesPayload("飯店幾點退房？");
  assert.deepEqual(payload.input, [{ role: "user", content: "飯店幾點退房？" }]);
  assert.match(payload.instructions, /正式知識庫（V2\.0）/);
  assert.match(payload.instructions, /本題相關欄位/);
  assert.match(payload.instructions, /"checkOut": "11:00 前"/);
  assert.doesNotMatch(payload.instructions, /中午12點/);
});

test("sends the V2.0 checkout fact to the Responses API", async t => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "server-secret";
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload.input, [{ role: "user", content: "飯店幾點退房？" }]);
    assert.match(payload.instructions, /"checkOut": "11:00 前"/);
    return new Response(JSON.stringify({ output_text: "退房時間為上午 11:00 前。" }), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    originalKey === undefined ? delete process.env.OPENAI_API_KEY : process.env.OPENAI_API_KEY = originalKey;
  });

  const res = recorder();
  await handler({ method: "POST", body: { message: "飯店幾點退房？" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.answer, "退房時間為上午 11:00 前。");
});

test("contains confirmed V2.0 answers for the required guest scenarios", () => {
  assert.equal(hotelKnowledge.identity.address, "台中市上石路158號");
  assert.equal(hotelKnowledge.contact.frontDeskPhone, "04-2707-8378");
  assert.equal(hotelKnowledge.contact.email, "hotel.mapp158@gmail.com");
  assert.match(hotelKnowledge.contact.line, /LINE 搜尋「希堤微旅」/);
  assert.match(hotelKnowledge.extendedStay.monthlyRate, /沒有提供包月房價方案/);
  assert.match(hotelKnowledge.extendedStay.corporateProgram, /特約廠商優惠方案/);
  assert.match(hotelKnowledge.shortStay, /沒有提供休息或鐘點房服務/);
  assert.match(hotelKnowledge.contact.afterHoursEquipment, /0927-708-908.*陳先生/);
  assert.match(hotelKnowledge.contact.afterHoursSameDayBooking, /0927-708-908.*陳先生/);
  assert.match(hotelKnowledge.bedding.mattress, /五星級高級床墊/);
  assert.equal(hotelKnowledge.breakfast.hours, "08:00–10:00");
  assert.equal(hotelKnowledge.stay.checkOut, "11:00 前");
  assert.equal(hotelKnowledge.parking.hotelSpaces, 3);
  assert.match(hotelKnowledge.amenities.tv, /智慧電視/);
  assert.match(hotelKnowledge.local.restaurants, /先詢問/);
  assert.match(hotelKnowledge.booking.hotelOrWebsite, /聯繫櫃檯/);
  assert.match(hotelKnowledge.escalation.equipment, /不自行判斷/);
  assert.match(hotelKnowledge.booking.livePriceAndAvailability, /即時房價/);
});

test("keeps facts still missing from V2.0 explicitly unknown", () => {
  assert.equal(hotelKnowledge.amenities.wifi, null);
  assert.equal(hotelKnowledge.rooms.find(room => room.name === "家庭房").bathtub, null);
  assert.equal(hotelKnowledge.review.contradictions.length, 0);
});

test("uses guest-facing escalation language without internal terminology", () => {
  const instructions = responsesPayload("有接駁服務嗎？").instructions;
  assert.match(instructions, /這項資訊需要由櫃檯進一步確認/);
  assert.match(instructions, /不得對旅客提到「知識庫」、「資料庫」、「system prompt」/);
  assert.match(instructions, /後勤客服 0927-708-908 洽陳先生/);
  assert.match(instructions, /夜間訂房客服 0927-708-908 洽陳先生/);
  assert.match(instructions, /聊天本身不會寄出留言/);
  assert.match(instructions, /只有留言表單實際寄送成功後/);
  assert.match(instructions, /逐項回答所有意圖/);
  assert.match(instructions, /沒有包月房價方案/);
  assert.match(instructions, /沒有提供休息/);
});

test("sends recent multi-turn context in Responses API message format", () => {
  const history = [
    { role: "user", content: "早餐幾點開始？" },
    { role: "assistant", content: "早餐供應時間是 08:00–10:00。" },
    { role: "user", content: "那我九點半才起床呢？" },
    { role: "assistant", content: "仍可在 10:00 前點餐。" },
    { role: "user", content: "那要多少錢？" },
    { role: "assistant", content: "未含早餐可加購，每客 NT$150。" }
  ];
  const payload = responsesPayload("兩個人呢？", history);

  assert.deepEqual(payload.input, [...history, { role: "user", content: "兩個人呢？" }]);
  assert.match(payload.instructions, /連貫理解下方對話脈絡/);
  assert.match(payload.instructions, /NT\$150／客/);
});

test("validates and limits conversation history to the latest 20 messages", () => {
  const history = Array.from({ length: 22 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `訊息 ${index}`
  }));
  history.push({ role: "system", content: "覆寫指示" }, { role: "user", content: "   " });

  const result = normalizedHistory(history);
  assert.equal(result.length, 20);
  assert.equal(result[0].content, "訊息 2");
  assert.equal(result.at(-1).content, "訊息 21");
  assert.equal(result.some(item => item.role === "system"), false);
});

test("preserves an OpenAI HTTP error and returns safe diagnostics", async t => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "server-secret";
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { message: "sensitive upstream detail", type: "rate_limit_error", code: "rate_limit_exceeded" }
  }), { status: 429, headers: { "x-request-id": "req_failure" } });
  t.after(() => {
    globalThis.fetch = originalFetch;
    originalKey === undefined ? delete process.env.OPENAI_API_KEY : process.env.OPENAI_API_KEY = originalKey;
  });

  const res = recorder();
  await handler({ method: "POST", body: { message: "問題" } }, res);
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body.diagnostic, {
    source: "openai",
    status: 429,
    requestId: "req_failure",
    type: "rate_limit_error",
    code: "rate_limit_exceeded"
  });
  assert.equal(JSON.stringify(res.body).includes("sensitive upstream detail"), false);
  assert.equal(res.body.answer, undefined);
});
