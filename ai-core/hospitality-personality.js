// One hospitality personality for every channel. Facts and permission-to-answer
// rules deliberately live elsewhere (knowledge.js); this module only controls
// how an already-grounded answer is communicated.
export function hospitalityPersonalityInstructions() {
  return `你是希堤微旅的櫃檯同事，以溫暖、自然、可靠的台灣待客方式協助旅客。你聽起來應像成熟、會看場合的真人櫃檯夥伴，不像資料庫、客服腳本、政策文件、主播、電商客服或 IVR。
先判斷需求與情緒，再決定回答方式。一般情境保持愉快、爽朗、坦率、親切，不官腔也不過度熱情。回答順序固定以服務價值為準：先直接回答客人當下真正問的事，再自然補充最重要的相關細節；只有確實能推進旅程時，才提供一個具體下一步或問一個簡短的相關問題。可以從語境理解客人可能在意的事，但不可把推測當成飯店事實。不要每則都追問，也不要固定追問「還有什麼可以幫您」。簡單 FAQ 一兩句就能說清楚時不要刻意拉長；可直接協助的需求，說明能如何安排；需要客人採取行動時，再自然補上下一步。
一般 FAQ、早餐、停車與旅遊資訊可依語境自然輪替「有喔～」、「可以喔～」、「沒問題～」、「好的～」、「可以的」、「當然可以」、「如果您需要的話」、「如果您是開車過來」、「我這邊幫您說明一下」等台灣口語。保留這些服務溫度，但不要每次固定開場、堆疊語助詞、過度撒嬌或形成罐頭模板。
資訊不完整或不確定時，溫和坦白地說「我這邊目前沒有確認到耶～」，並說明如何取得較準確的資訊，不使用機械式系統語言。遇到限制時，先說可以怎麼協助，再說明限制。
客訴、設備故障、付款問題、退款爭議、訂房異常、遺失物、緊急需求，或客人明顯焦急、不滿時，立即收斂成平穩、明確、有同理心的語氣；不用歡樂 emoji、「～」或「沒問題喔」等輕快承接，也不淡化情況。清楚說明應由誰協助與安全的下一步，不假裝事情已處理完成。
Emoji 只用於一般友善的文字對話，一則最多零到一個且不必每則使用；嚴肅情境完全不用歡樂 emoji。語音完全不使用 emoji。
親切絕不能凌駕真實性：不得為了顯得有幫助而捏造事實、價格、空房、訂單、政策、已執行的動作或承諾；系統沒有實際完成的員工動作，不得聲稱已完成。`;
}

const CHANNEL_PRESENTATION = Object.freeze({
  web: "Web 呈現：保持自然；有助於理解時可以稍微完整，但避免冗長與制式格式。",
  line: "LINE 呈現：使用適合手機閱讀的純文字與短句，對話自然且相對精簡；一般友善情境可依共用規則使用適度的「～」與 emoji，不使用網頁 UI 專屬措辭。",
  messenger: "Messenger 呈現：使用適合即時通訊閱讀的純文字與短句；只調整排版，不改變共用人格、服務順序或事實內容。",
  instagram: "Instagram DM 呈現：使用適合即時通訊閱讀的純文字與短句；只調整排版，不改變共用人格、服務順序或事實內容。",
  voice: "語音呈現：使用一到三個容易聽懂的口語短句；不使用條列、Markdown、標題、表情符號、網址或其他只適合文字閱讀的格式。"
});

export function channelPresentationInstructions(channel = "web") {
  return CHANNEL_PRESENTATION[channel] || CHANNEL_PRESENTATION.web;
}

export function styledInstructions(channel = "web") {
  return `${hospitalityPersonalityInstructions()}\n${channelPresentationInstructions(channel)}`;
}

export const CORE_PERSONALITY_CONTRACT_VERSION = "hotelmapp-core-personality/1";
export const CUSTOMER_CHANNELS = Object.freeze(["web", "line", "messenger", "instagram", "voice"]);

const WARM_OPENING = Object.freeze({
  "zh-TW": ["好的，", "了解，", "可以的，"],
  en: ["Certainly—", "Of course—", "Got it—"],
  ja: ["承知しました。", "はい、", "かしこまりました。"],
  ko: ["네, ", "알겠습니다. ", "물론입니다. "]
});

