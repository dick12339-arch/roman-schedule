// Roman Schedule Worker v4.0 - LINE + D1 + UI + Chrome相容 + 舊表相容
// GitHub Sync Version v4.0.1 - 自動部署版
// 合併 v3.9.3 相容舊表 + v3.9.0 LINE Webhook + v3.9.9 UI
// 解決：D1_ERROR: table roman_schedule has no column named parsed

let memoryStore = { raw_text: '', updated_at: '', updated_by: 'memory' };

function parseScheduleText(text){
  const blocks = text.split(/[-]+\n/).map(b=>b.trim()).filter(Boolean);
  const result = [];
  for(let block of blocks){
    const lines = block.split("\n").map(l=>l.trim()).filter(Boolean);
    if(!lines.length) continue;
    const first = lines[0];
    const m = first.match(/^([^\d]+?)(\d{1,2})(?:[:：]?(\d{0,2}))?[-—](\d{1,2})(.*)$/);
    if(!m) continue;
    result.push({name: m[1].trim(), start: parseInt(m[2]), end: parseInt(m[4]), location: m[5]||'', bookings: lines.slice(1)});
  }
  return result;
}

async function insertSchedule(db, id, raw_text, updated_by, source){
  // 相容舊表：先嘗試含 parsed，失敗則不含 parsed
  try{
    await db.prepare('INSERT INTO roman_schedule (id, raw_text, parsed, updated_at, updated_by, source) VALUES (?, ?, ?, datetime("now"), ?, ?)').bind(id, raw_text, JSON.stringify([]), updated_by, source).run();
    return true;
  }catch(e){
    if(e.message.includes('no column named parsed') || e.message.includes('no such column')){
      await db.prepare('INSERT INTO roman_schedule (id, raw_text, updated_at, updated_by, source) VALUES (?, datetime("now"), ?, ?)').bind(id, raw_text, updated_by, source).run();
      return true;
    }
    throw e;
  }
}

