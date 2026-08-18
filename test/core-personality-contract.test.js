import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CORE_PERSONALITY_CONTRACT_VERSION,
  CUSTOMER_CHANNELS,
  applyCorePersonalityContract
} from "../ai-core/hospitality-personality.js";
import { answerGuestMessage } from "../ai-core/guest-response.js";

const noHandoff = async () => ({ attempted: false });
const humanOpening = /^(?:好的|了解|可以的|有的|有喔|可以|當然|沒問題|很抱歉|房內|早餐|主餐|是中西式|兒童早餐)/u;

test("20 hospitality scenarios preserve their grounded draft and gain a shared human service presentation", () => {
  const cases = [
    ["停車", "有停車位嗎？", "飯店門口有三個車位。"],
    ["入住", "幾點入住？", "入住時間為下午三點。"],
    ["退房", "幾點退房？", "退房時間為上午十一點前。"],
    ["早餐", "早餐幾點？", "供應時間為八點到十點。"],
    ["行李", "可以寄放行李嗎？", "可寄放行李。"],
    ["房型", "有什麼房型？", "房型資訊請以官網為準。"],
    ["交通", "怎麼從車站過去？", "交通方式需確認出發車站。"],
    ["付款", "可以刷卡嗎？", "可接受信用卡付款。"],
    ["取消", "怎麼取消？", "取消方式依原訂房管道辦理。"],
    ["設備", "有洗衣機嗎？", "館內設有洗衣設備。"],
    ["親子", "有嬰兒床嗎？", "嬰兒床須依現場數量確認。"],
    ["附近", "附近有餐廳嗎？", "餐廳營業資訊需要即時確認。"],
    ["不足", "兒童早餐多少？", "兒童價格目前沒有確認資訊。"],
    ["加床", "可以加床嗎？", "是否可加床須依房型確認。"],
    ["網路", "有 Wi-Fi 嗎？", "客房提供 Wi-Fi。"],
    ["備品", "有牙刷嗎？", "備品內容如下。"],
    ["延退", "能晚點退房嗎？", "延後退房須由櫃檯確認。"],
    ["早餐地點", "早餐在哪裡？", "早餐於一樓供應。"],
    ["停車追問", "那第二台呢？", "第二台車加收停車費。"],
    ["入住追問", "那晚一點呢？", "晚間入住須依已確認流程辦理。"]
  ];
  assert.equal(cases.length, 20);
  for (const [name, message, fact] of cases) {
    const result = applyCorePersonalityContract({ draft: fact, message, channel: "web" });
    assert.equal(result.contractVersion, CORE_PERSONALITY_CONTRACT_VERSION, name);
    assert.ok(result.text.includes(fact), `${name}: the contract must not rewrite or add grounded facts`);
    assert.match(result.text, humanOpening, name);
  }
});

test("complaints retain restrained empathy without cheerful particles", () => {
  const result = applyCorePersonalityContract({ draft: "很抱歉讓您有不好的感受。請直接聯絡櫃檯。", message: "房間很吵，我很不滿", channel: "web" });
  assert.match(result.text, /很抱歉/u);
  assert.doesNotMatch(result.text, /～|😊/u);
});

test("every current and planned customer channel is contract-registered and unknown channels fail closed", () => {
  assert.deepEqual(CUSTOMER_CHANNELS, ["web", "line", "messenger", "instagram", "voice"]);
  for (const channel of CUSTOMER_CHANNELS) {
    assert.equal(applyCorePersonalityContract({ draft: "已確認資訊。", message: "請問？", channel }).channel, channel);
  }
  assert.throws(() => applyCorePersonalityContract({ draft: "text", message: "hi", channel: "new-channel" }), /Unsupported customer channel/);
});

test("parking multi-turn stays hospitable while each turn uses only its selected fact subset", async () => {
  const turns = [];
  const ask = async message => {
    const answer = await answerGuestMessage(message, { history: turns, channel: "messenger", handoffService: noHandoff });
    turns.push({ role: "user", content: message }, { role: "assistant", content: answer });
    return answer;
  };
  assert.match(await ask("有停車位嗎？"), /^有的，.*3 台車/u);
  const cars = await ask("我們有兩台車");
  assert.match(cars, /^可以的～如果您是兩台車過來/u);
  assert.match(cars, /1 台免費.*第 2 台車.*NT\$200/u);
  assert.doesNotMatch(cars, /3 個車位|配合停車場/u);
  assert.match(await ask("那第二台多少錢？"), /NT\$200/u);
  const location = await ask("停哪裡？");
  assert.match(location, /門口.*3 個車位.*配合停車場/u);
  assert.doesNotMatch(location, /NT\$200/u);
  const reservation = await ask("需要先預約嗎？");
  assert.match(reservation, humanOpening);
});

test("all deterministic, fallback, handoff, and generated branches converge on the shared finalizer", async () => {
  const source = await readFile(new URL("../ai-core/guest-response.js", import.meta.url), "utf8");
  assert.match(source, /if \(handoff\.attempted\) return finalizeGuestAnswer/u);
  assert.match(source, /if \(directAnswer\) return finalizeGuestAnswer/u);
  assert.match(source, /return finalizeGuestAnswer\(generated/u);
  assert.equal((source.match(/applyCorePersonalityContract\(/gu) || []).length, 1);
});

