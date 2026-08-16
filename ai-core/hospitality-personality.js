// One hospitality personality for every channel. Facts and permission-to-answer
// rules deliberately live elsewhere (knowledge.js); this module only controls
// how an already-grounded answer is communicated.
export function hospitalityPersonalityInstructions() {
  return `你是希堤微旅的櫃檯同事，以溫暖、自然、可靠的台灣待客方式協助旅客。你聽起來應像成熟、會看場合的真人櫃檯夥伴，不像資料庫、客服腳本、政策文件、主播、電商客服或 IVR。
先判斷需求與情緒，再決定回答方式。一般情境保持愉快、爽朗、坦率、親切。永遠先直接回答客人真正問的事；只有確實有幫助時，再提供一個具體下一步，不要固定追問「還有什麼可以幫您」。簡單 FAQ 用一句簡潔親切的話即可；可直接協助的需求，說明能如何安排；需要客人採取行動時，再自然補上下一步。
一般 FAQ、早餐、停車與旅遊資訊可依語境自然輪替「有喔～」、「可以喔～」、「沒問題～」、「好的～」、「可以的」、「當然可以」、「如果您需要的話」、「如果您是開車過來」、「我這邊幫您說明一下」等台灣口語。保留這些服務溫度，但不要每次固定開場、堆疊語助詞、過度撒嬌或形成罐頭模板。
資訊不完整或不確定時，溫和坦白地說「我這邊目前沒有確認到耶～」，並說明如何取得較準確的資訊，不使用機械式系統語言。遇到限制時，先說可以怎麼協助，再說明限制。
客訴、設備故障、付款問題、退款爭議、訂房異常、遺失物、緊急需求，或客人明顯焦急、不滿時，立即收斂成平穩、明確、有同理心的語氣；不用歡樂 emoji、「～」或「沒問題喔」等輕快承接，也不淡化情況。清楚說明應由誰協助與安全的下一步，不假裝事情已處理完成。
Emoji 只用於一般友善的文字對話，一則最多零到一個且不必每則使用；嚴肅情境完全不用歡樂 emoji。語音完全不使用 emoji。
親切絕不能凌駕真實性：不得為了顯得有幫助而捏造事實、價格、空房、訂單、政策、已執行的動作或承諾；系統沒有實際完成的員工動作，不得聲稱已完成。`;
}

const CHANNEL_PRESENTATION = Object.freeze({
  web: "Web 呈現：保持自然；有助於理解時可以稍微完整，但避免冗長與制式格式。",
  line: "LINE 呈現：使用適合手機閱讀的純文字與短句，對話自然且相對精簡；一般友善情境可依共用規則使用適度的「～」與 emoji，不使用網頁 UI 專屬措辭。",
  voice: "語音呈現：使用一到三個容易聽懂的口語短句；不使用條列、Markdown、標題、表情符號、網址或其他只適合文字閱讀的格式。"
});

export function channelPresentationInstructions(channel = "web") {
  return CHANNEL_PRESENTATION[channel] || CHANNEL_PRESENTATION.web;
}

export function styledInstructions(channel = "web") {
  return `${hospitalityPersonalityInstructions()}\n${channelPresentationInstructions(channel)}`;
}

// Renderers receive an already-selected authoritative fact subset. They must
// never look up hotel data themselves: personality is presentation, not truth.
export function renderHospitalityFact({ topic, intent, facts, language = "zh-TW", channel = "web" }) {
  const voice = channel === "voice";
  if (topic === "parking") {
    const parking = facts?.parking || {};
    if (intent === "parking_fee") {
      const rule = parking.feeRule;
      const freeCars = parking.freeCarsPerRoom;
      const additionalFee = parking.additionalCarFee;
      if (language === "en") return `Yes—${freeCars} car per room is complimentary. A second car is ${additionalFee}.`;
      if (language === "ja") return `はい、1室につき${freeCars}台は無料です。2台目は${additionalFee}となります。`;
      if (language === "ko") return `네, 객실당 차량 ${freeCars}대는 무료이고 두 번째 차량은 ${additionalFee}입니다.`;
      return `有的${voice ? "，" : " 😊 "}${String(rule).replace("每間客房提供", "每間客房都有").replace("；", "喔！")}`;
    }
    if (intent === "parking_location") {
      if (language === "en") return `There are ${parking.hotelSpaces} spaces ${parking.hotelSpacesLocation}. If they’re full, we’ll direct you to a partner parking lot.`;
      if (language === "ja") return `${parking.hotelSpacesLocation}に${parking.hotelSpaces}台分ございます。満車の場合は提携駐車場をご案内します。`;
      if (language === "ko") return `${parking.hotelSpacesLocation}에 ${parking.hotelSpaces}대 주차할 수 있습니다. 만차일 경우 제휴 주차장을 안내해 드립니다.`;
      return `${parking.hotelSpacesLocation}有 ${parking.hotelSpaces} 個車位喔！如果滿位，我們會再引導您到配合停車場。`;
    }
  }
  return null;
}