function stableChoice(message, choices) {
  const score = [...String(message)].reduce((sum, character) => sum + character.codePointAt(0), 0);
  return choices[score % choices.length];
}

function alreadyHuman(text, language) {
  const patterns = {
    "zh-TW": /^(?:有的|有喔|可以|好的|了解|當然|沒問題|很抱歉|房內|早餐|主餐|是中西式|兒童早餐|希堤微旅|文件所載|第一晚|限透過|每位旅客|壽星生日券|Taiwan PASS|平日住宿獎助|尚未登錄|第三晚|補助資格)/u,
    en: /^(?:yes|certainly|of course|got it|breakfast|we can|there (?:are|is)|I’m sorry|Hotel Mapp|The (?:published|subsidy|first)|Each guest|Despite its name|Guests who)/iu,
    ja: /^(?:はい|承知|かしこまり|朝食|ご希望|希堤微旅|ホテル公式|平日宿泊補助)/u,
    ko: /^(?:네|알겠습니다|물론|조식|호텔|공개된|평일 숙박)/u
  };
  return patterns[language]?.test(text) || false;
}

function seriousSituation(message) {
  return /(客訴|投訴|抱怨|不滿|生氣|故障|壞掉|無法使用|退款|退費|扣款|付款異常|緊急|受傷|危險|遺失)/u.test(message);
}

function subsidyPhase(subsidy, temporalContext) {
  const date = temporalContext?.date || "";
  if (date && date < subsidy.period.startsOn) return "upcoming";
  if (date && date > subsidy.period.endsOn) return "ended";
  return "active";
}

function subsidyStatusText(subsidy, temporalContext, language) {
  const phase = subsidyPhase(subsidy, temporalContext);
  if (language === "en") {
    if (phase === "upcoming") return `Hotel Mapp will participate in the 2026 weekday accommodation subsidy from September 1 to November 30, 2026`;
    if (phase === "ended") return `The published 2026 weekday accommodation subsidy period ended on November 30, 2026; please refer to the latest government announcement for any extension`;
    return `Hotel Mapp is participating in the 2026 weekday accommodation subsidy from September 1 to November 30, 2026`;
  }
  if (language === "ja") {
    if (phase === "upcoming") return `希堤微旅は2026年9月1日から11月30日まで平日宿泊補助に参加予定です`;
    if (phase === "ended") return `公表されている2026年平日宿泊補助は11月30日に終了しました。延長の有無は政府の最新公告をご確認ください`;
    return `希堤微旅は2026年9月1日から11月30日まで平日宿泊補助に参加しています`;
  }
  if (language === "ko") {
    if (phase === "upcoming") return `호텔 맵은 2026년 9월 1일부터 11월 30일까지 평일 숙박 보조금 행사에 참여할 예정입니다`;
    if (phase === "ended") return `공개된 2026년 평일 숙박 보조금 기간은 11월 30일에 종료되었습니다. 연장 여부는 정부의 최신 공지를 확인해 주세요`;
    return `호텔 맵은 2026년 9월 1일부터 11월 30일까지 평일 숙박 보조금 행사에 참여하고 있습니다`;
  }
  if (phase === "upcoming") return "希堤微旅將於 2026 年 9 月 1 日起參加平日住宿補助，活動至 11 月 30 日止";
  if (phase === "ended") return "文件所載的 2026 平日住宿補助已於 11 月 30 日結束；是否延長請以政府最新公告為準";
  return "希堤微旅目前有參加 2026 平日住宿補助，活動期間至 11 月 30 日止";
}

// This is the sole finalization boundary for ordinary guest-facing answers.
// It may change presentation, never the selected fact set. Callers pass the
// already-grounded draft; adapters only transport the returned text.
export function applyCorePersonalityContract({ draft, message, language = "zh-TW", channel = "web" }) {
  if (!CUSTOMER_CHANNELS.includes(channel)) throw new TypeError(`Unsupported customer channel: ${channel}`);
  const source = typeof draft === "string" ? draft.trim() : "";
  if (!source) throw new TypeError("Core Personality Contract requires a non-empty grounded draft");

  let text = source;
  if (!seriousSituation(message) && !alreadyHuman(text, language)) {
    text = `${stableChoice(message, WARM_OPENING[language] || WARM_OPENING["zh-TW"])}${text}`;
  }
  if (channel === "voice") text = text.replace(/[😊😀🙂✨❤️～]/gu, "").replace(/\n+/g, " ");
  return Object.freeze({ text, contractVersion: CORE_PERSONALITY_CONTRACT_VERSION, channel });
}

