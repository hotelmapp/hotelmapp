import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../test-support/front-desk-fixture.js";
import { frontDeskPage } from "../test-support/front-desk-page.js";

test("LINE control flow requires a matched guest and copies a greeting without sending from the workbench", async () => {
  const f = fixture(); await f.incoming();
  const h = await frontDeskPage(f), $ = h.$; await h.select();
  assert.equal($("nativeReply").hidden, false); assert.equal($("replyForm").hidden, true);
  assert.equal($("takeover").disabled, true); assert.equal($("copyGreeting").disabled, true);
  $("guestMatched").checked = true; await $("guestMatched").fire("change");
  await $("takeover").fire("click"); await h.settle();
  assert.equal((await f.store.control(f.id)).mode, "human");
  await $("copyGreeting").fire("click");
  assert.match(h.clipboard[0], /^【真人櫃檯回覆】您好/);
  $("reply").value = "不得由此頁送出 LINE 人工文字";
  await $("replyForm").fire("submit"); await h.settle();
  assert.equal(h.calls.filter(x => x.action === "reply").length, 0);
  assert.equal(f.sent.length, 1, "copy and takeover must not contact the guest");
  $("summary").value = "已在 LINE 說明停車位置。"; await $("summary").fire("input");
  assert.equal($("close").disabled, true);
  $("resolved").checked = true; await $("resolved").fire("change");
  await $("close").fire("click"); await h.settle();
  assert.equal((await f.store.control(f.id)).mode, "ai");
  assert.equal(f.sent.length, 1, "closure must not send an unsolicited message");
  assert.match((await f.conversations.context(f.id)).turns.at(-1).content, /已在 LINE 說明停車位置/);
});

test("new guest text, a changed summary, or switching conversations invalidates completion review", async () => {
  const f = fixture(); await f.incoming(); await f.desk.takeover(f.id);
  const h = await frontDeskPage(f), $ = h.$; await h.select();
  $("summary").value = "已處理。"; await $("summary").fire("input");
  $("resolved").checked = true; await $("resolved").fire("change");
  assert.equal($("close").disabled, false);
  await f.incoming("還有另一件事要請教。"); await h.refresh();
  assert.equal($("resolved").checked, false); assert.equal($("close").disabled, true);
  $("resolved").checked = true; await $("resolved").fire("change");
  $("summary").value = "正在確認另一件事。"; await $("summary").fire("input");
  assert.equal($("resolved").checked, false); assert.equal($("close").disabled, true);
  $("resolved").checked = true; await $("resolved").fire("change");
  await h.select();
  assert.equal($("resolved").checked, false); assert.equal($("close").disabled, true);
  assert.equal((await f.store.control(f.id)).mode, "human");
});

test("Messenger retains its authenticated workbench composer and only sends a human label", async () => {
  const f = fixture("messenger"); await f.incoming();
  const h = await frontDeskPage(f), $ = h.$; await h.select();
  assert.equal($("nativeReply").hidden, true); assert.equal($("replyForm").hidden, false);
  assert.equal($("takeover").disabled, false);
  await $("takeover").fire("click"); await h.settle();
  $("reply").value = "您好，讓櫃檯為您確認。"; await $("reply").fire("input");
  await $("replyForm").fire("submit"); await h.settle();
  assert.equal(h.calls.filter(x => x.action === "reply").length, 1);
  assert.match(f.sent.at(-1).text, /^【真人櫃檯回覆】\n/);
  assert.doesNotMatch(f.sent.at(-1).text, /AI 小幫手/);
  assert.equal((await f.store.control(f.id)).mode, "human");
});

test("an older refresh cannot restore a human indicator after successful closure", async () => {
  const f = fixture(); await f.incoming(); await f.desk.takeover(f.id);
  const h = await frontDeskPage(f), $ = h.$; await h.select();
  $("summary").value = "已在 LINE 完成處理。"; await $("summary").fire("input");
  $("resolved").checked = true; await $("resolved").fire("change");
  const gate = h.deferDetail();
  const pendingRead = h.refresh(); await gate.started;
  await $("close").fire("click"); await h.settle();
  assert.equal((await f.store.control(f.id)).mode, "ai");
  gate.release(); await pendingRead; await h.settle();
  assert.equal($("mode").textContent, "AI 自動回覆");
  assert.equal($("copyGreeting").disabled, true); assert.equal($("close").disabled, true);
});

test("the LINE greeting remains disabled while an in-flight AI response drains", async () => {
  const f = fixture(); await f.incoming();
  const h = await frontDeskPage(f), $ = h.$; await h.select();
  let entered, finish;
  const started = new Promise(resolve => { entered = resolve; });
  const wait = new Promise(resolve => { finish = resolve; });
  const pending = f.incoming("另一個問題", { generate: async () => { entered(); await wait; return { answer: "不得送出的回覆" }; } });
  await started;
  $("guestMatched").checked = true; await $("guestMatched").fire("change");
  await $("takeover").fire("click"); await h.settle();
  assert.equal((await f.store.control(f.id)).mode, "pausing");
  assert.equal($("copyGreeting").disabled, true); assert.equal($("close").disabled, true);
  finish(); await pending; await h.refresh();
  assert.equal((await f.store.control(f.id)).mode, "human");
  assert.equal($("copyGreeting").disabled, false); assert.equal(f.sent.length, 1);
});
