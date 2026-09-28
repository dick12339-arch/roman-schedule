// roman worker v402 - 融合預約回覆版・based on new html upload - lower case
// v403-shared-d1: 與 Roman OS (roman-os.pages.dev /api/roman) 共用同一個 D1 (8719bcb8)
//   寫入時同時更新 roman_data（Roman OS 的正本，id=太原），讀取時取兩張表較新的那份
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

    if(url.pathname==='/api/schedule' && request.method==='GET'){
      try{
        if(!hasD1) return new Response(JSON.stringify({raw_text: memoryStore.raw_text, parsed:[], updated_at: memoryStore.updated_at, updated_by:'memory', warning:'D1未綁定'}),{headers:{...cors,'Content-Type':'application/json'}});
        const r = await readLatestShared(env.ROMAN_DB);
        if(r) return new Response(JSON.stringify(r),{headers:{...cors,'Content-Type':'application/json'}});
        return new Response(JSON.stringify({raw_text:'', parsed:[]}),{headers:{...cors,'Content-Type':'application/json'}});
      }catch(e){ return new Response(JSON.stringify({error:e.message}),{status:500, headers:cors}); }
    }

    if(url.pathname==='/api/schedule' && request.method==='POST'){
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
        await insertSchedule(env.ROMAN_DB, id, raw_text, ub, src);
        try{ await env.ROMAN_DB.prepare('INSERT INTO sync_logs (type, source, payload) VALUES (?, ?, ?)').bind('schedule_update', src, raw_text.slice(0,200)).run(); }catch{}
        return new Response(JSON.stringify({success:true, id, hasD1:true}),{headers:{...cors,'Content-Type':'application/json'}});
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
                await insertSchedule(env.ROMAN_DB, id, text, (ev.source.userId || 'line_user').slice(0,100), 'line_bot');
                try{ await env.ROMAN_DB.prepare('INSERT INTO sync_logs (type, source, payload) VALUES (?, ?, ?)').bind('line_update', (ev.source.userId||'line').slice(0,100), text.slice(0,200)).run(); }catch{}
              }else{
                memoryStore = {raw_text:text, updated_at: new Date().toLocaleString('zh-TW'), updated_by:'line'};
              }
              if(env.LINE_CHANNEL_TOKEN && ev.replyToken){
                try{
                  await fetch('https://api.line.me/v2/bot/message/reply',{
                    method:'POST',
                    headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.LINE_CHANNEL_TOKEN},
                    body: JSON.stringify({replyToken: ev.replyToken, messages:[{type:'text', text: `✅ 已同步到 D1 ${text.length} 字 (v402安全版)\n${text.split('\n')[0]}...`} ]})
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

    return new Response('Roman Worker v406 OK - /api/schedule /webhook/line',{headers:cors});
  }
};
