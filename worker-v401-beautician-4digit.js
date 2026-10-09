// v417: 隔天班表輸入後第一行固定顯示隔天日期（例如 10/10週六）
// v416: Roman Data 畫面版本號改為 v416（之後每次改版一起更新）
// v415: 班表時間判讀（170-gordon＝17 點、客人 0-gordon）、Roman Data 同步日誌可收合
// v414: W-08 錯誤訊息不外洩、頁面加 CSP（N-04）
// v413-serve-page: Roman Data 畫面改由這個 Worker 自己提供（public/，Cloudflare 靜態資源），打開要輸入 OS 員工密碼；GitHub 版停用
// v412-secure: 資安修補 W-01～W-03
//   - /api/schedule、/api/roman 的公開讀寫關閉：沒有 SYNC_SECRET 一律拒絕（GitHub 版改走 Roman OS，要輸入 OS 員工密碼）
//   - 首頁直接導到 GitHub 版
//   - LINE 機器人只收允許名單（Roman OS 後台 →「LINE 機器人」）裡的人或群組傳的班表，而且內容要像班表
//   - CORS 只允許完整網址相同的來源
// v411: 存檔後通知 Roman OS 檢查班表更新通知
// v410: 同一筆存檔的版本號與內容同時寫入
// v409: 班表日期由分頁決定（今天 / 明天），第一行日期不符就不寫入預約
// v408-next-day: 支援隔天班表（site=太原_隔天）
// v407-safe-save: 存檔帶版本號、補線上預約、撞時段提醒（與 Roman OS 共用 board 規則）
// roman worker v402 - 融合預約回覆版・based on new html upload - lower case
// v403-shared-d1: 與 Roman OS (roman-os.pages.dev /api/roman) 共用同一個 D1 (8719bcb8)
//   寫入時同時更新 roman_data（Roman OS 的正本，id=太原），讀取時取兩張表較新的那份
// ===== board-shared:start（從 roman-os functions/_lib/board.js 複製，規則與 Roman OS 一致；要改請改那邊再複製過來）=====
// 羅曼資料區「預約總覽」班表文字 ⇄ 預約系統
//
// 班表文字格式（跟羅曼資料區一樣）：
//   小美12-20太原702        ← 每段第一行：美容師 + 上下班 + 地點
//   12
//   13王小姐               ← 時間 + 客人（1230、13:30、24、01 都可以）
//   14不排
//   ---                    ← 段落分隔
//
// 班表日期：第一段裡有「10/2」這種日期就用它，否則用台灣今天（06:00 前算前一天）
//
// 預約系統寫進班表的客人會加上標記，取消時才知道要拿掉哪些：
//   王小姐(LINE)   客人自己用 LINE 預約
//   王小姐(預約)   員工在預約管理新增
// 這個檔案不依賴其他檔案：roman-schedule Worker 會整段複製過去用（兩邊規則一致）
const TW_MS = 8 * 3600000;
function toBiz(h, m = 0) { return ((Number(h) - 10 + 24) % 24) * 60 + Number(m || 0); }
function todayTW(offsetDays = 0) { return new Date(Date.now() + TW_MS + offsetDays * 86400000).toISOString().slice(0, 10); }
function bizClock(b) { const t = (b + 600) % 1440; return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"); }

const TAGS = { line: "(LINE)", os: "(預約)" };
const TAG_RE = /\((LINE|預約)\)$/;
const TIME_RE = /^(\d{3,4}|\d{1,2}(?:[:：]\d{1,2})?)\s*(.*)$/;
// 時間行拆成「時間」與「客人」：先試 4 碼（1730）、再試 3 碼（930），分鐘要小於 60 才算；
// 不合理（170 → 1:70）就只取前兩碼當整點，剩下算客人：「170-gordon」＝ 17 點、客人「0-gordon」（跟羅曼資料區畫面一致）
function slotSplit(t) {
  t = String(t || "");
  const c = t.match(/^(\d{1,2}[:：]\d{0,2})\s*([\s\S]*)$/);
  if (c) return [t, c[1], c[2]];
  const m = t.match(/^(\d+)/);
  if (!m) return null;
  const D = m[1];
  const ok = (s) => { const n = s.length, h = n === 4 ? +s.slice(0, 2) : n === 3 ? +s[0] : +s, mi = n >= 3 ? +s.slice(-2) : 0; return h <= 24 && mi <= 59; };
  let tok = null;
  for (const n of [4, 3, 2]) if (D.length >= n && ok(D.slice(0, n))) { tok = D.slice(0, n); break; }
  if (!tok && D.length === 1) tok = D;
  return tok ? [t, tok, t.slice(tok.length).replace(/^\s+/, "")] : null;
}

// 跟羅曼資料區一樣的時間解析
function parseTok(e) {
  e = String(e || "").trim();
  if (!e) return null;
  if (e.includes(":") || e.includes("：")) {
    const [a, b] = e.split(/[:：]/);
    const h = parseInt(a, 10), m = parseInt(b || "0", 10);
    return isNaN(h) ? null : { h, m: isNaN(m) ? 0 : m };
  }
  if (/^\d{3}$/.test(e)) return { h: +e[0], m: +e.slice(1) };
  if (/^\d{4}$/.test(e)) return { h: +e.slice(0, 2), m: +e.slice(2) };
  if (/^\d{1,2}$/.test(e)) return { h: +e, m: 0 };
  return null;
}
function headerName(u) {
  const own = u.match(/^(.+?)預約$/);   // 預約系統自己補上的段落（美容師沒有班表時）：「小美預約」
  if (own && !/\d/.test(own[1])) return own[1].trim();
  let c = u.match(/^(.+?)(\d{3,4}|\d{1,2}(?:[:：]\d{1,2})?)\s*[-—~至]+\s*(\d{3,4}|\d{1,2}(?:[:：]\d{1,2})?)(.*)$/);
  if (c) return c[1].trim();
  c = u.match(/^(.+?)(\d{3,4})(.*)$/);
  if (c) return c[1].trim();
  c = u.match(/^(.+?)(\d{1,2})(?:[:：]?\d{0,2})?[-—](\d{1,2})(.+)?$/);
  if (c) return c[1].trim();
  return "";
}
const isSep = (line) => /-{3,}/.test(line);
// 段落標題的上下班時間：「小美12-22太原702」→ { start:"12:00", end:"22:00" }
function headerShift(u) {
  const c = String(u || "").match(/^(.+?)(\d{3,4}|\d{1,2}(?:[:：]\d{1,2})?)\s*[-—~至]+\s*(\d{3,4}|\d{1,2}(?:[:：]\d{1,2})?)/);
  if (!c) return null;
  const a = parseTok(c[2]), b = parseTok(c[3]);
  if (!a || !b) return null;
  const f = (t) => String(t.h % 24).padStart(2, "0") + ":" + String(t.m).padStart(2, "0");
  return { start: f(a), end: f(b) };
}

// 拆成段落：每段記錄美容師名字、標題行、每一個時間行
function parseBoard(raw) {
  const lines = String(raw || "").split("\n");
  const blocks = [];
  let cur = null;
  lines.forEach((text, i) => {
    const t = text.trim();
    if (isSep(t)) { cur = null; return; }
    if (!t) return;
    if (!cur) {
      cur = { header: i, name: t.includes("不排") && !headerName(t) ? "" : headerName(t), offAll: t.includes("不排"), last: i, slots: [] };
      blocks.push(cur);
      return;
    }
    cur.last = i;
    const m = slotSplit(t);
    const tm = m && parseTok(m[1]);
    if (!tm) return;
    const customer = (m[2] || "").trim();
    cur.slots.push({ line: i, tok: m[1], h: tm.h % 24, m: tm.m, biz: toBiz(tm.h % 24, tm.m), customer, off: t.includes("不排") });
  });
  return { lines, blocks };
}

// 班表第一行寫的日期（沒寫 → null）
function headerDate(raw, now = Date.now()) {
  const first = String(raw || "").split(/-{3,}/)[0] || "";
  const tw = new Date(now + 8 * 3600000);
  const mt = first.match(/(\d{1,2})[/／.](\d{1,2})/);
  if (!mt) return null;
  const mo = +mt[1], d = +mt[2];
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  let best = null;
  for (const y of [tw.getUTCFullYear() - 1, tw.getUTCFullYear(), tw.getUTCFullYear() + 1]) {
    const c = Date.UTC(y, mo - 1, d);
    if (best === null || Math.abs(c - tw) < Math.abs(best - tw)) best = c;
  }
  return new Date(best).toISOString().slice(0, 10);
}
// 營業日（凌晨 6 點前算前一天）＋ offset 天
function bizDay(offset = 0, now = Date.now()) {
  const tw = new Date(now + 8 * 3600000);
  return new Date(now + 8 * 3600000 + ((tw.getUTCHours() < 6 ? -1 : 0) + offset) * 86400000).toISOString().slice(0, 10);
}

// 每位美容師的段落：名字、整段不排、上下班、每個時間行（客人可約＝時間行後面沒寫客人、也不是不排）
function boardBlocks(raw) {
  const { lines, blocks } = parseBoard(raw);
  return blocks.filter((b) => b.name).map((b) => ({ name: b.name, offAll: b.offAll, shift: headerShift(lines[b.header].trim()), slots: b.slots }));
}

// 班表是哪一天（營業日）：舊的判斷法（第一行有日期就用它）
function boardDate(raw, now = Date.now(), offset = 0) {
  const first = String(raw || "").split(/-{3,}/)[0] || "";
  const tw = new Date(now + 8 * 3600000);
  const mt = first.match(/(\d{1,2})[/／.](\d{1,2})/);
  if (mt) {
    const mo = +mt[1], d = +mt[2];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      let best = null;
      for (const y of [tw.getUTCFullYear() - 1, tw.getUTCFullYear(), tw.getUTCFullYear() + 1]) {
        const c = Date.UTC(y, mo - 1, d);
        if (best === null || Math.abs(c - tw) < Math.abs(best - tw)) best = c;
      }
      return new Date(best).toISOString().slice(0, 10);
    }
  }
  return todayTW((tw.getUTCHours() < 6 ? -1 : 0) + offset);
}