export default {
  async fetch(request, env, ctx){
    const url = new URL(request.url);
    const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
    if(request.method==='OPTIONS') return new Response(null,{headers:cors});
    const hasD1 = env && env.ROMAN_DB && typeof env.ROMAN_DB.prepare==='function';

    // GET /api/schedule - 給獨立站 + 主系統
    if(url.pathname==='/api/schedule' && request.method==='GET'){
      try{
        if(!hasD1){
          return new Response(JSON.stringify({raw_text: memoryStore.raw_text, parsed:[], updated_at: memoryStore.updated_at, updated_by:'memory', warning:'D1未綁定'}),{headers:{...cors,'Content-Type':'application/json'}});
        }
        try{
          const r = await env.ROMAN_DB.prepare('SELECT * FROM roman_schedule ORDER BY updated_at DESC LIMIT 1').first();
          if(r) return new Response(JSON.stringify({raw_text:r.raw_text, parsed: r.parsed ? JSON.parse(r.parsed) : [], updated_at:r.updated_at, updated_by:r.updated_by, source:r.source}),{headers:{...cors,'Content-Type':'application/json'}});
        }catch(e){
          // 舊表無 parsed 欄位
          const r = await env.ROMAN_DB.prepare('SELECT id, raw_text, updated_at, updated_by, source FROM roman_schedule ORDER BY updated_at DESC LIMIT 1').first();
          if(r) return new Response(JSON.stringify({raw_text:r.raw_text, parsed:[], updated_at:r.updated_at, updated_by:r.updated_by, source:r.source, warning:'舊表無 parsed，已相容'}),{headers:{...cors,'Content-Type':'application/json'}});
        }
        return new Response(JSON.stringify({raw_text:'', parsed:[]}),{headers:{...cors,'Content-Type':'application/json'}});
      }catch(e){ return new Response(JSON.stringify({error:e.message}),{status:500, headers:cors}); }
    }

    // POST /api/schedule - 主系統 / 獨立站同步
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
        await insertSchedule(env.ROMAN_DB, id, raw_text, body.updated_by||'worker_ui', body.source||'worker_ui');
        try{ await env.ROMAN_DB.prepare('INSERT INTO sync_logs (type, source, payload) VALUES (?, ?, ?)').bind('schedule_update', body.source||'worker_ui', raw_text.slice(0,200)).run(); }catch{}
        return new Response(JSON.stringify({success:true, id, hasD1:true}),{headers:{...cors,'Content-Type':'application/json'}});
      }catch(e){ return new Response(JSON.stringify({error:e.message}),{status:500, headers:cors}); }
    }

    // POST /webhook/line - LINE 私訊更新 D1 (核心)
    if(url.pathname==='/webhook/line' && request.method==='POST'){
      try{
        const body = await request.json();
        const events = body.events || [];
        for(let ev of events){
          if(ev.type==='message' && ev.message.type==='text'){
            const text = ev.message.text;
            // 只有像班表的文字才同步，避免閒聊誤同步
            if(text.length > 20 && (text.includes('太原') || text.includes('日進') || text.includes('日新') || text.includes('-') || text.includes('---------------'))){
              const id = 'line_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
              if(hasD1){
                await insertSchedule(env.ROMAN_DB, id, text, ev.source.userId || 'line_user', 'line_bot');
                try{ await env.ROMAN_DB.prepare('INSERT INTO sync_logs (type, source, payload) VALUES (?, ?, ?)').bind('line_update', ev.source.userId||'line', text.slice(0,200)).run(); }catch{}
              }else{
                memoryStore = {raw_text:text, updated_at: new Date().toLocaleString('zh-TW'), updated_by:'line'};
              }
              // 可選回覆 LINE
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
      }catch(e){ console.error('LINE webhook error', e); return new Response(JSON.stringify({error:e.message}),{status:500, headers:cors}); }
    }

    if(url.pathname==='/api/bookings' && request.method==='GET'){
      try{
        if(!hasD1) return new Response(JSON.stringify([]),{headers:{...cors,'Content-Type':'application/json'}});
        const r = await env.ROMAN_DB.prepare('SELECT * FROM bookings ORDER BY created_at DESC LIMIT 100').all();
        return new Response(JSON.stringify(r.results||[]),{headers:{...cors,'Content-Type':'application/json'}});
      }catch(e){ return new Response(JSON.stringify({error:e.message}),{status:500, headers:cors}); }
    }

    // UI
    if(url.pathname==='/' && request.method==='GET'){
      const html = `<!DOCTYPE html>
<html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Roman Worker v4.0 LINE+D1</title><script src="https://cdn.tailwindcss.com"></script></head>
<body class="min-h-screen bg-[#fafaf9]"><div class="max-w-[900px] mx-auto p-4">
<div class="bg-white border rounded-[20px] p-6">
<h1 class="font-bold flex items-center gap-2">🌐 Roman Worker <span class="text-[10px] px-2 py-1 bg-zinc-900 text-white rounded-full">v4.0 LINE+D1+舊表相容</span> <span id="d1Badge" class="text-[10px] px-2 py-1 bg-zinc-100 rounded-full">檢查中</span></h1>
<div class="mt-2 text-[11px] text-zinc-500">LINE → /webhook/line → D1 → 獨立站/主系統自動同步 (15秒輪詢)</div>
<textarea id="scheduleInput" class="w-full h-[360px] mt-3 rounded-[12px] bg-zinc-50 border p-3 text-[11px] font-mono" placeholder="22\n23\n24"></textarea>
<div class="flex gap-2 mt-3"><button id="btnSync" class="flex-1 h-[44px] bg-zinc-900 text-white rounded-[12px] font-bold">💾 同步到 D1 + 主系統 + 獨立站</button><button id="btnLoad" class="h-[44px] px-4 border rounded-[12px]">⬇️ 從 D1 載入</button></div>
<div class="mt-3 grid grid-cols-2 gap-3">
<div class="bg-[#fafaf9] border rounded-[12px] p-3"><div class="text-[11px] font-bold">目前 D1 最新</div><div id="currentSchedule" class="text-[10px] font-mono text-zinc-500 max-h-[120px] overflow-auto whitespace-pre-wrap">載入中...</div><div id="currentMeta" class="text-[10px] text-zinc-400 mt-1"></div></div>
<div class="bg-white border rounded-[12px] p-3"><div class="text-[11px] font-bold">同步日誌 / LINE Webhook</div><div id="syncLog" class="text-[10px] font-mono max-h-[120px] overflow-auto"></div><div class="text-[10px] text-zinc-400 mt-2">LINE Webhook URL: <b>/webhook/line</b><br>到 LINE Developers 貼上 https://roman-schedule.yunyunspa.workers.dev/webhook/line</div></div>
</div></div></div>
<script>
const WORKER_URL = location.origin;
function log(m){const el=document.getElementById('syncLog');const d=document.createElement('div');d.innerHTML='<span class="text-zinc-400">'+new Date().toLocaleTimeString()+'</span> '+m;el.prepend(d);}
async function loadFromD1(){try{document.getElementById('d1Badge').textContent='載入中...';const res=await fetch(WORKER_URL+'/api/schedule');const data=await res.json();const badge=document.getElementById('d1Badge');if(data.raw_text){document.getElementById('currentSchedule').textContent=data.raw_text.slice(0,800);document.getElementById('currentMeta').textContent=(data.updated_at||'')+' · '+(data.updated_by||'');document.getElementById('scheduleInput').value=data.raw_text;badge.textContent='✅ D1 已綁定 '+data.raw_text.length+' 字';badge.className='text-[10px] px-2 py-1 bg-emerald-500 text-white rounded-full';log('✅ 已載入 '+data.raw_text.length+' 字');}else{document.getElementById('currentSchedule').textContent='D1 無資料';badge.textContent='✅ 已連接';}}catch(e){log('載入失敗 '+e.message);}}
async function syncToD1(){const text=document.getElementById('scheduleInput').value;if(!text.trim()){alert('請貼班表');return;}try{const res=await fetch(WORKER_URL+'/api/schedule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({raw_text:text,source:'worker_ui',updated_by:'yunyunspa_admin'})});const data=await res.json();if(data.success){document.getElementById('currentSchedule').textContent=text.slice(0,800);log('✅ 已同步 '+text.length+' 字');alert('✅ 已同步到 D1，LINE、獨立站、主系統都會更新');loadFromD1();}else throw new Error(data.error);}catch(e){log('失敗 '+e.message);alert('失敗 '+e.message);}}
document.getElementById('btnSync').onclick=syncToD1;document.getElementById('btnLoad').onclick=loadFromD1;loadFromD1();
<\/script></body></html>`;
      return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8', ...cors}});
    }
    return new Response('Roman Worker v4.0 LINE+D1 OK',{headers:cors});
  }
};
