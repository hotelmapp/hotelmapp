import test from "node:test";
import assert from "node:assert/strict";
import handler, { normalizedHistory, relevantKnowledge, responseText, responsesPayload } from "../api/chat.js";
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