// 班表上已經有客人（或不排）的時段 → { 美容師: [營業日分鐘…] }，預約系統寫進去的不算（那些本來就在預約裡）
function boardBusy(raw) {
  const out = {};
  for (const b of parseBoard(raw).blocks) {
    if (!b.name) continue;
    for (const s of b.slots) {
      if (!s.customer && !s.off) continue;
      if (TAG_RE.test(s.customer)) continue;
      (out[b.name] ||= []).push(s.biz);
    }
  }
  return out;
}

function tokFor(h, m) {
  const hh = h === 0 ? "24" : String(h).padStart(2, "0");
  return m ? hh + String(m).padStart(2, "0") : hh;
}
function clockTok(h, m) { return (h < 10 ? String(h).padStart(2, "0") : String(h)) + (m ? ":" + String(m).padStart(2, "0") : ""); }

// 把預約寫進班表、把已取消的拿掉。bookings: [{beautician, hour, minute, name, source}]，duty: {名字: {sh,sm,eh,em}}
// 回傳新的文字（沒變就回傳原文）
function mergeBoard(raw, bookings, duty = {}) {
  const { lines, blocks } = parseBoard(raw);
  const want = new Map();   // "美容師|分鐘" → [客人文字…]
  for (const b of bookings) {
    const k = b.beautician + "|" + toBiz(b.hour, b.minute);
    (want.get(k) || want.set(k, []).get(k)).push(b.name + (b.source === "line" ? TAGS.line : TAGS.os));
  }
  const edits = new Map();   // 行號 → 新內容
  const inserts = [];        // { after: 行號, text }
  const appendBlocks = [];

  // 1) 拿掉已經不存在的預約（只動有標記的）
  const present = new Set();
  for (const b of blocks) {
    for (const s of b.slots) {
      if (!TAG_RE.test(s.customer)) continue;
      const list = want.get(b.name + "|" + s.biz) || [];
      if (list.includes(s.customer) && !present.has(b.name + "|" + s.biz + "|" + s.customer)) {
        present.add(b.name + "|" + s.biz + "|" + s.customer);
      } else {
        edits.set(s.line, s.tok);   // 只留時間
      }
    }
  }
  // 2) 補上還沒寫進去的預約
  for (const [k, names] of want) {
    const [name, bizS] = k.split("|"), biz = +bizS;
    for (const cust of names) {
      if (present.has(k + "|" + cust)) continue;
      const plain = cust.replace(TAG_RE, "");
      if (blocks.some((b) => b.name === name && b.slots.some((s) => s.biz === biz && s.customer === plain))) continue;
      const blk = blocks.find((b) => b.name === name && !b.offAll) || blocks.find((b) => b.name === name);
      const h = Math.floor(((biz + 600) % 1440) / 60), m = (biz + 600) % 60;
      if (!blk) {
        let nb = appendBlocks.find((x) => x.name === name);
        if (!nb) {
          const d = duty[name];
          const head = d ? `${name}${clockTok(d.sh, d.sm)}-${clockTok(d.eh, d.em)}` : name + "預約";
          nb = { name, head, rows: [] };
          appendBlocks.push(nb);
        }
        nb.rows.push({ biz, text: tokFor(h, m) + cust });
        continue;
      }
      // 空的同時段 → 直接填；有別的客人 → 另起一行（讓員工看到撞時段）
      const empty = blk.slots.find((s) => s.biz === biz && !s.customer && !s.off && !edits.has(s.line + ":filled"));
      if (empty) {
        edits.set(empty.line, empty.tok + cust);
        edits.set(empty.line + ":filled", true);
        continue;
      }
      const freed = blk.slots.find((s) => s.biz === biz && edits.get(s.line) === s.tok && !edits.has(s.line + ":filled"));
      if (freed) { edits.set(freed.line, freed.tok + cust); edits.set(freed.line + ":filled", true); continue; }
      const before = blk.slots.filter((s) => s.biz <= biz);
      const after = before.length ? before[before.length - 1].line : blk.header;
      inserts.push({ after, biz, text: tokFor(h, m) + cust });
    }
  }
  if (!edits.size && !inserts.length && !appendBlocks.length) return raw;

  const out = [];
  lines.forEach((text, i) => {
    out.push(edits.has(i) ? edits.get(i) : text);
    inserts.filter((x) => x.after === i).sort((a, b) => a.biz - b.biz).forEach((x) => out.push(x.text));
  });
  let res = out.join("\n");
  for (const nb of appendBlocks) {
    const body = nb.rows.sort((a, b) => a.biz - b.biz).map((r) => r.text).join("\n");
    res = res.replace(/\s+$/, "") + (res.trim() ? "\n---\n" : "") + nb.head + "\n" + body;
  }
  return res;
}

