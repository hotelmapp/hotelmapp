const $ = id => document.getElementById(id);
const messages = {
  front_desk_disabled: "工作台尚未啟用，請由管理員完成設定。",
  front_desk_not_configured: "管理員登入或資料加密尚未設定完成，工作台維持鎖定。",
  front_desk_unavailable: "目前無法確認工作台狀態，請稍後重新整理；不會自動恢復 AI。",
  login_required: "登入已到期，請由管理員重新登入。已接手的對話仍暫停 AI。",
  login_failed: "管理員密碼不正確。",
  login_rate_limited: "登入嘗試過於頻繁，請稍後再試。",
  origin_rejected: "這個網址尚未獲准使用工作台，請由管理員確認設定。",
  conversation_busy: "還有一則訊息正在處理，請稍後重新整理。",
  stale_state: "對話狀態已更新，請重新確認後再操作。",
  new_messages_arrived: "有新訊息或其他操作，請先閱讀最新對話再結案。",
  reply_window_expired: "目前已超過平台允許的回覆時限，或缺少對話路由；請先在原平台確認。",
  summary_required: "請簡述處理結果，讓 AI 接續時有正確背景。",
  conversation_not_found: "找不到這段對話，請重新整理。",
  request_id_reused: "這次送出識別碼已用於其他內容，請先確認原平台的寄送結果。"
};
const state = { authenticated: false, selected: null, detail: null, busy: false, refreshing: false, drafts: new Map(), generation: 0 };
function status(text, error = false) { $("status").textContent = text; $("status").classList.toggle("error", error); }
function draft(id = state.selected) {
  if (!state.drafts.has(id)) state.drafts.set(id, { text: "", summary: "", requestId: null, attempted: false, matched: false, review: null });
  return state.drafts.get(id);
}
function reviewKey(detail) {
  return JSON.stringify([detail.id, detail.revision, detail.control.epoch, detail.control.inboundVersion || 0]);
}
function canClose(detail = state.detail) {
  return Boolean(detail && detail.id === state.selected && detail.control.mode === "human"
    && draft().summary.trim() && draft().review === reviewKey(detail));
}
function loggedIn(value) {
  state.authenticated = value;
  $("loginPanel").hidden = value; $("workspace").hidden = !value; $("logout").hidden = !value;
  if (!value) {
    state.generation++; state.selected = null; state.detail = null; state.drafts.clear();
    $("inbox").replaceChildren(); $("transcript").replaceChildren(); $("reply").value = ""; $("summary").value = "";
    $("detail").hidden = true; $("empty").hidden = false;
  }
}
async function api(action, body = {}) {
  let response;
  try {
    response = await fetch("/api/front-desk", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }), signal: AbortSignal.timeout(25_000)
    });
  } catch { throw new Error(action === "reply"
    ? "連線中斷，送出結果可能尚未確認。請勿重複建立相同訊息；先到原平台核對。"
    : "連線中斷，尚無法確認操作結果。請重新整理，確認 AI 是否已暫停或恢復。"); }
  const data = await response.json();
  if (!response.ok) {
    if (data.error === "login_required") loggedIn(false);
    throw new Error(messages[data.error] || "操作未完成，請重新整理後確認。");
  }
  return data;
}
function modeText(control) {
  return { ai: "AI 自動回覆", pausing: "接手中：等候既有處理結束", human: "真人接手中・AI 已暫停" }[control.mode] || "狀態待確認";
}
function renderDetail(detail) {
  state.detail = detail; $("detail").hidden = false; $("empty").hidden = true;
  $("title").textContent = (detail.channel === "line" ? "LINE" : "Messenger") + " 對話 " + detail.id.slice(-6);
  $("mode").textContent = modeText(detail.control);
  const human = detail.control.mode === "human";
  const native = detail.channel === "line";
  const current = draft();
  if (current.review !== reviewKey(detail) || !human) current.review = null;
  $("nativeReply").hidden = !native;
  $("replyForm").hidden = native;
  $("guestMatched").checked = current.matched;
  $("guestMatched").disabled = state.busy || detail.control.mode !== "ai";
  $("takeover").disabled = state.busy || detail.control.mode !== "ai" || (native && !current.matched);
  $("copyGreeting").disabled = state.busy || !human;
  $("send").disabled = native || state.busy || (!current.attempted && (!human || !detail.routeAvailable || !detail.replyWindowOpen));
  $("resolved").checked = Boolean(current.review);
  $("resolved").disabled = state.busy || !human;
  $("close").disabled = state.busy || !canClose(detail);
  $("reply").disabled = native || state.busy || !human || current.attempted;
  $("summary").disabled = state.busy || !human;
  const uncertain = ["uncertain", "pending"].includes(detail.control.lastSend?.status);
  $("notice").textContent = uncertain
    ? "前一則人工訊息的送出結果尚未確認，請先到原平台核對；不要重複寄送。"
    : detail.control.mode === "pausing" ? "請等狀態變成「真人接手中」再回覆。尚未送出的 AI 回覆會被攔下；已送往平台的訊息無法撤回。"
    : native ? human
      ? "這位客人的 AI 已暫停。請到 LINE 回覆，先貼上人工接手說明；處理完回此頁留下摘要並恢復 AI。"
        + (detail.reminder ? " 已接手超過 30 分鐘，請確認是否仍需處理。" : "")
      : "這位客人目前由 AI 回覆。先核對客人，再按「人工接手，暫停 AI」；直接在 LINE 打字不會觸發暫停。"
    : !detail.routeAvailable ? "近期資料已過期，請到原平台確認；是否暫停 AI 請以此頁狀態為準。"
    : !detail.replyWindowOpen ? "已超過平台回覆時限；此入口不會繞過平台限制。"
    : detail.reminder ? "這段對話已接手超過 30 分鐘；若已完成，請記得結案。系統不會自行恢復 AI。"
    : "人工訊息會自動標示身分。請從此工作台回覆；原 LINE／Meta 後台直接發出的文字不會同步到這裡。";
  const fragment = document.createDocumentFragment();
  for (const turn of detail.turns) {
    const card = document.createElement("div");
    card.className = "turn " + (turn.source ? "staff" : turn.role);
    const label = document.createElement("small");
    label.textContent = (turn.source === "staff_note" ? "櫃檯交接摘要・內部" : turn.source === "staff" ? "真人櫃檯" : turn.role === "user" ? "旅客" : "AI") + "　" + new Date(turn.at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
    card.append(label, document.createTextNode(turn.content)); fragment.append(card);
  }
  $("transcript").replaceChildren(fragment);
  $("reply").value = draft().text; $("summary").value = draft().summary;
  $("newReply").hidden = !draft().attempted; $("newReply").disabled = state.busy;
  $("send").textContent = draft().attempted ? "查詢上次送出結果（不重寄）" : "以真人櫃檯身分送出";
}
async function refresh() {
  if (!state.authenticated || state.refreshing || state.busy) return;
  state.refreshing = true;
  const generation = state.generation;
  try {
    const result = await api("inbox");
    if (!state.authenticated || generation !== state.generation) return;
    const fragment = document.createDocumentFragment();
    for (const item of result.conversations) {
      const button = document.createElement("button"); button.className = "thread" + (item.id === state.selected ? " selected" : "");
      const title = document.createElement("strong"); title.textContent = item.channel.toUpperCase() + " · " + item.id.slice(-6);
      const mode = document.createElement("small"); mode.textContent = modeText(item.control) + (item.reminder ? "・待結案提醒" : "");
      const preview = document.createElement("p"); preview.textContent = item.preview;
      button.append(title, mode, preview);
      button.addEventListener("click", async () => {
        if (state.busy) return;
        state.selected = item.id; const selected = item.id, selectionGeneration = ++state.generation;
        draft(selected).matched = false; draft(selected).review = null;
        // Never leave guest A's form visible while guest B is loading.
        state.detail = null; $("detail").hidden = true; $("empty").hidden = false;
        status("正在讀取這位旅客的對話…");
        try { const detail = await api("detail", { id: selected }); if (state.selected === selected && state.authenticated && selectionGeneration === state.generation && !state.busy) renderDetail(detail); } catch (error) { if (selectionGeneration === state.generation) status(error.message, true); }
      });
      fragment.append(button);
    }
    if (!result.conversations.length) fragment.append(document.createTextNode("目前沒有對話。啟用後，旅客新傳入的文字會顯示在這裡。"));
    $("inbox").replaceChildren(fragment);
    const selected = state.selected;
    if (selected) { const detail = await api("detail", { id: selected }); if (state.selected === selected && state.authenticated && generation === state.generation) renderDetail(detail); }
  } catch (error) { if (generation === state.generation) status(error.message, true); }
  finally {
    state.refreshing = false;
    if (state.authenticated && generation !== state.generation && !state.busy) await refresh();
  }
}
async function perform(fn) {
  if (state.busy) return;
  // A read started before an action must never restore the old control state.
  state.generation++;
  state.busy = true; if (state.detail) renderDetail(state.detail);
  try { await fn(); } catch (error) {
    status(error.message, true);
    state.detail = null; $("detail").hidden = true; $("empty").hidden = false;
  }
  finally { state.busy = false; if (state.detail && state.authenticated) renderDetail(state.detail); await refresh(); }
}
$("loginForm").addEventListener("submit", event => {
  event.preventDefault();
  perform(async () => { const password = $("password").value; $("password").value = ""; await api("login", { password }); loggedIn(true); status("已登入櫃檯共用工作台。"); });
});
$("logout").addEventListener("click", () => perform(async () => {
  await api("logout"); loggedIn(false); status("工作台已鎖定。已接手的對話仍暫停 AI，重新登入後可繼續處理。");
}));
$("refresh").addEventListener("click", refresh);
$("reply").addEventListener("input", () => { draft().text = $("reply").value; });
$("summary").addEventListener("input", () => {
  draft().summary = $("summary").value; draft().review = null;
  $("resolved").checked = false; $("close").disabled = true;
});
$("guestMatched").addEventListener("change", () => {
  draft().matched = $("guestMatched").checked; if (state.detail) renderDetail(state.detail);
});
$("resolved").addEventListener("change", () => {
  draft().review = $("resolved").checked && state.detail?.control.mode === "human" ? reviewKey(state.detail) : null;
  $("close").disabled = state.busy || !canClose();
});
$("copyGreeting").addEventListener("click", async () => {
  if (state.busy || !state.authenticated || state.detail?.channel !== "line" || state.detail?.control.mode !== "human") return;
  try { await navigator.clipboard.writeText($("nativeGreeting").value); status("已複製接手說明，請貼到 LINE 的同一位客人聊天室送出。這個按鈕不會自動發訊息。"); }
  catch { $("nativeGreeting").focus(); $("nativeGreeting").select(); status("請複製已選取的接手說明，再貼到 LINE 送出。"); }
});
$("takeover").addEventListener("click", () => perform(async () => {
  if (!state.detail || state.detail.id !== state.selected || state.detail.control.mode !== "ai") return;
  if (state.detail.channel === "line" && !draft().matched) { status("請先在 LINE 核對這位客人及對話，再勾選核對欄位。", true); return; }
  const result = await api("takeover", { id: state.selected }); state.detail.control = result.control;
  status("已提出人工接手。請確認狀態顯示「真人接手中」後再回覆。");
}));
$("replyForm").addEventListener("submit", event => {
  event.preventDefault();
  perform(async () => {
    if (!state.detail || state.detail.id !== state.selected || state.detail.channel === "line") return;
    const current = draft();
    let result;
    if (current.attempted) {
      result = await api("reply_status", { id: state.selected, requestId: current.requestId });
    } else {
      current.requestId = crypto.randomUUID(); current.attempted = true;
      result = await api("reply", { id: state.selected, text: current.text, requestId: current.requestId, epoch: state.detail.control.epoch });
    }
    if (result.status === "accepted") {
      current.text = ""; current.requestId = null; current.attempted = false;
      status("訊息已送交平台；不代表客人已讀。AI 仍暫停，處理完成後請結案。");
    } else status("尚無法確認送出結果，請先到原平台核對。系統不會自動重寄。", true);
  });
});
$("newReply").addEventListener("click", () => {
  if (!confirm("請先在 LINE／Messenger 確認上次是否已送出。確定要清除這份草稿，建立另一則新回覆嗎？")) return;
  Object.assign(draft(), { text: "", requestId: null, attempted: false }); renderDetail(state.detail);
});
$("close").addEventListener("click", () => {
  if (!draft().summary.trim()) { status(messages.summary_required, true); $("summary").focus(); return; }
  if (!canClose()) { status("請先核對原平台及此頁最新訊息，勾選已確認處理完成。", true); return; }
  if (!confirm("確認已處理完成並看過最新訊息？結案後，客人的下一則提問將由 AI 回覆。")) return;
  const detail = state.detail, summary = draft().summary;
  perform(async () => {
    await api("close", { id: detail.id, epoch: detail.control.epoch, revision: detail.revision, inboundVersion: detail.control.inboundVersion || 0, summary });
    draft(detail.id).summary = ""; draft(detail.id).review = null;
    state.detail = null; $("detail").hidden = true; $("empty").hidden = false;
    status("已結案並恢復 AI。交接摘要僅供內部使用，不會另發結案訊息給旅客。");
  });
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
setInterval(() => { if (!document.hidden) refresh(); }, 30_000);
try { await api("session"); loggedIn(true); status("已登入櫃檯共用工作台。"); await refresh(); }
catch (error) { loggedIn(false); status(error.message, true); }
