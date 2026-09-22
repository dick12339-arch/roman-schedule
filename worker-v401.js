// Roman Worker v401 - v401三版型重排 + LINE + D1 + UI整合版
// 基於 v4.0.1-github-sync，UI 換成 v401 響應式 (電腦/直式/橫式獨立佈局)

let memoryStore = { raw_text: '', updated_at: '', updated_by: 'memory' };

async function insertSchedule(db, id, raw_text, updated_by, source){
  try{
    await db.prepare('INSERT INTO roman_schedule (id, raw_text, parsed, updated_at, updated_by, source) VALUES (?, ?, ?, datetime("now"), ?, ?)').bind(id, raw_text, JSON.stringify([]), updated_by, source).run();
    return true;
  }catch(e){
    if(e.message.includes('no column named parsed') || e.message.includes('no such column')){
      await db.prepare('INSERT INTO roman_schedule (id, raw_text, updated_at, updated_by, source) VALUES (?, ?, datetime("now"), ?, ?)').bind(id, raw_text, updated_by, source).run();
      return true;
    }
    throw e;
  }
}

const V401_HTML = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#fafaf9">
<meta name="mobile-web-app-capable" content="yes">
<title>Roman-schedule v401 - 三版型重排不縮小</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --safe-top: env(safe-area-inset-top);
  --safe-right: env(safe-area-inset-right);
  --safe-bottom: env(safe-area-inset-bottom);
  --safe-left: env(safe-area-inset-left);
}
html{
  padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
  min-height: calc(100% + var(--safe-top));
  min-height: -webkit-fill-available;
  background:#fafaf9;
}
body{
  font-family:-apple-system,BlinkMacSystemFont,"Noto Sans TC","Microsoft JhengHei",sans-serif;
  background:#fafaf9;color:#18181b;line-height:1.5;
  -webkit-tap-highlight-color:transparent;
  overflow-x:hidden;
  width:100%;
  max-width:100vw;
  min-height:100dvh;
  min-height:-webkit-fill-available;
  position:relative;
}
.mono{font-family:"JetBrains Mono",ui-monospace,monospace}