// 撞時段：同一位美容師、同一時間，同時有「預約系統的客人」和「員工手寫的客人 / 不排」
// 回傳 [{ beautician, time, booking:[…], staff:[…] }]
function findConflicts(raw) {
  const out = [];
  for (const b of parseBoard(raw).blocks) {
    if (!b.name) continue;
    const at = new Map();
    for (const s of b.slots) {
      if (!s.customer && !s.off) continue;
      (at.get(s.biz) || at.set(s.biz, []).get(s.biz)).push(s);
    }
    for (const [biz, list] of at) {
      const booked = list.filter((s) => TAG_RE.test(s.customer));
      const other = list.filter((s) => !TAG_RE.test(s.customer));
      if (booked.length && other.length) {
        out.push({ beautician: b.name, time: bizClock(biz), booking: booked.map((s) => s.customer), staff: other.map((s) => s.customer || "不排") });
      }
    }
  }
  return out;
}

// ---------- 讀寫 D1 裡的班表（Roman OS /api/roman、roman-schedule Worker 共用同一份） ----------
// 正本：roman_data（id = 太原）。roman_schedule 只是歷史紀錄。
// 版本號：roman_board_ver.ver 只在「人」存檔時 +1（員工、LINE 機器人）；預約系統補預約不算，
//         所以員工存檔時帶著自己載入的版本號，伺服器就能分辨「別人改過內容」還是「只是多了預約」。
const BOARD_SITE = "太原";
// 隔天預約總覽：另一份班表（羅曼資料區中間的分頁），沒寫日期時當作明天；客人預約明天的時段寫進這份
const NEXT_SITE = "太原_隔天";
const BOARD_SITES = [BOARD_SITE, NEXT_SITE];
const siteOffset = (site) => (site === NEXT_SITE ? 1 : 0);
// 每份班表是哪一天，由分頁決定：預約總覽＝今天、隔天預約總覽＝明天（營業日）
// 第一行寫的日期跟這天不一樣 → 視為「日期不符」：不寫入預約、不擋客人預約，畫面提醒員工換成正確的班表
function boardInfo(raw, site = BOARD_SITE, now = Date.now()) {
  const day = bizDay(siteOffset(site), now), header = headerDate(raw, now);
  return { day, header, mismatch: !!(header && header !== day) };
}
const TS = "strftime('%Y-%m-%d %H:%M:%f','now')";   // 記到毫秒，避免同一秒內兩次寫入分不出先後
async function ensureBoardTables(DB) {
  await DB.batch([
    DB.prepare("CREATE TABLE IF NOT EXISTS roman_data (id TEXT PRIMARY KEY, raw TEXT, site TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)"),
    DB.prepare("CREATE TABLE IF NOT EXISTS roman_schedule (id TEXT PRIMARY KEY, raw_text TEXT, parsed TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_by TEXT, source TEXT)"),
    DB.prepare("CREATE TABLE IF NOT EXISTS roman_board_ver (id TEXT PRIMARY KEY, ver INTEGER NOT NULL DEFAULT 0, updated_at TEXT, by TEXT)"),
  ]);
}
const newer = (a, b) => (!a ? b : !b ? a : String(b.updated_at || "") > String(a.updated_at || "") ? b : a);
// 舊的讀法：兩張表取較新（正本不存在時才用得到）
async function readBoard(DB, site = BOARD_SITE) {
  let fromOS = await DB.prepare("SELECT id, site, raw, updated_at FROM roman_data WHERE id = ?1 OR site = ?1 ORDER BY updated_at DESC LIMIT 1").bind(site).first();
  if (!fromOS) fromOS = await DB.prepare("SELECT id, site, raw, updated_at FROM roman_data ORDER BY updated_at DESC LIMIT 1").first();
  if (fromOS) fromOS.source = "roman_data";
  let fromWorker = null;
  try {
    const r = await DB.prepare("SELECT id, raw_text, updated_at, source FROM roman_schedule WHERE raw_text IS NOT NULL AND raw_text <> '' ORDER BY updated_at DESC LIMIT 1").first();
    if (r) fromWorker = { id: r.id, site, raw: r.raw_text, updated_at: r.updated_at, source: "roman_schedule:" + (r.source || "") };
  } catch (_) {}
  return newer(fromOS, fromWorker);
}
// 正本
async function readCanon(DB, site = BOARD_SITE) {
  const r = await DB.prepare("SELECT id, site, raw, updated_at FROM roman_data WHERE id = ?1").bind(site).first();
  if (r && r.raw) return { ...r, source: "roman_data" };
  return site === BOARD_SITE ? readBoard(DB, site) : null;
}
async function readVer(DB, site = BOARD_SITE) {
  try {
    const r = await DB.prepare("SELECT ver, updated_at, by FROM roman_board_ver WHERE id = ?1").bind(site).first();
    if (r) return { ver: Number(r.ver) || 0, at: r.updated_at || null, by: r.by ? String(r.by).split("#")[0] : null };
  } catch (_) {}
  return { ver: 0, at: null, by: null };
}
async function copyToHistory(DB, raw, by, source) {
  try {
    await DB.prepare(`INSERT INTO roman_schedule (id, raw_text, updated_at, updated_by, source) VALUES (?1, ?2, ${TS}, ?3, ?4)`)
      .bind("os_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6), raw, String(by).slice(0, 100), String(source).slice(0, 100)).run();
  } catch (_) {}
}
// 只有正本還是 oldRaw 時才寫入（中間有人存檔就不寫，交給呼叫的人重讀再試）
async function casWrite(DB, site, oldRaw, newRaw, by, source) {
  const ins = await DB.prepare(`INSERT INTO roman_data (id, raw, site, updated_at) SELECT ?1, ?2, ?1, ${TS} WHERE NOT EXISTS (SELECT 1 FROM roman_data WHERE id = ?1)`)
    .bind(site, newRaw).run();
  let ok = !!(ins.meta && ins.meta.changes);
  if (!ok) {
    const up = await DB.prepare(`UPDATE roman_data SET raw = ?1, updated_at = ${TS} WHERE id = ?2 AND raw = ?3`).bind(newRaw, site, oldRaw).run();
    ok = !!(up.meta && up.meta.changes);
  }
  if (ok) await copyToHistory(DB, newRaw, by, source);
  return ok;
}

// 班表那一天的預約（確認 / 完成），與值班時間
async function boardBookings(DB, date) {
  try {
    const [b, d] = await DB.batch([
      DB.prepare("SELECT beautician, hour, minute, customer_name AS name, source FROM bk_bookings WHERE date=? AND status IN ('confirmed','done')").bind(date),
      DB.prepare("SELECT beautician, start_hour sh, start_min sm, end_hour eh, end_min em FROM bk_duty WHERE date=?").bind(date),
    ]);
    const duty = {};
    for (const r of d.results || []) duty[r.beautician] = { sh: r.sh, sm: r.sm || 0, eh: r.eh, em: r.em || 0 };
    return { bookings: (b.results || []).map((x) => ({ ...x, minute: x.minute || 0 })), duty };
  } catch (_) {
    return { bookings: [], duty: {} };   // 預約系統的資料表還沒建立
  }
}
async function withBookings(DB, raw, site = BOARD_SITE) {
  try {
    if (!raw || raw.trim().length < 2) return raw;
    const info = boardInfo(raw, site);
    if (info.mismatch) return raw;   // 日期不符的班表不寫入預約
    const { bookings, duty } = await boardBookings(DB, info.day);
    return mergeBoard(raw, bookings, duty);
  } catch (e) {
    console.error("merge bookings failed", e);
    return raw;
  }
}

// 把預約寫進目前的班表（有變才寫；寫入時正本被別人改了就重讀再補，最多 4 次）
async function syncBoard(DB, site = BOARD_SITE) {
  await ensureBoardTables(DB);
  for (let i = 0; i < 4; i++) {
    const row = await readCanon(DB, site);
    if (!row || !row.raw || row.raw.trim().length < 2) return { raw: row?.raw || "", changed: false, row };
    const merged = await withBookings(DB, row.raw, site);
    if (merged === row.raw) return { raw: merged, changed: false, row };
    if (await casWrite(DB, site, row.raw, merged, "booking_sync", "booking_sync")) return { raw: merged, changed: true, row };
  }
  return { raw: null, changed: false };
}

// 讀班表給畫面用：順便補預約，附上版本號與撞時段
async function viewBoard(DB, site = BOARD_SITE) {
  await ensureBoardTables(DB);
  try { await syncBoard(DB, site); } catch (e) { console.error("board sync failed", e); }
  const row = await readCanon(DB, site);
  const v = await readVer(DB, site);
  const raw = row?.raw || "";
  return { row, raw, ver: v.ver, ver_at: v.at, ver_by: v.by, conflicts: raw ? findConflicts(raw) : [], ...boardInfo(raw, site) };
}

// 人存檔（員工、LINE 機器人）
// opt.base：存檔的人當初載入的版本號；跟現在不同 = 中間有別人存過 → 回傳 conflict（除非 opt.force）
// 沒帶 base（舊版畫面、LINE 機器人）→ 照舊直接存
async function saveBoard(DB, text, opt = {}) {
  const site = opt.site || BOARD_SITE, by = opt.by || "roman_os", source = opt.source || by;
  await ensureBoardTables(DB);
  await DB.prepare("INSERT OR IGNORE INTO roman_board_ver (id, ver) VALUES (?1, 0)").bind(site).run();
  const hasBase = opt.base !== undefined && opt.base !== null && opt.base !== "" && Number.isFinite(Number(opt.base));
  const check = hasBase && !opt.force;
  const conflict = async () => { const v = await viewBoard(DB, site); return { ok: false, conflict: true, ...v, row: undefined }; };
  if (check && Number(opt.base) !== (await readVer(DB, site)).ver) return conflict();
  const merged = await withBookings(DB, text, site);
  // 版本號 +1 和班表內容在同一個交易裡寫入：別人不會讀到「版本已更新、內容還是舊的」
  // 有帶 base 時，只有版本號還是 base 才寫（用這次存檔的記號確認是自己搶到的）
  const tag = by + "#" + Math.random().toString(36).slice(2, 10);
  await DB.prepare(`INSERT OR IGNORE INTO roman_data (id, raw, site, updated_at) VALUES (?1, '', ?1, ${TS})`).bind(site).run();
  const res = await DB.batch([
    check
      ? DB.prepare(`UPDATE roman_board_ver SET ver = ver + 1, updated_at = ${TS}, by = ?3 WHERE id = ?1 AND ver = ?2`).bind(site, Number(opt.base), tag)
      : DB.prepare(`UPDATE roman_board_ver SET ver = ver + 1, updated_at = ${TS}, by = ?2 WHERE id = ?1`).bind(site, tag),
    DB.prepare(`UPDATE roman_data SET raw = ?2, site = ?1, updated_at = ${TS} WHERE id = ?1 AND (SELECT by FROM roman_board_ver WHERE id = ?1) = ?3`).bind(site, merged, tag),
  ]);
  if (!(res[1].meta && res[1].meta.changes)) return conflict();   // 同一瞬間有人搶先存
  await copyToHistory(DB, merged, by, source);
  let raw = merged;
  try { const s = await syncBoard(DB, site); if (s.raw) raw = s.raw; } catch (_) {}   // 存檔這段時間剛好有新預約
  const v = await readVer(DB, site);
  return { ok: true, raw, ver: v.ver, ver_at: v.at, ver_by: v.by, conflicts: findConflicts(raw), ...boardInfo(raw, site) };
}

// 預約有變動時，今天、隔天兩份班表都補一次
async function syncAll(DB) {
  for (const site of BOARD_SITES) {
    try { await syncBoard(DB, site); } catch (e) { console.error("board sync failed", site, e); }
  }
}
// 某一天（營業日）的班表文字：今天、隔天兩份裡日期對得上的
async function boardsFor(DB, date) {
  const out = [];
  for (const site of BOARD_SITES) {
    try {
      const row = await readCanon(DB, site);
      if (!row || !row.raw) continue;
      const info = boardInfo(row.raw, site);
      if (!info.mismatch && info.day === date) out.push(row.raw);
    } catch (_) {}
  }
  return out;
}
// 某一天班表上已經有客人（或不排）的時段 → { 美容師: [營業日分鐘…] }
async function boardBusyFor(DB, date) {
  const out = {};
  for (const raw of await boardsFor(DB, date)) {
    for (const [n, list] of Object.entries(boardBusy(raw))) (out[n] ||= []).push(...list);
  }
  return out;
}
// ===== board-shared:end =====

// 班表存檔後請 Roman OS 檢查要不要發「班表更新通知」給會員（LINE）；在背景執行，不影響存檔
const NOTIFY_URL = 'https://roman-os.pages.dev/api/public/booking/board-updated';
function pingNotify(ctx){
  const job = fetch(NOTIFY_URL, {method:'POST'}).catch(()=>{});
  try{ if(ctx && ctx.waitUntil) ctx.waitUntil(job); }catch(e){}
}
let memoryStore = { raw_text: '', updated_at: '', updated_by: 'memory' };
const SHARED_SITE = '太原';
async function ensureSharedTables(db){
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS roman_data (id TEXT PRIMARY KEY, raw TEXT, site TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)'),
    db.prepare('CREATE TABLE IF NOT EXISTS roman_schedule (id TEXT PRIMARY KEY, raw_text TEXT, parsed TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_by TEXT, source TEXT)')
  ]);
}
async function insertSchedule(db, id, raw_text, updated_by, source){
  await ensureSharedTables(db);
  try{
    await db.prepare('INSERT INTO roman_schedule (id, raw_text, parsed, updated_at, updated_by, source) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?)').bind(id, raw_text, JSON.stringify([]), updated_by, source).run();
  }catch(e){
    if(e.message.includes('no column named parsed') || e.message.includes('no such column')){
      await db.prepare('INSERT INTO roman_schedule (id, raw_text, updated_at, updated_by, source) VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?)').bind(id, raw_text, updated_by, source).run();
    }else throw e;
  }
  // 同步到 Roman OS 正本
  await db.prepare('INSERT INTO roman_data (id, raw, site, updated_at) VALUES (?1, ?2, ?1, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET raw=?2, site=?1, updated_at=CURRENT_TIMESTAMP').bind(SHARED_SITE, raw_text).run();
  return true;
}
async function readLatestShared(db){
  await ensureSharedTables(db);
  let w = null, o = null;
  try{ w = await db.prepare('SELECT * FROM roman_schedule ORDER BY updated_at DESC LIMIT 1').first(); }catch(e){}
  try{ o = await db.prepare('SELECT id, raw, updated_at FROM roman_data WHERE id=?1 OR site=?1 ORDER BY updated_at DESC LIMIT 1').bind(SHARED_SITE).first(); }catch(e){}
  if(o && o.raw && (!w || String(o.updated_at||'') > String(w.updated_at||''))){
    return {raw_text:o.raw, parsed:[], updated_at:o.updated_at, updated_by:'roman_os', source:'roman_data'};
  }
  if(w){
    let parsed = [];
    try{ parsed = w.parsed ? JSON.parse(w.parsed) : []; }catch(e){}
    return {raw_text:w.raw_text, parsed, updated_at:w.updated_at, updated_by:w.updated_by, source:w.source};
  }
  return null;
}

