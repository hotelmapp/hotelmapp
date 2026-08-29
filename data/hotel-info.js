// 唯一內容來源：〈希堤微旅 AI 櫃檯知識庫 V2.3〉正式版（2026-08-29）。
// V2.3 以 V2.2 為基礎，補上飯店營運方確認的配合停車場位置與進出流程。
// 櫃檯內部核銷 SOP 不屬於旅客知識。
// 未出現在正式知識中的資訊必須維持 null，不得以 placeholder 或常識補值。
export const hotelKnowledge = {
  source: { title: "希堤微旅 AI 櫃檯知識庫 V2.3 正式版", date: "2026-08-29", basedOn: "V2.2 正式版（2026-08-23）" },
  identity: { name: "希堤微旅", address: "台中市上石路158號", website: "https://www.hotelm.com.tw/", bookingUrl: "https://book-directonline.com/properties/HotelMappTaichungDIrect?locale=zh-TW" },
  contact: {
    frontDeskPhone: "04-2707-8378",
    fax: "04-2708-7287",
    email: "hotel.mapp158@gmail.com",
    deskHours: "07:00–22:00",
    line: "在 LINE 搜尋「希堤微旅」，即可加入官方帳號並聊天。",
    afterHoursEquipment: "22:00–翌日 07:00 遇到任何設備問題，請撥後勤客服 0927-708-908，洽陳先生。",
    afterHoursSameDayBooking: "22:00–翌日 07:00 如需辦理當日夜間訂房入住，請撥夜間訂房客服 0927-708-908，洽陳先生。"
  },
  stay: {
    checkIn: "15:00 後",
    checkOut: "11:00 前",
    earlyCheckIn: "依當日房況與房務完成狀況協助，無法預先保證。",
    lateCheckOut: "每小時 NT$200，最晚至 14:00，仍須依當日房況確認。",
    afterHoursCheckIn: "預計 22:00 後入住須提前通知櫃檯取得自助入住密碼；抵達後在櫃檯桌上的白色保險箱輸入密碼，領取寫有姓名的房卡信封。",
    access: "22:00 後進出須使用房卡；外出按銀色按鈕，返回以房卡感應黑色感應區。"
  },
  breakfast: {
    serviceHours: "08:00–10:00",
    serviceStart: { time: "08:00", modality: "hard_rule" },
    orderCheckInCutoff: {
      time: "10:00", modality: "hard_rule",
      meaning: "10:00 是點餐／報到截止時間，不是用餐結束時間。"
    },
    diningAfterCutoff: {
      allowed: true, modality: "hard_rule",
      rule: "客人只要在 10:00 前完成點餐／報到，即可繼續用餐，用餐時間不受 10:00 限制。"
    },
    pricePerPerson: "NT$150／人／份",
    serviceStyle: "Brunch 式套餐，一人一套，並非整套自助式早餐。",
    cuisineStyle: "中西式，整體較偏西式。",
    location: "二樓餐廳",
    takeawayAvailable: true,
    menuChoiceCount: 4,
    menuPolicy: "實際餐點內容會不定時更換，以當天 Menu 為準；不得列舉未記載的菜色。",
    selfServiceDrinks: "部分飲料（例如咖啡）採自助式。",
    vegetarianOption: "可以安排；旅客須提前告知櫃台，由餐廳將肉類更換為蛋奶素餐點。",
    childPrice: null,
    preorderRecommendation: {
      timing: "前一天入住時", channel: "櫃台", modality: "recommendation", required: false,
      recommendation: "建議客人在前一天入住時至櫃台先點早餐，方便餐廳提前準備並減少等候時間。"
    },
    notes: [
      "餐點美味且超值，有吃早餐習慣的旅客可考慮預訂。",
      "如需外帶，可提前告知櫃台，由櫃台通知餐廳準備。",
      "兒童早餐價格目前未知，須詢問櫃台，不得推算。"
    ]
  },
  parking: {
    hotelSpaces: 3,
    freeCarsPerRoom: 1,
    additionalCarFee: "NT$200",
    hotelSpacesLocation: "飯店門口的路邊停車格",
    overflowRule: "飯店門口 3 個路邊停車格停滿時，櫃檯會引導至步行約 3 分鐘的配合停車場。",
    reservationPolicy: {
      reservable: false,
      allocation: "先到先停",
      rationale: "讓每位住客都能公平使用。",
      arrivalAssistance: "抵達時如果飯店門口 3 個路邊停車格已滿，櫃檯會引導至步行約 3 分鐘的配合停車場。"
    },
    alternatives: ["青海路全國電子逢甲店隔壁的配合停車場"],
    partnerLots: [{
      name: "希堤微旅配合停車場",
      location: "青海路全國電子逢甲店隔壁",
      landmark: "全國電子逢甲店隔壁",
      walkingMinutes: 3,
      navigation: "可導航至「全國電子逢甲店」；抵達後依櫃檯引導停入隔壁的配合停車場。",
      source: "飯店營運方於 2026-08-29 確認的停車說明與示意圖"
    }],
    rules: ["停妥後務必告知櫃檯車號，由櫃檯輸入停車系統；完成後即可自由進出。", "每間客房提供 1 台免費停車；第 2 台車加收 NT$200 停車費。", "無法進出時聯絡停車場客服，告知為希堤微旅住客。"],
    addresses: null, supportPhone: null
  },
  rooms: [
    { name: "環遊城市雙人房", count: 1, size: "約 19 坪（含 L 型大露台）", beds: "加大床 6×6.2 尺", bathtub: true, extraBeds: 1, positioning: "旗艦雙人房；最大空間、浴缸、大露台、景觀" },
    { name: "樂活旅途雙人房", count: 1, size: "約 7 坪（含 L 型露台）", beds: "標準雙人床 5×6.2 尺", bathtub: false, extraBeds: 1, positioning: "落地窗、夜景、L 型露台；加床後影響動線" },
    { name: "樂遊旅途雙人房", count: 1, size: "約 6 坪（含露台）", beds: "標準雙人床 5×6.2 尺", bathtub: false, extraBeds: 0, positioning: "一般型露台、落地窗，適合兩人" },
    { name: "夢想地圖雙人房", count: 9, size: "約 6 坪", beds: "標準雙人床 5×6.2 尺", bathtub: false, extraBeds: 1, positioning: "小陽台、明亮、六星級柔軟包覆床墊；加床後影響動線" },
    { name: "城市伴侶雙人房", count: 3, size: "約 6 坪", beds: "兩小床可併床", bathtub: false, extraBeds: 0, positioning: "有對外窗；朋友同行或兩大兩小預算型小家庭" },
    { name: "簡約旅行雙人房", count: 5, size: "約 5 坪", beds: "標準雙人床", bathtub: false, extraBeds: 0, positioning: "小陽台、房數多；詢問便宜房型時優先推薦" },
    { name: "經濟房", count: 1, size: "約 4.5 坪", beds: "標準雙人床 5×6.2 尺", bathtub: false, extraBeds: 0, positioning: "無陽台、有對外窗；全館最便宜、乾淨簡約、空間較小" },
    { name: "家庭房", count: 1, size: "接近 30 坪", beds: "兩大床", bathtub: null, extraBeds: 2, positioning: "標準 4 人、最多 6 人；最適合家庭與加床" }
  ],
  extraBed: { price: "NT$450／床，不含早餐", babyEquipment: "嬰兒床、床圍、消毒鍋、澡盆可提供；建議入住前一天告知，依數量與現場狀況確認，不預先保證。" },
  amenities: {
    tv: "大尺寸智慧電視，可使用 YouTube、Netflix 等網路影音平台；無一般第四台／有線電視頻道。付費服務須登入個人帳號，退房前須登出。",
    water: "不提供一次性寶特瓶礦泉水；各樓層電梯旁陽台設有 RO 消毒飲水機。",
    toiletries: "不提供牙刷等一次性拋棄式備品，可至一樓大廳小沙發旁自助小舖選購；房內提供拖鞋、浴巾、毛巾、洗髮精、沐浴乳。",
    laundry: "七樓洗衣間：洗衣機免費、烘衣機投幣 NT$50，另設微波爐。",
    loans: "可向櫃檯借充電器、轉接頭；雨傘數量有限，借完為止。",
    wifi: {
      network: "請連接名稱與住宿房號相同的 Wi-Fi。",
      password: "00000000",
      passwordDescription: "密碼為 8 個 0。"
    }
  },
  houseRules: {
    smoking: "全館客房禁菸；如需吸菸，移至允許的陽台、一樓或各樓層飲水機旁戶外陽台區。房內吸菸觸發煙霧偵測並造成影響，收 NT$1,000 清潔費。",
    pets: "禁止寵物入住；依法可陪同的導盲犬等工作犬例外。",
    housekeeping: "續住如需清潔請告知櫃檯；清潔時段約 12:00–16:00。"
  },
  payment: {
    accepted: ["現金", "LINE Pay", "信用卡", "銀聯卡", "Mastercard"], rejected: ["American Express（設備限制）"],
    invoice: "直接向飯店付款可開發票與統編；補開／更換統編須攜原發票至櫃檯。平台收款則向原平台洽詢。"
  },
  booking: {
    hotelOrWebsite: "修改或取消請聯繫櫃檯。", platforms: "Agoda、Booking.com、Trip.com 等平台訂房，原則上向原平台申請。",
    dateChange: "建議入住前三天前提出；入住前三天內才告知，依取消規定處理。",
    cancellationPolicy: "除上述修改管道與三天規則外，未提供具體取消／退款條件，須由原訂房管道或真人櫃檯確認。",
    livePriceAndAvailability: "房價採機動價格；即時房價、空房與優惠須由當日官網、訂房系統或櫃檯確認。"
  },
  governmentSubsidy2026: {
    publicName: "2026 平日住宿加碼補助",
    period: {
      startsOn: "2026-09-01",
      endsOn: "2026-11-30",
      earlyEndRule: "政府活動經費用罄時可能提前結束。"
    },
    applicableStayDays: "限週日至週四入住；週五、週六及國定連續假日不適用。",
    participationLimit: {
      perPerson: 1,
      scope: "每位旅客於本活動期間限參與一次。",
      consecutiveStayClarification: "同一次連續住宿仍可依規定使用第一晚及連續第二晚補助。"
    },
    bookingChannels: {
      eligible: ["飯店官網", "電話", "LINE", "現場訂房"],
      ineligible: ["Agoda", "Booking.com", "其他 OTA／第三方訂房平台"],
      rule: "限直接向飯店訂房；OTA／第三方訂房平台訂單不可使用。"
    },
    weekdayStayAward: {
      firstNight: "NT$800",
      consecutiveSecondNight: "NT$1,200",
      maximumForTwoNightStay: "NT$2,000",
      thirdNight: null
    },
    birthdayVoucher: {
      amountPerRoom: "NT$1,200",
      birthdayRelated: false,
      acquisitionRule: "名稱雖為壽星生日券，但與旅客生日無關；必須參加活動抽獎並中獎後才能取得。"
    },
    taiwanPass: { amountPerRoomPerNight: "NT$1,500" },
    stacking: {
      allThreeTogetherAllowed: true,
      combinations: ["平日住宿獎助", "壽星生日券", "Taiwan PASS 住宿券"],
      maximumDiscountRule: "三項可同時疊加，但每房每晚的總折抵最高不得超過當天實際全額房價。",
      excessValueRule: "超過房價的部分不能退現、找現或保留。"
    },
    registration: {
      publicEntry: "尚未登錄的旅客可使用飯店提供的 QR Code 進入政府活動官方網站登錄。",
      privacyRule: "不得要求旅客在 LINE、Messenger、網站聊天或語音對話中傳送證件照片、身分證字號或健保卡資料。"
    },
    qualificationRule: "補助資格、可用額度及活動是否仍有經費，必須以政府活動系統查詢結果為準；不得保證一定可使用。",
    authorityRule: "活動辦法與解釋權以政府最新公告為準。",
    guestKnowledgeBoundary: "只回答旅客公開規則；不得揭露或描述櫃檯發票、核銷、拍照、後台登錄、請款或交接流程。"
  },
  extendedStay: {
    monthlyRate: "目前沒有提供包月房價方案，不可推算月租價格或承諾長住折扣。",
    corporateProgram: "有特約廠商優惠方案；特約資格、優惠內容、價格與適用方式請直接洽詢櫃檯確認。"
  },
  shortStay: "目前沒有提供休息或鐘點房服務，不可報價。",
  bedding: {
    mattress: "客房使用五星級高級床墊。",
    purchase: "如欲購買飯店使用的床墊、寢具或寢具備品，請直接洽詢櫃檯；未記載品牌、型號、尺寸與售價，不可猜測或報價。"
  },
  guestServices: {
    luggage: "入住前或退房後可寄放，須於 22:00 前領取。", coldStorage: "冷藏／冷凍物可暫放一樓大廳冰箱；客房小冰箱無法冷凍。",
    parcels: "限入住客人，須提前通知櫃檯並說明物品種類；不代收違禁品。", lostProperty: "保留 1 週；查找時提供入住日期、房號或訂房資訊及物品描述；寄回郵資貨到付款。",
    taxi: "櫃檯服務時段可協助叫車；至台中高鐵站約 20–30 分鐘，依交通狀況。客人在外需自行叫車。"
  },
  local: {
    conveniences: ["飯店對面有 24 小時家樂福", "7-ELEVEN 與全家便利商店在路口附近"],
    attractions: ["七期百貨商圈", "逢甲夜市", "台中國家歌劇院", "秋紅谷"],
    restaurants: "先詢問燒肉、火鍋、台式料理、咖啡／早午餐、夜市小吃等偏好；具體店家、距離、評價及營業狀況屬變動資訊，須查詢最新資訊後推薦，不可使用舊名單或編造。"
  },
  escalation: {
    always: ["客訴", "退款", "訂單爭議", "設備故障", "未明確記載的特殊需求", "高風險特殊要求"],
    unknownDuringDeskHours: "未明確記載的飯店資訊需要由櫃檯進一步確認，於 07:00–22:00 建議直接洽詢櫃檯。",
    equipment: "先表示願意協助，不自行判斷故障原因，再依服務時間轉由櫃檯或後勤客服處理。",
    equipmentDuringDeskHours: "07:00–22:00 遇到設備問題，先表示願意協助，不自行判斷故障原因，優先請旅客聯絡櫃檯。",
    equipmentAfterHours: "22:00–翌日 07:00 遇到冷氣、電視、熱水、門鎖、房內設備故障或其他設備問題，直接請旅客撥後勤客服 0927-708-908，洽陳先生。"
  },
  unknownInformationPolicy: {
    truthRule: "未記載、missing 或 null 的資訊不得猜測，也不得用一般飯店經驗補充。",
    guestReply: "不好意思，這個問題目前沒有確認到正確資料。",
    nextStep: "若旅客急著確認，可撥打櫃檯電話 04-2707-8378；也可回覆「幫我轉接櫃檯」，由系統進入留言轉接流程。",
    actionTruth: "未實際成功送達櫃檯前，不得聲稱已通知、已送出或已完成處理。"
  },
  missing: ["停車場客服電話", "家庭房是否有浴缸", "兒童早餐價格", "具體取消與退款條件", "床墊與寢具的品牌、型號、尺寸及售價", "2026 平日住宿加碼補助第三晚是否另有補助"],
  review: { contradictions: [], notes: ["家庭房浴缸欄原記載「依現場資料」，正式版列為尚未提供。", "餐廳、房價、房況、優惠及營業狀況是變動資料，不固化為事實。", "2026-08-21 補充停車位不提供預留、採先到先停，以及客房 Wi-Fi 連線資訊。", "2026-08-23 補充政府平日住宿補助旅客公開規則；櫃檯內部核銷 SOP 排除於旅客知識。", "2026-08-29 依飯店營運方說明與示意圖補正：門口為 3 個路邊停車格；停滿時由櫃檯引導至步行約 3 分鐘、位於青海路全國電子逢甲店隔壁的配合停車場；停妥後須提供車號，由櫃檯輸入系統後即可自由進出。舊有智惠街 135 號資料已移除。"] }
};

export function knowledgeForPrompt() {
  return JSON.stringify(hotelKnowledge, null, 2);
}