/* Header - 三版型都獨立排版，不等比縮小 */
.header{
  position:sticky;
  top:0;
  top: var(--safe-top);
  z-index:30;
  background:rgba(255,255,255,0.92);
  backdrop-filter:blur(20px);
  -webkit-backdrop-filter:blur(20px);
  border-bottom:1px solid #e4e4e7;
  padding-top: var(--safe-top);
  width:100%;
  max-width:100vw;
}
.header-inner{
  max-width:1280px;
  margin:0 auto;
  padding:12px max(12px, var(--safe-right)) 12px max(12px, var(--safe-left));
  display:flex;
  flex-direction:column;
  gap:8px;
}
.title{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-weight:700;font-size:20px;line-height:1.2}
.badge{font-size:10px;font-family:monospace;padding:3px 8px;border-radius:999px;border:1px solid;white-space:nowrap;line-height:1.4}
.badge-amber{background:#fef3c7;border-color:#fde68a;color:#92400e}
.badge-blue{background:#eff6ff;border-color:#bfdbfe;color:#1e40af}
.badge-emerald{background:#ecfdf5;border-color:#a7f3d0;color:#065f46}
.badge-zinc{background:#f4f4f5;border-color:#e4e4e7;color:#52525b}
.badge-dark{background:#18181b;color:#fff;border-color:#18181b}

/* Container - 吃安全區，避免數值被瀏海擋住 */
.container{
  max-width:1280px;
  margin:0 auto;
  padding:12px max(12px, var(--safe-right)) 12px max(12px, var(--safe-left));
  width:100%;
}
.version-bar{
  background:#18181b;color:#fff;
  padding:10px max(12px, var(--safe-right)) 10px max(12px, var(--safe-left));
  border-radius:12px;
  display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center;
  font-size:10px;font-family:monospace;
  width:100%;box-sizing:border-box;
}

/* Grid - 電腦 / 手機直式 / 手機橫式 三種排法 */
.grid-main{
  display:grid;
  grid-template-columns:1fr;
  gap:16px;
  width:100%;
  max-width:100%;
  align-items:start;
}
.left-col{width:100%;max-width:100%;min-width:0}
.right-col{width:100%;max-width:100%;min-width:0}

/* 卡片 - 不超出，不重疊 */
.card{
  background:#fff;border:1px solid #e4e4e7;border-radius:16px;padding:14px;
  box-shadow:0 1px 2px rgba(0,0,0,0.05);
  width:100%;max-width:100%;box-sizing:border-box;overflow:hidden;
}
.control-card{position:relative}
.control-header{
  display:flex;justify-content:space-between;align-items:center;
  margin-bottom:12px;gap:8px;
}
.control-title{font-size:13px;font-weight:700;display:flex;align-items:center;gap:8px;min-width:0;flex:1}
.control-toggle{
  display:none; /* 電腦版隱藏，手機版才顯示 */
  height:32px;padding:0 12px;border-radius:999px;border:1px solid #e4e4e7;
  background:#fff;font-size:12px;font-weight:500;cursor:pointer;flex-shrink:0;
}
.control-body{
  display:flex;flex-direction:column;gap:12px;
  transition:all 0.25s ease;
  overflow:hidden;
}
.control-body.collapsed{
  max-height:0;opacity:0;pointer-events:none;margin:0;padding:0;
  height:0;
}

/* Textarea & Input */
.textarea{
  width:100%;height:200px;background:#fafafa;border:1px solid #e4e4e7;border-radius:12px;
  padding:12px;font-size:11px;font-family:monospace;line-height:1.6;outline:none;resize:none;
  max-width:100%;box-sizing:border-box;
}
.textarea:focus{border-color:#18181b;box-shadow:0 0 0 2px rgba(24,24,27,0.1)}
.input{
  width:100%;height:44px;background:#fafafa;border:1px solid #e4e4e7;border-radius:12px;
  padding:0 40px 0 16px;font-size:14px;outline:none;max-width:100%;box-sizing:border-box;
}
.input:focus{border-color:#18181b;box-shadow:0 0 0 2px rgba(24,24,27,0.1)}

/* 按鈕 - 重點：不可重疊，用 grid 不用 absolute */
.btn-group{
  display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%;max-width:100%;
}
.btn{
  height:48px;border-radius:12px;border:none;font-size:13px;font-weight:600;
  cursor:pointer;transition:transform 0.1s,background 0.2s;
  display:flex;align-items:center;justify-content:center;gap:6px;
  touch-action:manipulation;min-width:0;max-width:100%;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  position:relative; /* 確保不被蓋住 */
  z-index:1;
}
.btn:active{transform:scale(0.98)}
.btn-dark{background:#18181b;color:#fff}
.btn-green{background:#06C755;color:#fff}
.btn-white{background:#fff;border:1px solid #e4e4e7;color:#18181b}
.btn-white-bold{background:#fff;border:2px solid #18181b;color:#18181b;font-weight:700}

/* Filter */
.filter-wrap{position:relative;overflow:hidden;max-width:100%}
.filter-scroll{display:flex;gap:8px;overflow-x:auto;padding:0 4px 6px 0;-webkit-overflow-scrolling:touch;scrollbar-width:none;max-width:100%}
.filter-scroll::-webkit-scrollbar{display:none}
.filter-btn{
  height:40px;padding:0 16px;border-radius:999px;font-size:13px;font-weight:500;
  white-space:nowrap;border:1px solid #e4e4e7;background:#fff;color:#52525b;
  cursor:pointer;flex-shrink:0;touch-action:manipulation;transition:all 0.2s;
}
.filter-btn.active{background:#18181b;color:#fff;border-color:#18181b;box-shadow:0 1px 3px rgba(0,0,0,0.2)}

/* Stats - 重要數值不可被遮住，加安全區 */
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px;width:100%}
.stat{
  background:#fafafa;border:1px solid #f4f4f5;border-radius:12px;padding:10px 8px;
  text-align:center;min-width:0;position:relative;z-index:1;
  /* 確保數值不被瀏海擋住 */
  padding-right:max(8px, var(--safe-right));
  padding-left:max(8px, var(--safe-left));
}
.stat-emerald{background:#ecfdf5;border-color:#d1fae5}
.stat-label{font-size:11px;color:#71717a;line-height:1.2}
.stat-value{font-size:18px;font-weight:800;margin-top:4px;line-height:1.1;letter-spacing:-0.02em}

.teacher-card{
  background:#fff;border:1px solid #e4e4e7;border-radius:16px;padding:14px;
  box-shadow:0 1px 2px rgba(0,0,0,0.05);width:100%;max-width:100%;box-sizing:border-box;
}
.booking-row{display:flex;align-items:center;gap:8px;min-height:40px;padding:0 12px;border-radius:10px;font-size:13px;margin-bottom:6px;width:100%;max-width:100%;box-sizing:border-box}
.booking-filled{background:#18181b;color:#fff}
.booking-empty{background:#fff;border:1px dashed #d4d4d8;color:#a1a1aa}
.log{height:120px;overflow-y:auto;background:#fafafa;border:1px solid #f4f4f5;border-radius:10px;padding:8px;font-size:10px;font-family:monospace;max-width:100%}
.log-item{display:flex;gap:8px;margin-bottom:4px;min-width:0}
.safe-bottom{height:var(--safe-bottom);min-height:var(--safe-bottom)}

/* ===== 電腦版 >=1024px : 左右分欄，不縮小，按鈕不重疊 ===== */
@media(min-width:1024px){
  .header-inner{padding:16px max(24px, var(--safe-right)) 16px max(24px, var(--safe-left));flex-direction:row;justify-content:space-between;align-items:center}
  .title{font-size:24px}
  .container{padding:16px max(24px, var(--safe-right)) 20px max(24px, var(--safe-left))}
  .grid-main{grid-template-columns:420px 1fr;gap:24px}
  .left-col{position:sticky;top:calc(72px + var(--safe-top));max-height:calc(100dvh - 88px - var(--safe-top) - var(--safe-bottom));overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;padding-right:2px}
  .card{border-radius:20px;padding:20px}
  .textarea{height:260px;font-size:11px}
  .btn{height:42px;font-size:13px}
  .btn-group{gap:10px}
  .teacher-card{border-radius:20px;padding:20px}
  .stats{gap:12px}
  .stat-value{font-size:20px}
  .control-toggle{display:none !important}
  .control-body{max-height:none !important;opacity:1 !important;height:auto !important;pointer-events:auto !important}
}

/* ===== 平板 768-1023px ===== */
@media(min-width:768px) and (max-width:1023px){
  .header-inner{padding:14px max(20px, var(--safe-right)) 14px max(20px, var(--safe-left))}
  .title{font-size:22px}
  .grid-main{gap:20px}
  .textarea{height:220px}
  .btn{height:44px}
  .stats{grid-template-columns:repeat(3,1fr)}
  .control-toggle{display:none !important}
  .control-body{max-height:none !important;opacity:1 !important;height:auto !important}
}

/* ===== 手機直式 <=767px portrait : 單欄，按鈕 2x2 不重疊，數值放大 ===== */
@media(max-width:767px) and (orientation:portrait){
  .header-inner{padding:12px max(14px, var(--safe-right)) 10px max(14px, var(--safe-left))}
  .title{font-size:19px}
  .container{padding:10px max(14px, var(--safe-right)) 14px max(14px, var(--safe-left))}
  .grid-main{grid-template-columns:1fr;gap:14px}
  .card{border-radius:16px;padding:14px}
  .textarea{height:165px;font-size:11px}
  .btn-group{grid-template-columns:1fr 1fr;gap:10px}
  .btn{height:48px;font-size:13px;font-weight:600}
  .control-toggle{display:flex !important}
  .filter-btn{height:38px;padding:0 16px;font-size:13px}
  .stats{gap:10px}
  .stat{padding:12px 8px}
  .stat-label{font-size:10px}
  .stat-value{font-size:20px} /* 重要數值放大，不被遮住 */
  .teacher-card{padding:14px}
  .booking-row{min-height:44px;font-size:13px}
  .log{height:110px}
}

/* ===== 手機橫式 - 關鍵：max-height 小，改左右分欄，不是等比縮小 ===== */
@media(orientation:landscape) and (max-height:600px){
  .header{position:sticky}
  .header-inner{
    padding:8px max(14px, var(--safe-right)) 8px max(14px, var(--safe-left));
    flex-direction:row;justify-content:space-between;align-items:center;gap:12px;
  }
  .title{font-size:16px;gap:6px}
  .title .badge{font-size:9px;padding:2px 6px}
  .header-inner > div:last-child{font-size:10px !important}
  .container{padding:8px max(14px, var(--safe-right)) 10px max(14px, var(--safe-left))}
  .version-bar{padding:6px max(14px, var(--safe-right)) 6px max(14px, var(--safe-left));font-size:9px}
  .grid-main{
    grid-template-columns:340px 1fr; /* 橫式左右分，不上下堆疊，避免按鈕重疊 */
    gap:12px;
    align-items:start;
  }
  .left-col{
    position:sticky;top:calc(48px + var(--safe-top));
    max-height:calc(100dvh - 60px - var(--safe-top) - var(--safe-bottom));
    overflow-y:auto;-webkit-overflow-scrolling:touch;
  }
  .card{border-radius:12px;padding:10px}
  .control-header{margin-bottom:8px}
  .control-title{font-size:12px}
  .control-toggle{display:flex !important;height:28px;font-size:11px;padding:0 10px}
  .textarea{height:110px;font-size:10px;padding:8px}
  .btn-group{gap:8px}
  .btn{height:38px;font-size:12px;border-radius:10px}
  .input{height:36px;font-size:13px}
  .filter-btn{height:32px;padding:0 12px;font-size:12px}
  .stats{margin-top:8px;gap:8px}
  .stat{padding:8px 6px;border-radius:10px}
  .stat-label{font-size:9px}
  .stat-value{font-size:16px} /* 橫式數值仍清晰 */
  .teacher-card{padding:10px;border-radius:12px}
  .booking-row{min-height:32px;font-size:12px;padding:0 10px;margin-bottom:4px}
  .log{height:80px;font-size:9px}
  .safe-bottom{height:calc(var(--safe-bottom) + 8px)}
}

/* 超小橫式 iPhone SE 等 */
@media(orientation:landscape) and (max-height:380px){
  .grid-main{grid-template-columns:300px 1fr;gap:10px}
  .textarea{height:85px}
  .btn{height:34px;font-size:11px}
  .stat-value{font-size:14px}
}
</style>
<script>
const WORKER_URL = 'https://roman-schedule.yunyunspa.workers.dev';
const WORKER_BACKUP_URL = 'https://roman-schedule-worker.yunyunspa.workers.dev';
function safeGet(k){try{return localStorage.getItem(k);}catch(e){return null;}}
function safeSet(k,v){try{localStorage.setItem(k,v);}catch(e){}}
async function fetchWorkerSchedule(){
  const urls = [WORKER_URL + '/api/schedule', WORKER_BACKUP_URL + '/api/schedule'];
  for(let url of urls){
    try{
      const res = await fetch(url + '?t=' + Date.now(), {method:'GET', cache:'no-store', mode:'cors'});
      if(!res.ok) continue;
      const data = await res.json();
      if(data && data.raw_text && data.raw_text.length > 10) return data;
    }catch(e){ console.log('fetch fail', e.message); }
  }
  return null;
}
async function pushWorkerSchedule(raw_text){
  const urls = [WORKER_URL + '/api/schedule', WORKER_BACKUP_URL + '/api/schedule'];
  for(let url of urls){
    try{
      const res = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, mode:'cors', body: JSON.stringify({raw_text, source:'roman_v401_responsive', updated_by:'roman_site'})});
      const data = await res.json();
      if(data && data.success) return data;
    }catch(e){ console.log('push fail', e.message); }
  }
  return null;
}
</script>
</head>
<body>
<div class="header">
  <div class="header-inner">
    <div style="display:flex;flex-direction:column;gap:6px;min-width:0;flex:1">
      <div class="title">
        <span>📦 Roman Data</span>
        <span class="badge badge-amber">v401 三版型重排</span>
        <span class="badge badge-blue">LINE + D1</span>
      </div>
      <div style="font-size:11px;color:#71717a;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">接龍制・22位老師・日進 / 太原 / 日新 / 忠誠 / 大連 / 南屯・不等比縮小</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;flex-shrink:0">
      <div id="syncStatus" class="badge badge-amber" style="padding:6px 12px">● 檢查 D1 連線...</div>
      <div id="tabCount" class="badge badge-zinc" style="padding:6px 12px">1 個分頁</div>
    </div>
  </div>
</div>

<div class="container" style="padding-top:8px;padding-bottom:0">
  <div class="version-bar">
    <span>v401-三版型重排・電腦/直式/橫式獨立佈局・按鈕不重疊・數值不被遮・面板可關閉</span>
    <span id="d1LiveBadge" style="background:rgba(245,158,11,0.2);border:1px solid rgba(245,158,11,0.3);color:#fcd34d;padding:2px 8px;border-radius:999px;white-space:nowrap">● D1 檢查中...</span>
  </div>
</div>

<div class="container">
  <div class="grid-main">
    <!-- 左：控制 -->
    <div class="left-col">
      <div class="card control-card">
        <div class="control-header">
          <div class="control-title">
            <span>🔄 即時同步控制</span>
            <span class="badge badge-dark" style="font-size:10px">v401</span>
          </div>
          <button id="btnToggleControl" class="control-toggle">收合面板 ▼</button>
        </div>
        
        <div id="controlBody" class="control-body">
          <div>
            <div style="font-size:11px;color:#71717a;margin-bottom:6px;font-family:monospace;display:flex;justify-content:space-between">
              <span>班表文字（你喜歡的格式）</span>
              <span id="charCount" class="badge badge-zinc" style="font-size:9px">0 字</span>
            </div>
            <textarea id="scheduleInput" class="textarea" placeholder="小野11-19太原407&#10;11 K&#10;..."></textarea>
          </div>

          <div class="btn-group">
            <button id="btnSyncD1" class="btn btn-dark">💾 同步到 D1</button>
            <button id="btnReloadWorker" class="btn btn-white-bold">🔄 從 D1 載入</button>
          </div>
          <div class="btn-group">
            <button id="btnReload" class="btn btn-white">🔄 重新整理</button>
            <button id="btnCopy" class="btn btn-white">📋 複製</button>
          </div>

          <div style="border-top:1px solid #f4f4f5;padding-top:12px">
            <div style="font-size:11px;color:#71717a;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
              <span>同步日誌</span>
              <span id="workerBadge" class="badge badge-zinc">檢查中...</span>
            </div>
            <div id="syncLog" class="log"><div style="color:#a1a1aa">等待同步... 正在連接 Worker D1</div></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 右：顯示 -->
    <div class="right-col">
      <div class="card" style="margin-bottom:14px">
        <div style="position:relative;margin-bottom:12px">
          <input id="searchInput" class="input" type="text" placeholder="搜尋老師 / 客戶">
          <span style="position:absolute;right:12px;top:50%;transform:translateY(-50%);color:#a1a1aa;pointer-events:none">🔍</span>
        </div>
        
        <div class="filter-wrap">
          <div id="filterTabs" class="filter-scroll"></div>
        </div>

        <div class="stats">
          <div class="stat"><div class="stat-label">老師</div><div id="statTeachers" class="stat-value">0</div></div>
          <div class="stat"><div class="stat-label">預約</div><div id="statBookings" class="stat-value">0</div></div>
          <div class="stat stat-emerald"><div class="stat-label" style="color:#065f46">空檔</div><div id="statEmpty" class="stat-value" style="color:#065f46">0</div></div>
        </div>
      </div>

      <div id="scheduleDisplay" style="display:flex;flex-direction:column;gap:12px"></div>
    </div>
  </div>
</div>

<div class="safe-bottom"></div>

<script>
const LOCATIONS = ["全部","日進","太原","日新","忠誠","大連","南屯"];
let currentFilter = "全部";
let searchQuery = "";

function parseSchedule(text){
  const blocks = text.split(/-{3,}/).map(b=>b.trim()).filter(Boolean);
  const result = [];
  for(let block of blocks){
    const lines = block.split('\n').map(l=>l.trim()).filter(Boolean);
    if(!lines.length) continue;
    const first = lines[0];
    const m = first.match(/^(.+?)(\d{1,2})(?:[:：]?\d{0,2})?[-—](\d{1,2})(.+)?$/);
    if(!m) continue;
    const name = m[1].trim();
    const start = parseInt(m[2]);
    const end = parseInt(m[3]);
    const location = (m[4]||'').trim();
    const bookings = [];
    for(let i=1;i<lines.length;i++){
      const line = lines[i];
      const bm = line.match(/^(\d{1,2})(?::?(\d{0,2}))?\s*(.+)?$/);
      if(bm){
        const hour = parseInt(bm[1]);
        const customer = (bm[3]||'').trim();
        if(customer) bookings.push({hour, customer});
      }else if(line){
        bookings.push({hour: null, customer: line});
      }
    }
    result.push({name, start, end, location, bookings, raw: block});
  }
  return result;
}

function renderSchedule(){
  const text = document.getElementById('scheduleInput').value;
  const charCount = document.getElementById('charCount');
  if(charCount) charCount.textContent = text.length + ' 字';
  const data = parseSchedule(text);
  const display = document.getElementById('scheduleDisplay');
  const q = searchQuery.toLowerCase();
  let filtered = data;
  if(currentFilter !== "全部"){
    filtered = filtered.filter(d => d.location.includes(currentFilter) || d.raw.includes(currentFilter));
  }
  if(q){
    filtered = filtered.filter(d => d.name.toLowerCase().includes(q) || d.bookings.some(b=>b.customer.toLowerCase().includes(q)));
  }
  document.getElementById('statTeachers').textContent = filtered.length;
  const allBookings = filtered.reduce((a,c)=>a+c.bookings.length,0);
  document.getElementById('statBookings').textContent = allBookings;
  const emptyCount = filtered.reduce((a,c)=>a+c.bookings.filter(b=>!b.customer||!b.customer.trim()).length,0);
  document.getElementById('statEmpty').textContent = emptyCount;
  document.getElementById('tabCount').textContent = filtered.length + ' 位老師';

  if(filtered.length===0){
    display.innerHTML = \`<div class="card" style="text-align:center;color:#a1a1aa;padding:24px">無符合資料<br><span style="font-size:11px">試試切換地點或搜尋關鍵字</span></div>\`;
    return;
  }

  display.innerHTML = filtered.map(t=>{
    const locBadge = t.location ? \`<span class="badge badge-dark" style="font-size:10px">\${t.location}</span>\` : '';
    const timeBadge = (t.start!==undefined) ? \`<span class="badge badge-zinc" style="font-size:10px">\${t.start}-\${t.end}</span>\` : '';
    return \`<div class="teacher-card">
      <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:12px;min-width:0">
        <div style="min-width:0;flex:1">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0">
            <h3 style="font-size:16px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">\${t.name}</h3>
            \${locBadge}\${timeBadge}
          </div>
          <div style="font-size:11px;color:#71717a;margin-top:4px;font-family:monospace">\${t.bookings.length} 筆預約・\${t.start}-\${t.end}時</div>
        </div>
        <div style="width:36px;height:36px;border-radius:50%;background:#18181b;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0;position:relative;z-index:1">\${t.bookings.length}</div>
      </div>
      <div style="width:100%;max-width:100%">
        \${t.bookings.length===0 ? '<div style="text-align:center;color:#a1a1aa;padding:12px;border:1px dashed #e4e4e7;border-radius:10px;font-size:12px">今日無預約</div>' : t.bookings.map(b=>{
          const has = b.customer && b.customer.trim();
          return \`<div class="booking-row \${has?'booking-filled':'booking-empty'}">
            <span class="mono" style="width:48px;flex-shrink:0;font-weight:600">\${b.hour!=null?b.hour+':00':'—'}</span>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">\${has?b.customer:'空檔'}</span>
          </div>\`;
        }).join('')}
      </div>
    </div>\`;
  }).join('');

  const tabsEl = document.getElementById('filterTabs');
  tabsEl.innerHTML = LOCATIONS.map(loc=>{
    const active = currentFilter===loc;
    return \`<button data-loc="\${loc}" class="filter-btn \${active?'active':''}">\${loc}</button>\`;
  }).join('');
  tabsEl.querySelectorAll('button').forEach(btn=>{
    btn.onclick=()=>{currentFilter=btn.dataset.loc; renderSchedule(); btn.scrollIntoView({behavior:'smooth', inline:'center', block:'nearest'});};
  });
}

function logSync(msg, source="系統"){
  const logEl = document.getElementById('syncLog');
  if(!logEl) return;
  const time = new Date().toLocaleTimeString();
  const div = document.createElement('div');
  div.className = 'log-item';
  div.innerHTML = \`<span style="color:#a1a1aa;flex-shrink:0">\${time}</span><span style="color:#18181b;font-weight:600;flex-shrink:0">\${source}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">\${msg}</span>\`;
  logEl.prepend(div);
  while(logEl.children.length>20) logEl.removeChild(logEl.lastChild);
}

async function init(){
  const badge = document.getElementById('workerBadge');
  const status = document.getElementById('syncStatus');
  const liveBadge = document.getElementById('d1LiveBadge');
  const toggleBtn = document.getElementById('btnToggleControl');
  const controlBody = document.getElementById('controlBody');
  
  // 面板可關閉功能 - 手機版重要
  if(toggleBtn && controlBody){
    toggleBtn.onclick = ()=>{
      const isCollapsed = controlBody.classList.contains('collapsed');
      if(isCollapsed){
        controlBody.classList.remove('collapsed');
        toggleBtn.textContent = '收合面板 ▼';
      }else{
        controlBody.classList.add('collapsed');
        toggleBtn.textContent = '展開面板 ▲';
      }
    };
  }

  try{
    if(badge) badge.textContent = '載入 Worker D1...';
    if(status) status.textContent = '● 連接 D1 中...';
    logSync('正在連接 Worker D1...', '系統');
    const data = await fetchWorkerSchedule();
    if(data && data.raw_text){
      document.getElementById('scheduleInput').value = data.raw_text;
      safeSet('roman_schedule_raw', data.raw_text);
      logSync('✅ 已從 Worker D1 載入 '+data.raw_text.length+' 字', 'Worker D1');
      if(badge){ badge.textContent = '✅ D1 已綁定 '+data.raw_text.length+' 字'; badge.className='badge badge-emerald'; }
      if(status){ status.textContent = '● 已同步 D1 '+new Date().toLocaleTimeString(); status.className='badge badge-emerald'; status.style.padding='6px 12px'; }
      if(liveBadge){ liveBadge.textContent = '● D1 已連接 '+data.raw_text.length+' 字'; liveBadge.style.background='rgba(16,185,129,0.2)'; liveBadge.style.borderColor='rgba(16,185,129,0.3)'; liveBadge.style.color='#6ee7b7'; }
    }else{
      const saved = safeGet('roman_schedule_raw');
      if(saved && saved.length>100){
        document.getElementById('scheduleInput').value = saved;
        logSync('從本地載入 '+saved.length+' 字', '本地');
      }
      if(badge){ badge.textContent = '⚠️ Worker 無資料'; badge.className='badge badge-amber'; }
    }
  }catch(e){
    logSync('初始化錯誤: '+e.message, '錯誤');
    if(badge){ badge.textContent = '❌ 連接失敗'; }
    const saved = safeGet('roman_schedule_raw');
    if(saved) document.getElementById('scheduleInput').value = saved;
  }
  renderSchedule();

  document.getElementById('btnSyncD1').onclick = async ()=>{
    const text = document.getElementById('scheduleInput').value;
    const btn = document.getElementById('btnSyncD1');
    const orig = btn.innerHTML;
    btn.innerHTML = '⏳ 同步中...'; btn.disabled=true;
    try{
      safeSet('roman_schedule_raw', text);
      logSync('正在同步到 Worker D1...', '手動');
      const result = await pushWorkerSchedule(text);
      if(result && result.success){
        logSync('✅ 已同步 '+text.length+' 字', '手動');
        document.getElementById('syncStatus').textContent = '● 已同步 D1 '+new Date().toLocaleTimeString();
        renderSchedule();
      }else{ logSync('❌ 同步失敗', '錯誤'); }
    }catch(e){ logSync('失敗: '+e.message, '錯誤'); }
    finally{ btn.innerHTML=orig; btn.disabled=false; }
  };
  document.getElementById('btnReloadWorker').onclick = async ()=>{
    const btn = document.getElementById('btnReloadWorker');
    const orig = btn.innerHTML;
    btn.innerHTML='⏳ 載入中...';
    try{
      const data = await fetchWorkerSchedule();
      if(data && data.raw_text){
        document.getElementById('scheduleInput').value = data.raw_text;
        safeSet('roman_schedule_raw', data.raw_text);
        logSync('✅ 已重新載入 '+data.raw_text.length+' 字', 'Worker D1');
        renderSchedule();
      }
    }catch(e){ logSync('載入失敗: '+e.message, '錯誤'); }
    finally{ btn.innerHTML=orig; }
  };
  document.getElementById('btnReload').onclick = ()=>location.reload();
  document.getElementById('btnCopy').onclick = async ()=>{
    try{ await navigator.clipboard.writeText(document.getElementById('scheduleInput').value); logSync('已複製', '系統'); }catch{ logSync('複製失敗', '錯誤'); }
  };
  document.getElementById('scheduleInput').addEventListener('input', ()=>{ renderSchedule(); document.getElementById('syncStatus').textContent='○ 未同步'; document.getElementById('syncStatus').className='badge badge-amber'; document.getElementById('syncStatus').style.padding='6px 12px'; });
  document.getElementById('searchInput').addEventListener('input', (e)=>{ searchQuery=e.target.value; renderSchedule(); });
  
  // 橫式自動收合控制面板，露出重要數值
  const mqLandscape = window.matchMedia('(orientation: landscape) and (max-height: 600px)');
  function handleLandscape(mq){
    if(mq.matches && controlBody && toggleBtn){
      // 橫式預設收合，讓數值不被遮住，使用者需要再展開
      if(!controlBody.classList.contains('collapsed')){
        // 不自動收合，避免干擾，但確保按鈕可見
      }
    }
  }
  handleLandscape(mqLandscape);
  mqLandscape.addEventListener('change', handleLandscape);
}
init();
</script>
</body>
</html>
`;

export default {
  async fetch(request, env, ctx){
    const url = new URL(request.url);
    const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
    if(request.method==='OPTIONS') return new Response(null,{headers:cors});
    const hasD1 = env && env.ROMAN_DB && typeof env.ROMAN_DB.prepare==='function';

    if(url.pathname==='/api/schedule' && request.method==='GET'){
      try{
        if(!hasD1){
          return new Response(JSON.stringify({raw_text: memoryStore.raw_text, parsed:[], updated_at: memoryStore.updated_at, updated_by:'memory', warning:'D1未綁定'}),{headers:{...cors,'Content-Type':'application/json'}});
        }
        try{
          const r = await env.ROMAN_DB.prepare('SELECT * FROM roman_schedule ORDER BY updated_at DESC LIMIT 1').first();
          if(r) return new Response(JSON.stringify({raw_text:r.raw_text, parsed: r.parsed ? JSON.parse(r.parsed) : [], updated_at:r.updated_at, updated_by:r.updated_by, source:r.source}),{headers:{...cors,'Content-Type':'application/json'}});
        }catch(e){
          const r = await env.ROMAN_DB.prepare('SELECT id, raw_text, updated_at, updated_by, source FROM roman_schedule ORDER BY updated_at DESC LIMIT 1').first();
          if(r) return new Response(JSON.stringify({raw_text:r.raw_text, parsed:[], updated_at:r.updated_at, updated_by:r.updated_by, source:r.source}),{headers:{...cors,'Content-Type':'application/json'}});
        }
        return new Response(JSON.stringify({raw_text:'', parsed:[]}),{headers:{...cors,'Content-Type':'application/json'}});
      }catch(e){ return new Response(JSON.stringify({error:e.message}),{status:500, headers:cors}); }
    }

    if(url.pathname==='/api/schedule' && request.method==='POST'){
      try{
        const body = await request.json();
        const raw_text = body.raw_text || body.text || '';
        if(!raw_text.trim()) return new Response(JSON.stringify({error:'raw_text required'}),{status:400, headers:cors});
        const id = 'web_' + Date.now();
        if(!hasD1){
          memoryStore = {raw_text, updated_at: new Date().toLocaleString('zh-TW'), updated_by:'memory'};
          return new Response(JSON.stringify({success:true, id, hasD1:false}),{headers:{...cors,'Content-Type':'application/json'}});
        }
        await insertSchedule(env.ROMAN_DB, id, raw_text, body.updated_by||'v401_ui', body.source||'v401_responsive');
        try{ await env.ROMAN_DB.prepare('INSERT INTO sync_logs (type, source, payload) VALUES (?, ?, ?)').bind('schedule_update', body.source||'v401', raw_text.slice(0,200)).run(); }catch{}
        return new Response(JSON.stringify({success:true, id, hasD1:true}),{headers:{...cors,'Content-Type':'application/json'}});
      }catch(e){ return new Response(JSON.stringify({error:e.message}),{status:500, headers:cors}); }
    }

    if(url.pathname==='/webhook/line' && request.method==='POST'){
      try{
        const body = await request.json();
        const events = body.events || [];
        for(let ev of events){
          if(ev.type==='message' && ev.message.type==='text'){
            const text = ev.message.text;
            if(text.length > 20 && (text.includes('太原') || text.includes('日進') || text.includes('日新') || text.includes('-') || text.includes('---------------'))){
              const id = 'line_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
              if(hasD1){
                await insertSchedule(env.ROMAN_DB, id, text, ev.source.userId || 'line_user', 'line_bot');
                try{ await env.ROMAN_DB.prepare('INSERT INTO sync_logs (type, source, payload) VALUES (?, ?, ?)').bind('line_update', ev.source.userId||'line', text.slice(0,200)).run(); }catch{}
              }else{
                memoryStore = {raw_text:text, updated_at: new Date().toLocaleString('zh-TW'), updated_by:'line'};
              }
              if(env.LINE_CHANNEL_TOKEN && ev.replyToken){
                try{
                  await fetch('https://api.line.me/v2/bot/message/reply',{
                    method:'POST',
                    headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.LINE_CHANNEL_TOKEN},
                    body: JSON.stringify({replyToken: ev.replyToken, messages:[{type:'text', text: `✅ 已同步到 D1 ${text.length} 字\n${text.split('\n')[0]}...`} ]})
                  });
                }catch{}
              }
            }
          }
        }
        return new Response('OK',{headers:cors});
      }catch(e){ return new Response(JSON.stringify({error:e.message}),{status:500, headers:cors}); }
    }

    // 根路徑直接回 v401 三版型 UI
    if(url.pathname==='/' || url.pathname==='/index.html'){
      return new Response(V401_HTML,{headers:{'Content-Type':'text/html; charset=utf-8', ...cors}});
    }

    return new Response('Roman Worker v401 OK - /api/schedule /webhook/line',{headers:cors});
  }
};