function getCorsHeaders(request){
  const origin = request.headers.get('Origin') || '';
  const allowed = [
    'https://roman-schedule.yunyunspa.workers.dev',
  ];
  let allowOrigin = '*';
  if(origin){
    allowOrigin = allowed.includes(origin) ? origin : 'https://roman-schedule.yunyunspa.workers.dev';   // 完整網址相同才放行
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Line-Signature',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

async function verifyLineSignature(request, secret, bodyText){
  if(!secret) return true;
  const signature = request.headers.get('X-Line-Signature') || request.headers.get('x-line-signature');
  if(!signature) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(bodyText));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return b64 === signature;
}

// 固定時間比對（不洩漏時間差）
async function sameSecret(a, b){
  if(typeof a!=='string'||typeof b!=='string'||!b) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode('roman-schedule-compare'), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const [x, y] = await Promise.all([crypto.subtle.sign('HMAC', key, enc.encode(a)), crypto.subtle.sign('HMAC', key, enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y); let d = 0;
  for(let i=0;i<u.length;i++) d |= u[i]^v[i];
  return d===0;
}
// 班表 API 只給有 SYNC_SECRET 的程式用；沒設定 SYNC_SECRET 就整個關閉（不再「沒設就放行」）
async function syncAuthorized(request, env){
  const secret = env.SYNC_SECRET || '';
  if(!secret) return false;
  const auth = request.headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') && await sameSecret(auth.slice(7), secret);
}

// ── LINE 機器人允許名單（資料表跟 Roman OS 共用；欄位要跟 roman-os functions/_lib/linebot.js 一致） ──
async function ensureLineBotTables(DB){
  await DB.batch([
    DB.prepare('CREATE TABLE IF NOT EXISTS line_bot_allow (id TEXT PRIMARY KEY, kind TEXT, label TEXT, created_at INTEGER)'),
    DB.prepare('CREATE TABLE IF NOT EXISTS line_bot_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, user_id TEXT, group_id TEXT, kind TEXT, name TEXT, preview TEXT, status TEXT, site TEXT)'),
    DB.prepare('CREATE INDEX IF NOT EXISTS idx_line_bot_log_ts ON line_bot_log(ts)'),
  ]);
  // 第一次啟用：把以前用 LINE 更新過班表的人帶進允許名單，原本在用的人不會突然被擋
  const any = await DB.prepare('SELECT (SELECT COUNT(*) FROM line_bot_allow) a, (SELECT COUNT(*) FROM line_bot_log) l').first();
  if(any && !any.a && !any.l){
    try{
      const r = await DB.prepare("SELECT DISTINCT source FROM sync_logs WHERE type='line_update'").all();
      const ids = (r.results||[]).map(x=>String(x.source||'')).filter(x=>/^U[0-9a-f]{32}$/.test(x));
      if(ids.length) await DB.batch(ids.map(id=>DB.prepare("INSERT OR IGNORE INTO line_bot_allow (id, kind, label, created_at) VALUES (?, 'user', '以前用 LINE 更新過班表（自動帶入）', ?)").bind(id, Date.now())));
    }catch(e){}
    await DB.prepare("INSERT INTO line_bot_log (ts, status, preview) VALUES (?, 'init', '允許名單啟用')").bind(Date.now()).run();
  }
}
// 傳送者或所在群組在允許名單上？
async function lineAllowed(DB, src){
  const ids = [src.userId, src.groupId, src.roomId].filter(Boolean);
  if(!ids.length) return false;
  const r = await DB.prepare(`SELECT 1 FROM line_bot_allow WHERE id IN (${ids.map(()=>'?').join(',')}) LIMIT 1`).bind(...ids).first();
  return !!r;
}
// 看起來像班表：至少一段有「美容師＋上下班時間」那一行，而且下面至少有一行時間（例如 1400、1500 王小姐）
// 只有一行的聊天（「明天 10-12 點會晚到」）、只帶一個時間的訊息都不算
function looksLikeBoard(text){
  if(String(text).split('\n').filter(x=>x.trim()).length < 2) return false;
  try{
    const bs = boardBlocks(text).filter(b=>b.name && b.shift);
    return bs.length > 0 && bs.reduce((n,b)=>n + ((b.slots && b.slots.length) || 0), 0) >= 2;   // 整份至少 2 行時間
  }catch(e){ return false; }
}
async function lineName(env, src){
  if(!env.LINE_CHANNEL_TOKEN || !src.userId) return '';
  const u = src.groupId ? `https://api.line.me/v2/bot/group/${src.groupId}/member/${src.userId}`
          : src.roomId ? `https://api.line.me/v2/bot/room/${src.roomId}/member/${src.userId}`
          : `https://api.line.me/v2/bot/profile/${src.userId}`;
  try{ const r = await fetch(u, {headers:{Authorization:'Bearer '+env.LINE_CHANNEL_TOKEN}}); if(r.ok) return String((await r.json()).displayName||'').slice(0,40); }catch(e){}
  return '';
}
async function lineLog(DB, src, name, text, status){
  try{
    const first = String(text||'').split('\n').map(x=>x.trim()).filter(x=>x && !/^-{3,}$/.test(x)).slice(0,3).join(' / ').slice(0,80);
    await DB.prepare('INSERT INTO line_bot_log (ts, user_id, group_id, kind, name, preview, status, site) VALUES (?,?,?,?,?,?,?,?)')
      .bind(Date.now(), src.userId||null, src.groupId||src.roomId||null, src.type||'', name||'', first, status, SHARED_SITE).run();
    await DB.prepare('DELETE FROM line_bot_log WHERE ts < ?').bind(Date.now() - 90*86400000).run();
  }catch(e){}
}
async function lineReply(env, token, text){
  if(!env.LINE_CHANNEL_TOKEN || !token) return;
  try{ await fetch('https://api.line.me/v2/bot/message/reply',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.LINE_CHANNEL_TOKEN},body:JSON.stringify({replyToken:token,messages:[{type:'text',text}]})}); }catch(e){}
}


export default {
  async fetch(request, env, ctx){
    const url = new URL(request.url);
    const cors = getCorsHeaders(request);
    if(request.method==='OPTIONS') return new Response(null,{headers:cors});
    const hasD1 = env && env.ROMAN_DB && typeof env.ROMAN_DB.prepare==='function';
    const SYNC_SECRET = env.SYNC_SECRET || '';
    const LINE_SECRET = env.LINE_CHANNEL_SECRET || '';

    // 班表 API：沒有 SYNC_SECRET 的人一律不能讀寫（GitHub 版已改走 Roman OS 員工登入）
    if((url.pathname==='/api/schedule' || url.pathname==='/api/roman') && (request.method==='GET' || request.method==='POST')){
      if(!(await syncAuthorized(request, env))){
        return new Response(JSON.stringify({success:false, ok:false, error:'這個入口已停用，請用 Roman OS 或 roman-schedule.yunyunspa.workers.dev 首頁（需要 OS 員工密碼）'}),{status:401, headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
      }
    }

    if((url.pathname==='/api/schedule' || url.pathname==='/api/roman') && request.method==='GET'){
      try{
        if(!hasD1) return new Response(JSON.stringify({raw_text: memoryStore.raw_text, parsed:[], updated_at: memoryStore.updated_at, updated_by:'memory', warning:'D1未綁定'}),{headers:{...cors,'Content-Type':'application/json'}});
        // 讀取時順便補上線上預約，附版本號 ver 與撞時段 conflicts
        const site = BOARD_SITES.includes(url.searchParams.get('site')) ? url.searchParams.get('site') : SHARED_SITE;
        const v = await viewBoard(env.ROMAN_DB, site);
        if(v.raw || site !== SHARED_SITE) return new Response(JSON.stringify({raw_text:v.raw, parsed:[], updated_at:v.row?.updated_at||null, updated_by:v.ver_by||'roman_os', source:v.row?.source||'roman_data', ver:v.ver, ver_at:v.ver_at, ver_by:v.ver_by, conflicts:v.conflicts, day:v.day, header:v.header, mismatch:v.mismatch}),{headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
        const r = await readLatestShared(env.ROMAN_DB);
        if(r) return new Response(JSON.stringify(r),{headers:{...cors,'Content-Type':'application/json'}});
        return new Response(JSON.stringify({raw_text:'', parsed:[]}),{headers:{...cors,'Content-Type':'application/json'}});
      }catch(e){ console.error('worker error', e); return new Response(JSON.stringify({error:'處理失敗，請稍後再試'}),{status:500, headers:{...cors,'Content-Type':'application/json'}}); }   // W-08：詳細錯誤只寫 log
    }

    if((url.pathname==='/api/schedule' || url.pathname==='/api/roman') && request.method==='POST'){
      try{
        const bodyText = await request.text();
        if(bodyText.length > 60000) return new Response(JSON.stringify({error:'payload too large'}),{status:413, headers:cors});
        let body;
        try{ body = JSON.parse(bodyText); }catch{ return new Response(JSON.stringify({error:'invalid json'}),{status:400, headers:cors}); }
        const raw_text = body.raw_text || body.text || '';
        if(!raw_text.trim()) return new Response(JSON.stringify({error:'raw_text required'}),{status:400, headers:cors});
        if(raw_text.length > 50000) return new Response(JSON.stringify({error:'raw_text too large, max 50k'}),{status:413, headers:cors});
        if(raw_text.length < 10) return new Response(JSON.stringify({error:'too short'}),{status:400, headers:cors});
        const id = 'web_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
        if(!hasD1){
          memoryStore = {raw_text, updated_at: new Date().toLocaleString('zh-TW'), updated_by:'memory'};
          return new Response(JSON.stringify({success:true, id, hasD1:false}),{headers:{...cors,'Content-Type':'application/json'}});
        }
        const ub = String(body.updated_by||'v402_secure').slice(0,100);
        const src = String(body.source||'v402_secure').slice(0,100);
        // 跟 Roman OS 同一套存檔規則：帶 base_ver 檢查有沒有別人先存、補上線上預約、回報撞時段
        const site = BOARD_SITES.includes(body.site) ? body.site : SHARED_SITE;   // 今天 / 隔天兩份班表
        const r = await saveBoard(env.ROMAN_DB, raw_text, {site, base:body.base_ver, force:body.force===true, by:ub, source:src});
        if(r.conflict){
          return new Response(JSON.stringify({success:false, conflict:true, error:'班表剛被別人改過', raw_text:r.raw, ver:r.ver, ver_at:r.ver_at, ver_by:r.ver_by, conflicts:r.conflicts, day:r.day, header:r.header, mismatch:r.mismatch}),{status:409, headers:{...cors,'Content-Type':'application/json'}});
        }
        try{ await env.ROMAN_DB.prepare('INSERT INTO sync_logs (type, source, payload) VALUES (?, ?, ?)').bind('schedule_update', src, raw_text.slice(0,200)).run(); }catch{}
        pingNotify(ctx);
        return new Response(JSON.stringify({success:true, id, hasD1:true, raw_text:r.raw, ver:r.ver, ver_at:r.ver_at, ver_by:r.ver_by, conflicts:r.conflicts, day:r.day, header:r.header, mismatch:r.mismatch}),{headers:{...cors,'Content-Type':'application/json'}});
      }catch(e){ console.error('worker error', e); return new Response(JSON.stringify({error:'處理失敗，請稍後再試'}),{status:500, headers:{...cors,'Content-Type':'application/json'}}); }   // W-08：詳細錯誤只寫 log
    }

    if(url.pathname==='/webhook/line' && request.method==='POST'){
      try{
        const bodyText = await request.text();
        const ok = await verifyLineSignature(request, LINE_SECRET, bodyText);
        if(!ok) return new Response(JSON.stringify({error:'invalid signature'}),{status:403, headers:cors});
        const body = JSON.parse(bodyText);
        const events = body.events || [];
        if(hasD1) await ensureLineBotTables(env.ROMAN_DB);
        for(let ev of events){
          if(ev.type==='message' && ev.message.type==='text'){
            const text = ev.message.text;
            if(text.length > 20 && text.length < 10000 && looksLikeBoard(text)){
              const src = ev.source || {};
              // 傳送者或群組不在允許名單 → 不存，記一筆讓管理員在 Roman OS 後台按允許
              if(hasD1 && !(await lineAllowed(env.ROMAN_DB, src))){
                await lineLog(env.ROMAN_DB, src, await lineName(env, src), text, 'blocked');
                if(src.type==='user') await lineReply(env, ev.replyToken, '這個 LINE 帳號還沒有權限更新班表，這次的班表沒有存。\n請管理員到 Roman OS 後台 →「LINE 機器人」按「允許此人」，再傳一次。');
                continue;
              }
              const id = 'line_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
              if(hasD1){
                const saved = await saveBoard(env.ROMAN_DB, text, {site:SHARED_SITE, by:'line_bot', source:'line_bot'});
                ev.__clash = saved.conflicts || [];
                await lineLog(env.ROMAN_DB, src, await lineName(env, src), text, 'saved');
                pingNotify(ctx);
                try{ await env.ROMAN_DB.prepare('INSERT INTO sync_logs (type, source, payload) VALUES (?, ?, ?)').bind('line_update', (ev.source.userId||'line').slice(0,100), text.slice(0,200)).run(); }catch{}
              }else{
                memoryStore = {raw_text:text, updated_at: new Date().toLocaleString('zh-TW'), updated_by:'line'};
              }
              if(env.LINE_CHANNEL_TOKEN && ev.replyToken){
                try{
                  await fetch('https://api.line.me/v2/bot/message/reply',{
                    method:'POST',
                    headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.LINE_CHANNEL_TOKEN},
                    body: JSON.stringify({replyToken: ev.replyToken, messages:[{type:'text', text: `✅ 已同步到 D1 ${text.length} 字 (v407)\n${text.split('\n')[0]}...` + ((ev.__clash||[]).length ? `\n\n⚠ 撞時段：\n` + ev.__clash.map(c=>`${c.time} ${c.beautician}：${c.booking.join('、')} ⇄ ${c.staff.join('、')}`).join('\n') : '')} ]})
                  });
                }catch{}
              }
            }
          }
        }
        return new Response('OK',{headers:cors});
      }catch(e){ console.error('worker error', e); return new Response(JSON.stringify({error:'處理失敗，請稍後再試'}),{status:500, headers:{...cors,'Content-Type':'application/json'}}); }   // W-08：詳細錯誤只寫 log
    }

    // 畫面（/、/index.html、/icons/…）由 Cloudflare 靜態資源直接提供，不會進到這裡

    return new Response('Not found',{status:404, headers:cors});
  }
};
