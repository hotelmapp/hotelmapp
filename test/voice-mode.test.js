import test from "node:test";
import assert from "node:assert/strict";
import { VoiceMode } from "../voice-mode.js";

class FakeElement {
  constructor(document) { this.ownerDocument = document; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.textContent = ""; this.hidden = true; }
  querySelector(selector) { return this.nodes?.[selector]; }
  append(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  setAttribute(name, value = "") { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
}

function fixture() {
  const classes = new Set();
  const document = { createElement: () => new FakeElement(document), body: { classList: { add: value => classes.add(value), remove: value => classes.delete(value) } } };
  const root = new FakeElement(document);
  root.nodes = Object.fromEntries(["status", "orb", "error", "transcript", "mute", "selector", "end"].map(name => [`[data-voice-${name}]`, new FakeElement(document)]));
  const home = new FakeElement(document);
  return { document, root, home, classes };
}

test("opens an immersive voice mode, shows states, and keeps transcript hidden in details", async () => {
  const oldDocument = global.document;
  const { document, root, home, classes } = fixture();
  global.document = document;
  let callbacks;
  const session = { active: false, async start() { this.active = true; callbacks.onState("listening"); return true; }, stop() { this.active = false; }, setMuted() { return false; } };
  const mode = new VoiceMode({ root, home, storage: { getItem() {} }, sessionFactory: value => { callbacks = value; return session; } });
  try {
    assert.equal(await mode.open(), true);
    assert.equal(root.hidden, false);
    assert.equal(root.attributes["aria-hidden"], "false");
    assert.equal(home.attributes.inert, "");
    assert.equal(classes.has("voice-mode-open"), true);
    assert.equal(root.nodes["[data-voice-status]"].textContent, "正在聆聽");
    callbacks.onState("user_speaking");
    assert.equal(root.dataset.state, "user_speaking");
    callbacks.onState("answering");
    assert.equal(root.nodes["[data-voice-status]"].textContent, "AI 正在思考");
    callbacks.onState("speaking");
    assert.equal(root.nodes["[data-voice-status]"].textContent, "AI 正在說話");
    callbacks.onTranscript({ role: "user", text: "早餐幾點？" });
    assert.equal(root.nodes["[data-voice-transcript]"].children[0].textContent, "您：早餐幾點？");
  } finally { mode.close(); global.document = oldDocument; }
});

test("ending voice mode closes realtime resources and returns to text home", async () => {
  const oldDocument = global.document;
  const { document, root, home, classes } = fixture();
  global.document = document;
  let stopped = 0;
  const session = { active: false, muted: false, async start() { this.active = true; return true; }, stop() { stopped++; this.active = false; }, setMuted(value) { this.muted = value; return value; } };
  const mode = new VoiceMode({ root, home, storage: { getItem() {} }, sessionFactory: () => session });
  try {
    await mode.open();
    mode.toggleMute();
    assert.equal(root.nodes["[data-voice-mute]"].attributes["aria-pressed"], "true");
    mode.close();
    assert.equal(stopped, 1);
    assert.equal(root.hidden, true);
    assert.equal(home.attributes.inert, undefined);
    assert.equal(classes.has("voice-mode-open"), false);
  } finally { global.document = oldDocument; }
});
