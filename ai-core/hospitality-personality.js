// One hospitality personality for every channel. Facts and permission-to-answer
// rules deliberately live elsewhere (knowledge.js); this module only controls
// how an already-grounded answer is communicated.
export function hospitalityPersonalityInstructions() {
  return `你是希堤微旅的櫃檯同事，以溫暖、自然、可靠的台灣待客方式協助旅客。你聽起來應像成熟、會看場合的真人櫃檯夥伴，不像資料庫、客服腳本、政策文件、主播、電商客服或 IVR。
先判斷需求與情緒，再決定回答方式。一般情境保持愉快、爽朗、坦率、親切，不官腔也不過度熱情。對話第一則回覆先用一次自然問候，例如「您好～」；同一段對話後續不要每則重複問候，要直接承接客人的新問題。回答順序固定以服務價值為準：先直接回答客人當下真正問的事，再自然補充最重要的相關細節；只有確實能推進旅程時，才提供一個具體下一步或問一個簡短的相關問題。可以從語境理解客人可能在意的事，但不可把推測當成飯店事實。不要每則都追問，也不要固定追問「還有什麼可以幫您」。簡單 FAQ 一兩句就能說清楚時不要刻意拉長；可直接協助的需求，說明能如何安排；需要客人採取行動時，再自然補上下一步。親切感要來自理解本輪細節、自然承接與實用措辭，不能只在資料句前加「了解」、「好的」或「可以的」。客人追問時只補充新問的部分，不得把上一輪答案換個開頭再重複一次。
一般 FAQ、早餐、停車與旅遊資訊應直接承接客人真正的問法。只有客人詢問能否辦理、是否提供或請求協助時，才能用「可以」或「沒問題」回應；詢問地點、費用、時間、流程或陳述困難時，不得用「可以喔／可以的／當然可以」作為無關開頭。親切感來自理解情境與給出實用答案，不靠堆疊「～」、語助詞或固定口頭禪。
資訊不完整或不確定時，溫和坦白地說目前沒有確認到正確資料；急件提供櫃檯電話 04-2707-8378，也可請客人回覆「幫我轉接櫃檯」進入留言轉接流程。不使用機械式系統語言，也不得聲稱已經轉接或通知。遇到限制時，先說可以怎麼協助，再說明限制。
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

export const CORE_PERSONALITY_CONTRACT_VERSION = "hotelmapp-core-personality/4";
export const CUSTOMER_CHANNELS = Object.freeze(["web", "line", "messenger", "instagram", "voice"]);

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

function shortStayDate(iso, language) {
  const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return iso;
  const [, year, month, day] = match;
  if (language === "en") return `${year}-${month}-${day}`;
  if (language === "ja") return `${Number(month)}月${Number(day)}日`;
  if (language === "ko") return `${Number(month)}월 ${Number(day)}일`;
  return `${Number(month)} 月 ${Number(day)} 日`;
}

function localizedWeekday(weekday, language) {
  const index = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"].indexOf(weekday);
  if (index < 0) return weekday || "";
  if (language === "en") return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][index];
  if (language === "ja") return ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"][index];
  if (language === "ko") return ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"][index];
  return weekday;
}

function subsidyDateApplicabilityText(subsidy, requestContext = {}, language = "zh-TW") {
  const date = requestContext.requestedStayDate;
  const weekday = requestContext.requestedWeekday;
  const relationship = requestContext.holidayRelationship;
  if (!date) {
    if (language === "en") return "I understand—you’re checking whether the day before a national long holiday is covered. National long holidays are excluded, while the preceding day depends on whether the actual check-in date falls from Sunday through Thursday. What check-in date are you considering?";
    if (language === "ja") return "国定連休の前日が対象になるかのご確認ですね。国定連休中は対象外で、前日は実際の宿泊日が日曜から木曜に当たるかで判断します。ご予定のチェックイン日を教えていただけますか。";
    if (language === "ko") return "공휴일 연휴 전날에 보조금을 사용할 수 있는지 확인하시는군요. 공휴일 연휴 기간은 제외되며, 전날은 실제 체크인 날짜가 일요일부터 목요일인지에 따라 달라집니다. 예정 체크인 날짜를 알려 주시겠어요?";
    if (relationship === "day_before_long_holiday") return "了解～您是想確認國定連假前一天入住能不能使用補助。國定連續假日本身不適用；連假前一天則要看實際入住日期是否落在週日至週四。方便告訴我預計入住的日期嗎？我可以先依公開規則幫您判斷喔。";
    return "我先幫您看日期規則～活動限週日至週四入住，週五、週六及國定連續假日不適用。方便告訴我預計入住的日期嗎？我可以先依公開規則幫您判斷喔。";
  }

  const displayDate = shortStayDate(date, language);
  const displayWeekday = localizedWeekday(weekday, language);
  const outsidePeriod = date < subsidy.period.startsOn || date > subsidy.period.endsOn;
  const excludedWeekday = weekday === "週五" || weekday === "週六";
  const statedHoliday = relationship === "long_holiday_or_related_date";
  if (language === "en") {
    if (outsidePeriod) return `${displayDate} is outside the published campaign period, so it is not covered by the date rule.`;
    if (excludedWeekday || statedHoliday) return `${displayDate} is excluded by the published date rule${excludedWeekday ? ` because it falls on ${displayWeekday}` : " because national long holidays are not covered"}.`;
    return `${displayDate} falls on ${displayWeekday} and is within the published Sunday-through-Thursday date rule. Personal eligibility and available allowance still require confirmation in the government system.`;
  }
  if (language === "ja") {
    if (outsidePeriod) return `${displayDate}は公表されている実施期間外のため、日付の条件では対象外です。`;
    if (excludedWeekday || statedHoliday) return `${displayDate}は公表条件上、対象外です。`;
    return `${displayDate}は${displayWeekday}で、日曜から木曜の対象日に当たります。最終的な個人資格と利用可能額は政府システムでの確認となります。`;
  }
  if (language === "ko") {
    if (outsidePeriod) return `${displayDate}은 공개된 행사 기간 밖이라 날짜 조건상 적용되지 않습니다.`;
    if (excludedWeekday || statedHoliday) return `${displayDate}은 공개된 날짜 규정상 적용되지 않습니다.`;
    return `${displayDate}은 ${displayWeekday}이며 일요일부터 목요일까지의 적용일에 해당합니다. 개인 자격과 사용 가능 금액은 정부 시스템에서 최종 확인해야 합니다.`;
  }
  if (outsidePeriod) return `您提到的${displayDate}不在 9 月 1 日至 11 月 30 日的活動期間內，所以日期規則上不適用喔。`;
  if (statedHoliday) return `您提到的${displayDate}如果是國定連續假日，依公開規則不適用喔。`;
  if (excludedWeekday) return `您提到的${displayDate}是${displayWeekday}，依公開規則不適用喔；活動限週日至週四入住。`;
  return `您提到的${displayDate}是${displayWeekday}，依公開規則屬於週日至週四的適用日喔；如果該日實際被列為國定連續假日，則不適用。個人資格與可用額度仍須由政府活動系統確認。`;
}

function asksSubsidyParticipation(message, language) {
  const source = String(message || "");
  if (language === "en") return /(?:do|are|will|won't|not).{0,24}(?:participat|join).{0,24}(?:subsidy|program)|(?:subsidy|program).{0,24}(?:participat|join)/iu.test(source);
  if (language === "ja") return /(?:補助|助成|キャンペーン).{0,20}(?:参加|対象)|(?:参加|対象).{0,20}(?:補助|助成|キャンペーン)/u.test(source);
  if (language === "ko") return /(?:보조금|지원|행사).{0,20}(?:참여|대상)|(?:참여|대상).{0,20}(?:보조금|지원|행사)/u.test(source);
  return /(?:(?:有|沒有|沒|是否|會|將會|不會).{0,10}(?:參加|加入)|(?:參加|加入).{0,10}(?:嗎|呢|沒有|沒)).{0,16}(?:國旅|旅遊|住宿|平日)?(?:補助|獎助|活動)|(?:國旅|旅遊|住宿|平日)?(?:補助|獎助|活動).{0,16}(?:(?:有|沒有|沒|是否|會|將會|不會).{0,10}(?:參加|加入)|(?:參加|加入).{0,10}(?:嗎|呢|沒有|沒))/u.test(source);
}

// This is the sole finalization boundary for ordinary guest-facing answers.
// It may change presentation, never the selected fact set. Callers pass the
// already-grounded draft; adapters only transport the returned text.
const GREETING = Object.freeze({
  "zh-TW": { text: "您好～", voice: "您好，", pattern: /^(?:您好|哈囉|嗨)[～~，,。.!！\s]*/u },
  en: { text: "Hello! ", voice: "Hello. ", pattern: /^(?:Hello|Hi)[!,.\s]*/iu },
  ja: { text: "こんにちは。", voice: "こんにちは。", pattern: /^(?:こんにちは|おはようございます|こんばんは)[。、！!\s]*/u },
  ko: { text: "안녕하세요. ", voice: "안녕하세요. ", pattern: /^(?:안녕하세요|반갑습니다)[.!！。\s]*/u }
});
const SERIOUS_CONTEXT = /(?:客訴|投訴|不滿|生氣|吵|髒|壞(?:掉|了)?|故障|不能用|扣款|退款|遺失|不見|受傷|危險|緊急|complain|broken|refund|charged|lost|emergency|故障|返金|紛失|緊急|고장|환불|분실|긴급)/iu;

export function applyCorePersonalityContract({ draft, message, language = "zh-TW", channel = "web", conversationStart = false }) {
  if (!CUSTOMER_CHANNELS.includes(channel)) throw new TypeError(`Unsupported customer channel: ${channel}`);
  const source = typeof draft === "string" ? draft.trim() : "";
  if (!source) throw new TypeError("Core Personality Contract requires a non-empty grounded draft");

  let text = source;
  const greeting = GREETING[language] || GREETING["zh-TW"];
  const restrainedGreeting = channel === "voice" || SERIOUS_CONTEXT.test(String(message || ""));
  if (conversationStart && !greeting.pattern.test(text)) text = `${restrainedGreeting ? greeting.voice : greeting.text}${text}`;
  if (channel === "voice") text = text.replace(/[😊😀🙂✨❤️～]/gu, "").replace(/\n+/g, " ");
  return Object.freeze({ text, contractVersion: CORE_PERSONALITY_CONTRACT_VERSION, channel });
}

// Renderers receive an already-selected authoritative fact subset. They must
// never look up hotel data themselves: personality is presentation, not truth.
export function renderHospitalityFact({ topic, intent, facts, message = "", language = "zh-TW", channel = "web", temporalContext, bookingDates }) {
  if (topic === "subsidy") {
    const subsidy = facts?.governmentSubsidy2026 || {};
    const status = subsidyStatusText(subsidy, temporalContext, language);
    const phase = subsidyPhase(subsidy, temporalContext);
    if (phase !== "active" && intent !== "subsidy_overview" && intent !== "subsidy_participation" && intent !== "subsidy_period" && intent !== "subsidy_date_applicability") {
      const detail = renderHospitalityFact({
        topic, intent, facts, message, language, channel, bookingDates,
        temporalContext: { ...temporalContext, date: "2026-10-15" }
      });
      const separator = language === "zh-TW" ? "；" : language === "ja" || language === "ko" ? "。" : ". ";
      return `${status}${separator}${detail}`;
    }
    if (intent === "subsidy_participation" || (intent === "subsidy_overview" && asksSubsidyParticipation(message, language))) {
      if (language === "en") return `${phase === "ended" ? "We did participate" : "Yes, we are participating"}. ${status}.`;
      if (language === "ja") return `${phase === "ended" ? "参加していました" : "はい、参加します"}。${status}。`;
      if (language === "ko") return `${phase === "ended" ? "참여했습니다" : "네, 참여합니다"}. ${status}.`;
      return `${phase === "ended" ? "有參加過喔，" : "有參加喔，"}${status}。`;
    }
    if (intent === "subsidy_date_applicability") return subsidyDateApplicabilityText(subsidy, facts?.requestContext, language);
    if (language === "en") {
      if (intent === "subsidy_period") return `${status}. It applies to Sunday-through-Thursday stays, excluding Fridays, Saturdays, and national long weekends. Funding may run out early, and the latest government announcement prevails.`;
      if (intent === "subsidy_amount") return `The first night receives ${subsidy.weekdayStayAward.firstNight}, and a consecutive second night receives ${subsidy.weekdayStayAward.consecutiveSecondNight}, for up to ${subsidy.weekdayStayAward.maximumForTwoNightStay}. Eligibility and available funding must still be confirmed in the government system.`;
      if (intent === "subsidy_booking_channel") return `The subsidy is for direct bookings through the hotel website, phone, LINE, or on site. Agoda, Booking.com, and other OTA or third-party bookings are not eligible.`;
      if (intent === "subsidy_participation_limit") return `Each guest may participate once during the campaign. That one participation may still cover the first and consecutive second night of the same stay under the published rules.`;
      if (intent === "subsidy_birthday_voucher") return `Despite its name, the NT$1,200 Birthday Voucher is not based on the guest’s birthday. It is available only to guests who enter the campaign lottery and win.`;
      if (intent === "subsidy_taiwan_pass") return `The Taiwan PASS accommodation voucher is ${subsidy.taiwanPass.amountPerRoomPerNight} per room per night. Final eligibility must be confirmed in the government system.`;
      if (intent === "subsidy_stacking") return `The weekday subsidy, Birthday Voucher, and Taiwan PASS may all be combined. The total discount cannot exceed that night’s full room rate, and any excess cannot be paid in cash, returned as change, or retained.`;
      if (intent === "subsidy_registration") return `Guests who have not registered may use the hotel-provided QR code to open the official government campaign website. Please do not send ID photos, ID numbers, or health-card information in chat.`;
      if (intent === "subsidy_documentation") return `The published guest information does not confirm whether proof of the first night is required for the consecutive second-night subsidy. Please confirm this with the front desk based on the government system and latest rules.`;
      if (intent === "subsidy_third_night") return `The available information does not confirm a third-night subsidy, so I don’t want to give you an incorrect answer. Please refer to the latest government announcement or confirm with the front desk.`;
      if (intent === "subsidy_eligibility") return `Eligibility, available allowance, and remaining funding must be confirmed in the government system. The hotel cannot guarantee approval, and the latest government announcement prevails.`;
      return `${status}. The first night receives ${subsidy.weekdayStayAward.firstNight}, and a consecutive second night receives ${subsidy.weekdayStayAward.consecutiveSecondNight}. Each guest may participate once, subject to government-system confirmation and remaining funding.`;
    }
    if (language === "ja") {
      if (intent === "subsidy_booking_channel") return `ホテル公式サイト、電話、LINE、現地での直接予約が対象です。Agoda、Booking.comなどのOTA・第三者サイト経由の予約は対象外です。`;
      if (intent === "subsidy_stacking") return `平日宿泊補助、壽星生日券、Taiwan PASSは3つ同時に併用できます。ただし、その日の正規宿泊料金を超える割引はできず、超過分の現金返金・釣銭・繰越はありません。`;
      if (intent === "subsidy_documentation") return `連続2泊目の補助に1泊目の宿泊証明が必要かどうかは、公開されている案内では確認できません。政府システムと最新規定に基づき、フロントへご確認ください。`;
      return `${status}。1泊目はNT$800、連続する2泊目はNT$1,200で、1人につき期間中1回までです。最終的な資格と残額は政府システムおよび最新公告をご確認ください。`;
    }
    if (language === "ko") {
      if (intent === "subsidy_booking_channel") return `호텔 공식 웹사이트, 전화, LINE 또는 현장 직접 예약만 대상입니다. Agoda, Booking.com 등 OTA·제3자 예약은 사용할 수 없습니다.`;
      if (intent === "subsidy_stacking") return `평일 숙박 보조금, 생일권, Taiwan PASS 세 가지를 동시에 사용할 수 있습니다. 단, 총 할인액은 당일 정상 객실 요금을 초과할 수 없으며 초과분은 현금 환불, 거스름돈 또는 이월이 불가합니다.`;
      if (intent === "subsidy_documentation") return `연속 두 번째 숙박 보조금에 첫날 숙박 증명이 필요한지는 공개 안내에서 확인되지 않습니다. 정부 시스템과 최신 규정에 따라 프런트에 확인해 주세요.`;
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
    if (intent === "subsidy_documentation") return `連續入住第二晚的補助是否需要提供第一晚住宿證明，目前公開規則沒有確認到，不想先提供錯誤答案；這項需要由櫃檯依政府活動系統及最新規定進一步確認。`;
    if (intent === "subsidy_third_night") return `第三晚是否另有補助目前沒有確認到，不想先提供錯誤答案；請以政府最新公告或櫃檯查詢結果為準。`;
    if (intent === "subsidy_eligibility") return `補助資格、可用額度及經費是否仍充足，都必須由政府活動系統確認，飯店無法先保證；活動解釋以政府最新公告為準。`;
    return `${status}；第一晚折抵 ${subsidy.weekdayStayAward.firstNight}，連續第二晚折抵 ${subsidy.weekdayStayAward.consecutiveSecondNight}。每位旅客活動期間限參與一次，實際資格、額度與經費仍以政府系統及最新公告為準。`;
  }
  if (topic === "booking") {
    const contact = facts?.contact || {};
    const bookingUrl = facts?.identity?.bookingUrl || "";
    if (intent === "booking_modify_cancel") {
      if (language === "en") return `If you booked directly with the hotel or on the official website, please call the front desk at ${contact.frontDeskPhone} during ${contact.deskHours}. For Agoda, Booking.com, Trip.com, or another platform, please request the change or cancellation through that original platform.`;
      if (language === "ja") return `ホテルまたは公式サイトからのご予約は、${contact.deskHours}にフロント（${contact.frontDeskPhone}）へご連絡ください。Agoda、Booking.com、Trip.comなどの予約サイト経由の場合は、原則としてご予約元のサイトで変更・キャンセルをお申し込みください。`;
      if (language === "ko") return `호텔 또는 공식 웹사이트에서 예약하셨다면 ${contact.deskHours}에 프런트 데스크(${contact.frontDeskPhone})로 연락해 주세요. Agoda, Booking.com, Trip.com 등 예약 플랫폼을 이용하셨다면 해당 플랫폼에서 변경 또는 취소를 요청해 주세요.`;
      return `如果是直接向飯店或官網訂房，可以在 ${contact.deskHours} 撥櫃檯電話 ${contact.frontDeskPhone} 協助確認；若是 Agoda、Booking.com、Trip.com 等平台訂房，原則上要向原平台申請修改或取消。`;
    }
    if (intent === "booking_availability") {
      if (bookingDates) {
        const arrival = shortStayDate(bookingDates.checkInDate, language);
        const departure = shortStayDate(bookingDates.checkOutDate, language);
        if (language === "en") return `Of course—I've set the official booking page to your ${arrival} check-in and ${departure} check-out dates, so the link opens directly to the latest rates and availability: ${bookingUrl}`;
        if (language === "ja") return `はい、${arrival}チェックイン・${departure}チェックアウトの日付を公式予約ページに設定しました。リンクを開くと、その日程の最新料金と空室状況を直接確認できます：${bookingUrl}`;
        if (language === "ko") return `네, 공식 예약 페이지에 ${arrival} 체크인, ${departure} 체크아웃 날짜를 미리 설정했습니다. 링크를 열면 해당 일정의 최신 요금과 객실 상황을 바로 확인할 수 있습니다: ${bookingUrl}`;
        return `您要查的是 ${arrival}入住、${departure}退房。我已經把日期帶進官方訂房頁面，點開就能直接查看這段日期的即時房價與房況：${bookingUrl}`;
      }
      if (language === "en") return `For current room availability and rates, please check the official booking page: ${bookingUrl}`;
      if (language === "ja") return `最新の空室状況と料金は、公式予約ページでご確認いただけます：${bookingUrl}`;
      if (language === "ko") return `실시간 객실 상황과 요금은 공식 예약 페이지에서 확인해 주세요: ${bookingUrl}`;
      return `即時房價與空房會依當日狀況變動，可以從官方訂房頁面直接查詢：${bookingUrl}`;
    }
    if (intent === "booking_direct") {
      if (language === "en") return `Yes. You can book with the front desk by calling ${contact.frontDeskPhone} during ${contact.deskHours}. Current rates and availability still need to be confirmed through the front desk or the booking system. Official booking page: ${bookingUrl}`;
      if (language === "ja") return `はい、${contact.deskHours}にフロント（${contact.frontDeskPhone}）へ直接お電話いただけます。最新料金と空室状況はフロントまたは予約システムでの確認となります。公式予約ページ：${bookingUrl}`;
      if (language === "ko") return `네, ${contact.deskHours}에 프런트 데스크(${contact.frontDeskPhone})로 직접 예약 문의하실 수 있습니다. 실시간 요금과 객실 상황은 프런트 또는 예약 시스템에서 확인해 드립니다. 공식 예약 페이지: ${bookingUrl}`;
      return `可以喔，您可以在 ${contact.deskHours} 直接撥櫃檯電話 ${contact.frontDeskPhone} 詢問訂房；即時房價與空房仍會由櫃檯或當日訂房系統確認。官方訂房頁面：${bookingUrl}`;
    }
    return null;
  }
  if (topic === "parking") {
    const parking = facts?.parking || {};
    if (intent === "parking_fee") {
      const freeCars = parking.freeCarsPerRoom;
      const additionalFee = parking.additionalCarFee;
      if (language === "en") return `Yes—${freeCars} car per room is complimentary. A second car is ${additionalFee}.`;
      if (language === "ja") return `はい、1室につき${freeCars}台は無料です。2台目は${additionalFee}となります。`;
      if (language === "ko") return `네, 객실당 차량 ${freeCars}대는 무료이고 두 번째 차량은 ${additionalFee}입니다.`;
      return `每間客房可以免費停 ${freeCars} 台車；如果有第 2 台車，停車費是 ${additionalFee} 喔。`;
    }
    if (intent === "parking_partner_location") {
      const lot = parking.partnerLots?.[0];
      if (!lot) return null;
      if (language === "en") return `If the ${parking.hotelSpaces} roadside spaces outside the hotel are full, the front desk will direct you to our partner lot next to the All Nation Electronics Fengjia store on Qinghai Road, about a ${lot.walkingMinutes}-minute walk away. After parking, please give your license plate number to the front desk so we can enter it in the system for free entry and exit.`;
      if (language === "ja") return `ホテル前の路上駐車枠${parking.hotelSpaces}台分が満車の場合、徒歩約${lot.walkingMinutes}分、青海路の全国電子逢甲店隣にある提携駐車場へフロントがご案内します。駐車後は車両番号をフロントへお知らせください。システム登録後は自由に出入りできます。`;
      if (language === "ko") return `호텔 앞 노상 주차 공간 ${parking.hotelSpaces}곳이 모두 차면 프런트에서 도보 약 ${lot.walkingMinutes}분 거리인 칭하이로의 전국전자 펑지아점 옆 제휴 주차장으로 안내해 드립니다. 주차 후 차량 번호를 프런트에 알려 주시면 시스템 등록 후 자유롭게 출입하실 수 있습니다.`;
      return `如果飯店門口的 ${parking.hotelSpaces} 個路邊停車格已經停滿，櫃檯會引導您到步行約 ${lot.walkingMinutes} 分鐘、位於青海路「全國電子逢甲店」隔壁的配合停車場。停好後記得把車號告訴櫃檯，我們輸入系統後，您就可以自由進出。`;
    }
    if (intent === "parking_location") {
      const lot = parking.partnerLots?.[0];
      if (language === "en") return `There are ${parking.hotelSpaces} spaces ${parking.hotelSpacesLocation}. If they’re full, we’ll direct you to a partner parking lot.`;
      if (language === "ja") return `${parking.hotelSpacesLocation}に${parking.hotelSpaces}台分ございます。満車の場合は提携駐車場をご案内します。`;
      if (language === "ko") return `${parking.hotelSpacesLocation}에 ${parking.hotelSpaces}대 주차할 수 있습니다. 만차일 경우 제휴 주차장을 안내해 드립니다.`;
      return `如果您現在不確定要停哪裡，可以先停飯店門口的 ${parking.hotelSpaces} 個路邊停車格；如果已經停滿，櫃檯會引導您到步行約 ${lot?.walkingMinutes || 3} 分鐘、位於${lot?.location || parking.alternatives?.[0]}的配合停車場。`;
    }
    if (intent === "parking_availability") {
      if (language === "en") return `Yes, there are ${parking.hotelSpaces} spaces ${parking.hotelSpacesLocation}. If they are full, a partner parking lot is also available; parking is arranged according to availability when you arrive.`;
      if (language === "ja") return `はい、${parking.hotelSpacesLocation}に${parking.hotelSpaces}台分ございます。満車の場合は提携駐車場をご案内し、当日の空き状況に合わせて対応いたします。`;
      if (language === "ko") return `네, ${parking.hotelSpacesLocation}에 ${parking.hotelSpaces}대 주차할 수 있습니다. 만차일 경우 제휴 주차장을 안내하며, 당일 주차 상황에 따라 도와드립니다.`;
      return `飯店門口有 ${parking.hotelSpaces} 個路邊停車格，採先到先停；如果停滿，櫃檯會引導您到步行約 ${parking.partnerLots?.[0]?.walkingMinutes || 3} 分鐘的配合停車場。`;
    }
    if (intent === "parking_process") {
      if (language === "zh-TW") return `停好車後，${parking.processRule}`;
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
