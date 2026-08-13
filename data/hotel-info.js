// 唯一內容來源：〈希堤微旅 AI 櫃檯知識庫 V2.0〉完整合併正式版（2026-08-13）。
// 未出現在原始文件中的資訊必須維持 null，不得以 placeholder 或常識補值。
export const hotelKnowledge = {
  source: { title: "希堤微旅 AI 櫃檯知識庫 V2.0 完整合併正式版", date: "2026-08-13" },
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
    hours: "08:00–10:00", location: "二樓餐廳", includedProcedure: "持餐券直接至二樓用餐。",
    addOn: "未含早餐可加購，NT$150／客。", menu: "目前提供四種不同餐點，品項可能調整，以當日櫃檯／餐廳選項為準。",
    ordering: "建議前一天向櫃檯選餐；10:00 前完成點餐即可，用餐時間不另設限。",
    takeaway: true, vegetarian: "可提前告知，餐廳依需求調整。"
  },
  parking: {
    hotelSpaces: 3,
    alternatives: ["配合的全國電子停車場", "智慧街家樂福後門之智慧街停車場"],
    rules: ["停妥後務必告知櫃檯車牌號碼，由櫃檯輸入辦理折抵。", "每房配合 1 個車位；第二台車加收 NT$200。", "無法進出時聯絡停車場客服，告知為希堤微旅住客。"],
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
    loans: "可向櫃檯借充電器、轉接頭；雨傘數量有限，借完為止。", wifi: null
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
  missing: ["配合停車場完整地址", "停車場客服電話", "家庭房是否有浴缸", "Wi-Fi／網路連線資訊", "具體取消與退款條件", "床墊與寢具的品牌、型號、尺寸及售價"],
  review: { contradictions: [], notes: ["家庭房浴缸欄原記載「依現場資料」，正式版列為尚未提供。", "餐廳、房價、房況、優惠及營業狀況是變動資料，不固化為事實。"] }
};

export function knowledgeForPrompt() {
  return JSON.stringify(hotelKnowledge, null, 2);
}
