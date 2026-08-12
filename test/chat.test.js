import test from "node:test";
import assert from "node:assert/strict";
import handler, { responseText } from "../api/chat.js";
import { hotelKnowledge } from "../data/hotel-info.js";

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
    assert.equal(payload.input, "早餐幾點開始？");
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
  assert.deepEqual(res.body, { answer: "請洽櫃台確認早餐時間。" });
});

test("contains confirmed V2.0 answers for the required guest scenarios", () => {
  assert.equal(hotelKnowledge.breakfast.hours, "08:00–10:00");
  assert.equal(hotelKnowledge.stay.checkOut, "11:00 前");
  assert.equal(hotelKnowledge.parking.hotelSpaces, 3);
  assert.match(hotelKnowledge.amenities.tv, /智慧電視/);
  assert.match(hotelKnowledge.local.restaurants, /先詢問/);
  assert.match(hotelKnowledge.booking.hotelOrWebsite, /聯繫櫃檯/);
  assert.match(hotelKnowledge.escalation.equipment, /不自行判斷/);
  assert.match(hotelKnowledge.booking.livePriceAndAvailability, /即時房價/);
});

test("keeps facts missing from V2.0 explicitly unknown", () => {
  assert.equal(hotelKnowledge.identity.address, null);
  assert.equal(hotelKnowledge.contact.frontDeskPhone, null);
  assert.equal(hotelKnowledge.amenities.wifi, null);
  assert.equal(hotelKnowledge.rooms.find(room => room.name === "家庭房").bathtub, null);
  assert.equal(hotelKnowledge.review.contradictions.length, 0);
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
