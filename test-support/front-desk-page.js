// Runs the real page script against an offline DOM and authenticated API.
// This is interaction regression coverage, not a browser/layout acceptance test.
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import { randomUUID } from "node:crypto";
import { createFrontDeskHandler } from "../api/front-desk.js";

class Element {
  constructor(fragment = false) {
    this.fragment = fragment; this.children = []; this.listeners = {};
    this.value = ""; this.checked = false; this.disabled = false; this.hidden = false;
    this.classList = { toggle() {} };
  }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  append(...children) { for (const child of children) this.children.push(...(child.fragment ? child.children : [child])); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  focus() {} select() {}
  fire(type) {
    if (type === "click" && this.disabled) return;
    return this.listeners[type]?.({ preventDefault() {} });
  }
}

export async function frontDeskPage(f) {
  const [html, source] = await Promise.all([
    readFile(new URL("../front-desk.html", import.meta.url), "utf8"),
    readFile(new URL("../front-desk.js", import.meta.url), "utf8")
  ]);
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], new Element()]));
  for (const match of html.matchAll(/<textarea[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) elements.get(match[1]).value = match[2];
  const document = Object.assign(new Element(), {
    hidden: false, getElementById: id => elements.get(id),
    createElement: () => new Element(), createDocumentFragment: () => new Element(true), createTextNode: text => ({ textContent: text })
  });
  const handler = createFrontDeskHandler({ env: f.env, createService: () => f.desk });
  let cookie = "";
  let delayDetail;
  const calls = [], clipboard = [], $ = id => elements.get(id);
  const controls = await new Script(`(async () => {${source}\nreturn { refresh };})()`).runInNewContext({
    document, console, AbortSignal, crypto: { randomUUID }, confirm: () => true, setInterval() {},
    navigator: { clipboard: { writeText: async text => clipboard.push(text) } },
    fetch: async (url, options) => {
      if (url !== "/api/front-desk") throw new Error("unexpected_external_request");
      const body = JSON.parse(options.body); calls.push(body);
      const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; } };
      await handler({ method: "POST", body, headers: { origin: f.env.FRONT_DESK_ORIGIN, "content-type": "application/json", cookie } }, res);
      if (body.action === "detail" && delayDetail) { const delay = delayDetail; delayDetail = null; await delay(); }
      if (res.headers["Set-Cookie"]) cookie = res.headers["Set-Cookie"].split(";")[0];
      return { ok: res.statusCode < 400, json: async () => structuredClone(res.body) };
    }
  });
  const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
  $("password").value = f.env.FRONT_DESK_ADMIN_KEY;
  await $("loginForm").fire("submit"); await settle();
  const deferDetail = () => {
    let entered, release;
    const started = new Promise(resolve => { entered = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    delayDetail = async () => { entered(); await held; };
    return { started, release };
  };
  return { $, calls, clipboard, settle, refresh: controls.refresh, deferDetail, select: async (index = 0) => { await $("inbox").children[index].fire("click"); await settle(); } };
}
