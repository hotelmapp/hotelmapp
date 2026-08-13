import test from "node:test";
import assert from "node:assert/strict";
import { renderTextWithLinks } from "../chat-ui.js";

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