// Renderers receive an already-selected authoritative fact subset. They must
// never look up hotel data themselves: personality is presentation, not truth.
export function renderHospitalityFact({ topic, intent, facts, language = "zh-TW", channel = "web", temporalContext }) {
  const voice = channel === "voice";
  if (topic === "subsidy") {
    const subsidy = facts?.governmentSubsidy2026 || {};
    const status = subsidyStatusText(subsidy, temporalContext, language);
    const phase = subsidyPhase(subsidy, temporalContext);
    if (phase !== "active" && intent !== "subsidy_overview" && intent !== "subsidy_period") {
      const detail = renderHospitalityFact({
        topic, intent, facts, language, channel,
        temporalContext: { ...temporalContext, date: "2026-10-15" }
      });
      const separator = language === "zh-TW" ? "；" : language === "ja" || language === "ko" ? "。" : ". ";
      return `${status}${separator}${detail}`;
    }
    if (language === "en") {
      if (intent === "subsidy_period") return `${status}. It applies to Sunday-through-Thursday stays, excluding Fridays, Saturdays, and national long weekends. Funding may run out early, and the latest government announcement prevails.`;
      if (intent === "subsidy_amount") return `The first night receives ${subsidy.weekdayStayAward.firstNight}, and a consecutive second night receives ${subsidy.weekdayStayAward.consecutiveSecondNight}, for up to ${subsidy.weekdayStayAward.maximumForTwoNightStay}. Eligibility and available funding must still be confirmed in the government system.`;
      if (intent === "subsidy_booking_channel") return `The subsidy is for direct bookings through the hotel website, phone, LINE, or on site. Agoda, Booking.com, and other OTA or third-party bookings are not eligible.`;
      if (intent === "subsidy_participation_limit") return `Each guest may participate once during the campaign. That one participation may still cover the first and consecutive second night of the same stay under the published rules.`;
      if (intent === "subsidy_birthday_voucher") return `Despite its name, the NT$1,200 Birthday Voucher is not based on the guest’s birthday. It is available only to guests who enter the campaign lottery and win.`;
      if (intent === "subsidy_taiwan_pass") return `The Taiwan PASS accommodation voucher is ${subsidy.taiwanPass.amountPerRoomPerNight} per room per night. Final eligibility must be confirmed in the government system.`;
      if (intent === "subsidy_stacking") return `The weekday subsidy, Birthday Voucher, and Taiwan PASS may all be combined. The total discount cannot exceed that night’s full room rate, and any excess cannot be paid in cash, returned as change, or retained.`;
      if (intent === "subsidy_registration") return `Guests who have not registered may use the hotel-provided QR code to open the official government campaign website. Please do not send ID photos, ID numbers, or health-card information in chat.`;
      if (intent === "subsidy_third_night") return `The available information does not confirm a third-night subsidy, so I don’t want to give you an incorrect answer. Please refer to the latest government announcement or confirm with the front desk.`;
      if (intent === "subsidy_eligibility") return `Eligibility, available allowance, and remaining funding must be confirmed in the government system. The hotel cannot guarantee approval, and the latest government announcement prevails.`;
      return `${status}. The first night receives ${subsidy.weekdayStayAward.firstNight}, and a consecutive second night receives ${subsidy.weekdayStayAward.consecutiveSecondNight}. Each guest may participate once, subject to government-system confirmation and remaining funding.`;
    }
    if (language === "ja") {
      if (intent === "subsidy_booking_channel") return `ホテル公式サイト、電話、LINE、現地での直接予約が対象です。Agoda、Booking.comなどのOTA・第三者サイト経由の予約は対象外です。`;
      if (intent === "subsidy_stacking") return `平日宿泊補助、壽星生日券、Taiwan PASSは3つ同時に併用できます。ただし、その日の正規宿泊料金を超える割引はできず、超過分の現金返金・釣銭・繰越はありません。`;
      return `${status}。1泊目はNT$800、連続する2泊目はNT$1,200で、1人につき期間中1回までです。最終的な資格と残額は政府システムおよび最新公告をご確認ください。`;
    }
    if (language === "ko") {
      if (intent === "subsidy_booking_channel") return `호텔 공식 웹사이트, 전화, LINE 또는 현장 직접 예약만 대상입니다. Agoda, Booking.com 등 OTA·제3자 예약은 사용할 수 없습니다.`;
      if (intent === "subsidy_stacking") return `평일 숙박 보조금, 생일권, Taiwan PASS 세 가지를 동시에 사용할 수 있습니다. 단, 총 할인액은 당일 정상 객실 요금을 초과할 수 없으며 초과분은 현금 환불, 거스름돈 또는 이월이 불가합니다.`;
      return `${status}. 첫날은 NT$800, 연속 두 번째 날은 NT$1,200이며 1인당 행사 기간 중 1회만 참여할 수 있습니다. 최종 자격과 잔여 예산은 정부 시스템과 최신 공지를 확인해 주세요.`;
    }
    if (intent === "subsidy_period") return `${status}；限週日至週四入住，週五、週六及國定連續假日不適用。經費用罄可能提前結束，仍以政府最新公告為準。`;
    if (intent === "subsidy_amount") return `第一晚折抵 ${subsidy.weekdayStayAward.firstNight}，連續入住第二晚折抵 ${subsidy.weekdayStayAward.consecutiveSecondNight}，兩晚最高 ${subsidy.weekdayStayAward.maximumForTwoNightStay}。實際資格與額度仍須由政府系統確認。`;
    if (intent === "subsidy_booking_channel") return `限透過飯店官網、電話、LINE 或現場直接訂房；Agoda、Booking.com 等 OTA／第三方平台訂單不能使用。`;
    if (intent === "subsidy_participation_limit") return `每位旅客在活動期間限參與一次；同一次連續住宿仍可依規定使用第一晚及連續第二晚補助。`;
    if (intent === "subsidy_birthday_voucher") return `壽星生日券雖然名稱有「壽星」，但與旅客生日無關；必須參加活動抽獎並中獎後才能取得，每房可折抵 ${subsidy.birthdayVoucher.amountPerRoom}。`;
    if (intent === "subsidy_taiwan_pass") return `Taiwan PASS 住宿券是每房每晚折抵 ${subsidy.taiwanPass.amountPerRoomPerNight}；實際使用資格仍須由政府系統確認。`;
    if (intent === "subsidy_stacking") return `平日住宿獎助、壽星生日券與 Taiwan PASS 三項可以同時疊加，但總折抵最高不得超過當天實際全額房價；超過部分不能退現、找現或保留。`;
    if (intent === "subsidy_registration") return `尚未登錄的旅客可以使用飯店提供的 QR Code 進入政府活動官方網站登錄。請不要在 LINE、Messenger 或網站聊天中傳送證件照片、身分證字號或健保卡資料。`;
    if (intent === "subsidy_third_night") return `第三晚是否另有補助目前沒有確認到，不想先提供錯誤答案；請以政府最新公告或櫃檯查詢結果為準。`;
    if (intent === "subsidy_eligibility") return `補助資格、可用額度及經費是否仍充足，都必須由政府活動系統確認，飯店無法先保證；活動解釋以政府最新公告為準。`;
    return `${status}；第一晚折抵 ${subsidy.weekdayStayAward.firstNight}，連續第二晚折抵 ${subsidy.weekdayStayAward.consecutiveSecondNight}。每位旅客活動期間限參與一次，實際資格、額度與經費仍以政府系統及最新公告為準。`;
  }
  if (topic === "parking") {
    const parking = facts?.parking || {};
    if (intent === "parking_fee") {
      const rule = parking.feeRule;
      const freeCars = parking.freeCarsPerRoom;
      const additionalFee = parking.additionalCarFee;
      if (language === "en") return `Yes—${freeCars} car per room is complimentary. A second car is ${additionalFee}.`;
      if (language === "ja") return `はい、1室につき${freeCars}台は無料です。2台目は${additionalFee}となります。`;
      if (language === "ko") return `네, 객실당 차량 ${freeCars}대는 무료이고 두 번째 차량은 ${additionalFee}입니다.`;
      return `可以的${voice ? "，" : "～如果您是兩台車過來，"}${String(rule).replace("每間客房提供", "每間客房都有").replace("；", "，")}`;
    }
    if (intent === "parking_location") {
      if (language === "en") return `There are ${parking.hotelSpaces} spaces ${parking.hotelSpacesLocation}. If they’re full, we’ll direct you to a partner parking lot.`;
      if (language === "ja") return `${parking.hotelSpacesLocation}に${parking.hotelSpaces}台分ございます。満車の場合は提携駐車場をご案内します。`;
      if (language === "ko") return `${parking.hotelSpacesLocation}에 ${parking.hotelSpaces}대 주차할 수 있습니다. 만차일 경우 제휴 주차장을 안내해 드립니다.`;
      return `${parking.hotelSpacesLocation}有 ${parking.hotelSpaces} 個車位喔！如果滿位，我們會再引導您到配合停車場。`;
    }
    if (intent === "parking_availability") {
      if (language === "en") return `Yes, there are ${parking.hotelSpaces} spaces ${parking.hotelSpacesLocation}. If they are full, a partner parking lot is also available; parking is arranged according to availability when you arrive.`;
      if (language === "ja") return `はい、${parking.hotelSpacesLocation}に${parking.hotelSpaces}台分ございます。満車の場合は提携駐車場をご案内し、当日の空き状況に合わせて対応いたします。`;
      if (language === "ko") return `네, ${parking.hotelSpacesLocation}에 ${parking.hotelSpaces}대 주차할 수 있습니다. 만차일 경우 제휴 주차장을 안내하며, 당일 주차 상황에 따라 도와드립니다.`;
      return `有的，${parking.hotelSpacesLocation}可停 ${parking.hotelSpaces} 台車；飯店門口停滿時，也有配合停車場可以使用。我們會依當天現場車位情形協助安排。`;
    }
    if (intent === "parking_process") {
      if (language === "zh-TW") return `可以的，${parking.processRule}如果您已經停好車，照這個方式辦理就可以了。`;
    }
    if (intent === "parking_reservation") {
      const policy = parking.reservationPolicy;
      if (language === "en") return "Parking spaces cannot be reserved and are available on a first-come, first-served basis so every guest has a fair opportunity to use them. If the spaces at the hotel entrance are full when you arrive, we’ll help arrange a partner parking lot based on the situation at that time.";
      if (language === "ja") return "駐車スペースの事前予約は承っておらず、すべてのお客様に公平にご利用いただけるよう先着順です。到着時にホテル入口の駐車スペースが満車の場合は、当日の状況に応じて提携駐車場をご案内します。";
      if (language === "ko") return "주차 공간은 예약할 수 없으며 모든 투숙객이 공평하게 이용할 수 있도록 선착순으로 운영됩니다. 도착 시 호텔 입구 주차 공간이 만차이면 현장 상황에 따라 제휴 주차장을 안내해 드립니다.";
      return `不好意思，停車位目前沒有提供預留喔，我們採${policy.allocation}的方式，主要是希望${policy.rationale}${policy.arrivalAssistance}`;
    }
    if (intent === "parking_problem") {
      if (language === "zh-TW") return `了解，進出停車場遇到問題確實不方便。${parking.problemRule}`;
    }
  }
  if (topic === "wifi") {
    const wifi = facts?.amenities?.wifi || {};
    if (language === "en") return `Please connect to the Wi-Fi network matching your room number. Password: ${wifi.password}`;
    if (language === "ja") return `ご宿泊の客室番号と同じ名前のWi-Fiに接続してください。パスワードは${wifi.password}です。`;
    if (language === "ko") return `투숙하시는 객실 번호와 같은 이름의 Wi-Fi에 연결해 주세요. 비밀번호는 ${wifi.password}입니다.`;
    return `請連接名稱與您住宿房號相同的 Wi-Fi，密碼為 8 個 0：${wifi.password}。`;
  }
  return null;
}
