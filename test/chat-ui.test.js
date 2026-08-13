import test from "node:test";
import assert from "node:assert/strict";
import { dateFromConversation, renderTextWithLinks, summaryFromConversation } from "../chat-ui.js";

class TestNode {
  constructor(type, ownerDocument) {
    this.type = type;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this._textContent = "";
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children.flatMap(child => child.type === "fragment" ? child.children : child);
  }

  set textContent(value) {
    this._textContent = value;
    this.children = [];
  }

  get textContent() {
    if (this.type === "text") return this._textContent;
    if (this.children.length) return this.children.map(child => child.textContent).join("");
    return this._textContent;
  }
}

const document = {
  createDocumentFragment: () => new TestNode("fragment", document),
  createTextNode: text => {
    const node = new TestNode("text", document);
    node.textContent = text;
    return node;
  },
  createElement: tagName => {
    const node = new TestNode("element", document);
    node.tagName = tagName.toUpperCase();
    return node;
  }
};

function container() {
  return new TestNode("element", document);
}

test("renders ordinary assistant text without creating links", () => {
  const answer = container();
  renderTextWithLinks(answer, "早餐供應時間是 08:00–10:00。");

  assert.equal(answer.textContent, "早餐供應時間是 08:00–10:00。");
  assert.equal(answer.children.some(child => child.tagName === "A"), false);
});

test("turns HTTP and HTTPS URLs into safe new-tab links", () => {
  const answer = container();
  renderTextWithLinks(answer, "官網：https://hotel.example/book 備用：http://example.test/rooms");

  const links = answer.children.filter(child => child.tagName === "A");
  assert.deepEqual(links.map(link => link.href), [
    "https://hotel.example/book",
    "http://example.test/rooms"
  ]);
  assert.ok(links.every(link => link.target === "_blank"));
  assert.ok(links.every(link => link.rel === "noopener noreferrer"));
  assert.equal(answer.textContent, "官網：https://hotel.example/book 備用：http://example.test/rooms");
});

test("keeps malicious HTML as inert text", () => {
  const answer = container();
  const malicious = '<img src=x onerror="alert(1)"> https://safe.example/';
  renderTextWithLinks(answer, malicious);

  assert.equal(answer.textContent, malicious);
  assert.equal(answer.children.some(child => child.tagName === "IMG"), false);
  assert.equal(answer.children.filter(child => child.tagName === "A").length, 1);
});

test("prefills an explicit stay date from the latest guest conversation", () => {
  const history = [
    { role: "user", content: "我想問早餐" },
    { role: "assistant", content: "早餐供應至十點" },
    { role: "user", content: "我會在 2026年8月20日 入住" }
  ];
  assert.equal(dateFromConversation(history, new Date("2026-08-13T00:00:00Z")), "2026-08-20");
  assert.equal(dateFromConversation([{ role: "user", content: "還沒決定日期" }]), "");
  assert.equal(dateFromConversation(
    [{ role: "user", content: "2026/8/20 入住兩晚" }],
    new Date("2026-08-13T00:00:00Z")
  ), "2026-08-20");
  assert.equal(dateFromConversation(
    [{ role: "user", content: "I will stay for two nights starting August 20." }],
    new Date("2026-08-13T00:00:00Z")
  ), "2026-08-20");
});

test("prefills a complete guest requirement summary from the conversation", () => {
  const history = [
    { role: "user", content: "我想 2026/8/20 入住兩晚" },
    { role: "assistant", content: "請至官網查房。" },
    { role: "user", content: "另外需要嬰兒床，也想確認停車位" }
  ];
  assert.equal(
    summaryFromConversation(history),
    "旅客詢問／需求：我想 2026/8/20 入住兩晚；另外需要嬰兒床，也想確認停車位"
  );
  assert.equal(summaryFromConversation([{ role: "assistant", content: "您好" }]), "");
});
