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
    const m = t.match(TIME_RE);
    const tm = m && parseTok(m[1]);
    if (!tm) return;
    const customer = (m[2] || "").trim();
    cur.slots.push({ line: i, tok: m[1], h: tm.h % 24, m: tm.m, biz: toBiz(tm.h % 24, tm.m), customer, off: t.includes("不排") });
  });
  return { lines, blocks };
}

// 班表是哪一天（營業日）
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
    if (r) return { ver: Number(r.ver) || 0, at: r.updated_at || null, by: r.by || null };
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
    const { bookings, duty } = await boardBookings(DB, boardDate(raw, Date.now(), siteOffset(site)));
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
  return { row, raw, ver: v.ver, ver_at: v.at, ver_by: v.by, conflicts: raw ? findConflicts(raw) : [] };
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
  const q = check
    ? DB.prepare(`UPDATE roman_board_ver SET ver = ver + 1, updated_at = ${TS}, by = ?3 WHERE id = ?1 AND ver = ?2`).bind(site, Number(opt.base), by)
    : DB.prepare(`UPDATE roman_board_ver SET ver = ver + 1, updated_at = ${TS}, by = ?2 WHERE id = ?1`).bind(site, by);
  const bump = await q.run();
  if (check && !(bump.meta && bump.meta.changes)) return conflict();   // 同一瞬間有人搶先存
  const merged = await withBookings(DB, text, site);
  await DB.prepare(`INSERT INTO roman_data (id, raw, site, updated_at) VALUES (?1, ?2, ?1, ${TS}) ON CONFLICT(id) DO UPDATE SET raw = ?2, site = ?1, updated_at = ${TS}`)
    .bind(site, merged).run();
  await copyToHistory(DB, merged, by, source);
  let raw = merged;
  try { const s = await syncBoard(DB, site); if (s.raw) raw = s.raw; } catch (_) {}   // 存檔這段時間剛好有新預約
  const v = await readVer(DB, site);
  return { ok: true, raw, ver: v.ver, ver_at: v.at, ver_by: v.by, conflicts: findConflicts(raw) };
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
      if (row && row.raw && boardDate(row.raw, Date.now(), siteOffset(site)) === date) out.push(row.raw);
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
    'https://dick12339-arch.github.io',
    'https://roman-schedule.yunyunspa.workers.dev',
    'https://roman-schedule-worker.yunyunspa.workers.dev',
    'http://localhost',
    'http://127.0.0.1'
  ];
  let allowOrigin = '*';
  if(origin){
    const ok = allowed.some(a=> origin.startsWith(a)) || origin.includes('github.io') || origin.includes('workers.dev') || origin.includes('localhost');
    allowOrigin = ok ? origin : 'https://dick12339-arch.github.io';
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

// v406: 首頁不再內嵌一份網頁（舊的內嵌版跳脫字元壞掉，瀏覽器打開是空白）。
// 改成直接提供 GitHub Pages 上的 index.html，兩個網址永遠是同一份、改一次就好。
const PAGE_URL = 'https://dick12339-arch.github.io/roman-schedule/';
async function servePage(cors){
  const secHeaders = {...cors, 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'DENY', 'Referrer-Policy':'strict-origin-when-cross-origin'};
  try{
    const r = await fetch(PAGE_URL + '?v=' + Math.floor(Date.now() / 60000), {cf:{cacheTtl:60, cacheEverything:true}});
    if(r.ok){
      const html = await r.text();
      if(html.includes('id="root"')) return new Response(html, {headers:secHeaders});
    }
  }catch(e){}
  return Response.redirect(PAGE_URL, 302); // 抓不到就直接帶去 GitHub Pages
}

export default {
  async fetch(request, env, ctx){
    const url = new URL(request.url);
    const cors = getCorsHeaders(request);
    if(request.method==='OPTIONS') return new Response(null,{headers:cors});
    const hasD1 = env && env.ROMAN_DB && typeof env.ROMAN_DB.prepare==='function';
    const SYNC_SECRET = env.SYNC_SECRET || '';
    const LINE_SECRET = env.LINE_CHANNEL_SECRET || '';

    if((url.pathname==='/api/schedule' || url.pathname==='/api/roman') && request.method==='GET'){
      try{
        if(!hasD1) return new Response(JSON.stringify({raw_text: memoryStore.raw_text, parsed:[], updated_at: memoryStore.updated_at, updated_by:'memory', warning:'D1未綁定'}),{headers:{...cors,'Content-Type':'application/json'}});
        // 讀取時順便補上線上預約，附版本號 ver 與撞時段 conflicts
        const site = BOARD_SITES.includes(url.searchParams.get('site')) ? url.searchParams.get('site') : SHARED_SITE;
        const v = await viewBoard(env.ROMAN_DB, site);
        if(v.raw || site !== SHARED_SITE) return new Response(JSON.stringify({raw_text:v.raw, parsed:[], updated_at:v.row?.updated_at||null, updated_by:v.ver_by||'roman_os', source:v.row?.source||'roman_data', ver:v.ver, ver_at:v.ver_at, ver_by:v.ver_by, conflicts:v.conflicts}),{headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
        const r = await readLatestShared(env.ROMAN_DB);
        if(r) return new Response(JSON.stringify(r),{headers:{...cors,'Content-Type':'application/json'}});
        return new Response(JSON.stringify({raw_text:'', parsed:[]}),{headers:{...cors,'Content-Type':'application/json'}});
      }catch(e){ return new Response(JSON.stringify({error:e.message}),{status:500, headers:cors}); }
    }

    if((url.pathname==='/api/schedule' || url.pathname==='/api/roman') && request.method==='POST'){
      try{
        if(SYNC_SECRET){
          const auth = request.headers.get('Authorization') || '';
          if(!auth.startsWith('Bearer ') || auth.slice(7) !== SYNC_SECRET){
            return new Response(JSON.stringify({error:'unauthorized'}),{status:401, headers:{...cors,'Content-Type':'application/json'}});
          }
        }
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
          return new Response(JSON.stringify({success:false, conflict:true, error:'班表剛被別人改過', raw_text:r.raw, ver:r.ver, ver_at:r.ver_at, ver_by:r.ver_by, conflicts:r.conflicts}),{status:409, headers:{...cors,'Content-Type':'application/json'}});
        }
        try{ await env.ROMAN_DB.prepare('INSERT INTO sync_logs (type, source, payload) VALUES (?, ?, ?)').bind('schedule_update', src, raw_text.slice(0,200)).run(); }catch{}
        return new Response(JSON.stringify({success:true, id, hasD1:true, raw_text:r.raw, ver:r.ver, ver_at:r.ver_at, ver_by:r.ver_by, conflicts:r.conflicts}),{headers:{...cors,'Content-Type':'application/json'}});
      }catch(e){ return new Response(JSON.stringify({error:e.message}),{status:500, headers:cors}); }
    }

    if(url.pathname==='/webhook/line' && request.method==='POST'){
      try{
        const bodyText = await request.text();
        const ok = await verifyLineSignature(request, LINE_SECRET, bodyText);
        if(!ok) return new Response(JSON.stringify({error:'invalid signature'}),{status:403, headers:cors});
        const body = JSON.parse(bodyText);
        const events = body.events || [];
        for(let ev of events){
          if(ev.type==='message' && ev.message.type==='text'){
            const text = ev.message.text;
            if(text.length > 20 && text.length < 10000 && (text.includes('太原') || text.includes('日進') || text.includes('日新') || text.includes('-') || text.includes('---------------') || text.includes('不排'))){
              const id = 'line_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
              if(hasD1){
                const saved = await saveBoard(env.ROMAN_DB, text, {site:SHARED_SITE, by:'line_bot', source:'line_bot'});
                ev.__clash = saved.conflicts || [];
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
      }catch(e){ return new Response(JSON.stringify({error:e.message}),{status:500, headers:cors}); }
    }

    if(url.pathname==='/' || url.pathname==='/index.html'){
      return servePage(cors);
    }

    return new Response('Roman Worker v408 OK - /api/schedule /webhook/line',{headers:cors});
  }
};
