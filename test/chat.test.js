import test from "node:test";
import assert from "node:assert/strict";
import handler, { extractResponseText } from "../api/chat.js";

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("extracts top-level and nested Responses API text", () => {
  assert.equal(extractResponseText({ output_text: " 早餐七點開始 " }), "早餐七點開始");
  assert.equal(extractResponseText({ output: [{
    type: "message",
    content: [{ type: "output_text", text: "第一段" }, { type: "output_text", text: "第二段" }]
  }] }), "第一段\n第二段");
  assert.equal(extractResponseText({ output: [{
    type: "message",
    content: [{ type: "text", text: { value: "相容訊息" } }, "字串內容"]
  }] }), "相容訊息\n字串內容");
});

test("rejects a missing API key with diagnostics fingerprint", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const res = responseRecorder();
  await handler({ method: "POST", headers: {}, body: { message: "早餐幾點開始" } }, res);
  assert.equal(res.statusCode, 500);
  assert.match(res.body.error, /API Key/);
  assert.equal(res.headers["X-Chat-Handler-Version"], "2026-08-12.2");
  assert.equal(res.headers["X-Chat-Key-Configured"], "false");
  restoreEnvironment("OPENAI_API_KEY", previous);
});

test("calls Responses API and returns parsed answer", async t => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-key";
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options.headers.Authorization, "Bearer test-key");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "gpt-4.1-mini");
    assert.equal(body.input, "早餐幾點開始");
    assert.equal(typeof body.instructions, "string");
    return new Response(JSON.stringify({ output: [{
      type: "message",
      content: [{ type: "output_text", text: "早餐從早上七點開始。" }]
    }] }), { status: 200, headers: { "x-request-id": "req_test" } });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
    restoreEnvironment("OPENAI_API_KEY", previousKey);
  });

  const res = responseRecorder();
  await handler({ method: "POST", headers: {}, body: { message: "早餐幾點開始" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { answer: "早餐從早上七點開始。" });
  assert.equal(res.headers["X-Chat-Key-Configured"], "true");
  assert.equal(res.headers["X-Chat-Upstream-Status"], "200");
});

test("returns the upstream failure and exposes only safe diagnostics", async t => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-key";
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { type: "invalid_request_error", code: "model_not_found", message: "bad model" }
  }), { status: 404, headers: { "x-request-id": "req_error" } });
  t.after(() => {
    globalThis.fetch = previousFetch;
    restoreEnvironment("OPENAI_API_KEY", previousKey);
  });

  const res = responseRecorder();
  await handler({ method: "POST", headers: {}, body: { message: "早餐幾點開始" } }, res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.headers["X-Chat-Upstream-Status"], "404");
  assert.equal(res.headers["X-Chat-Key-Configured"], "true");
  assert.equal(JSON.stringify(res.body).includes("test-key"), false);
});

test("does not turn an empty OpenAI answer into HTTP 200 fallback", async t => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-key";
  globalThis.fetch = async () => new Response(JSON.stringify({ output: [] }), { status: 200 });
  t.after(() => {
    globalThis.fetch = previousFetch;
    restoreEnvironment("OPENAI_API_KEY", previousKey);
  });

  const res = responseRecorder();
  await handler({ method: "POST", headers: {}, body: { message: "早餐幾點開始" } }, res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.answer, undefined);
});
