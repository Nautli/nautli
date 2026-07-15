import { BRAND } from "../brand.js";

export const HTML = `<!doctype html>
<html lang="ko" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${BRAND}</title>
<script>
(function(){var mode="dark";try{var stored=localStorage.getItem("nautli-theme");if(stored==="dark"||stored==="light"||stored==="system")mode=stored;}catch(error){}var systemDark=typeof window.matchMedia==="function"&&window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.dataset.theme=mode==="system"?(systemDark?"dark":"light"):mode;}());
</script>
<style>
:root{
  color-scheme:dark;
  --background:#0a0a0a;
  --foreground:#fafafa;
  --card:#171717;
  --sidebar:#171717;
  --sidebar-border:rgb(255 255 255 / .07);
  --primary:#e5e5e5;
  --primary-foreground:#171717;
  --secondary:#262626;
  --muted:#262626;
  --accent:#404040;
  --muted-foreground:#a1a1a1;
  --border:rgb(255 255 255 / .07);
  --input:rgb(255 255 255 / .15);
  --ring:#737373;
  --destructive:#ff6568;
  --status-success:#86efac;
  --status-warning:#fbbf24;
  --ai-action-accent:#a78bfa;
  --graph-edge:rgb(255 255 255 / .07);
  --graph-node:#a1a1a1;
  --graph-hub:#e5e5e5;
  --graph-superseded:#a78bfa;
  --graph-contradiction:#ff6568;
  --graph-duplicate:#fbbf24;
  --radius-lg:.625rem;
  --radius-md:.5rem;
  --radius-sm:.375rem;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans KR",sans-serif;
  color:var(--foreground);
  background:var(--background);
  font-size:14px
}
:root[data-theme="light"]{
  color-scheme:light;
  --background:#fff;
  --foreground:#0a0a0a;
  --card:#fff;
  --sidebar:#fafafa;
  --sidebar-border:#e5e5e5;
  --primary:#171717;
  --primary-foreground:#fafafa;
  --secondary:#f5f5f5;
  --muted:#f5f5f5;
  --accent:#f5f5f5;
  --muted-foreground:#737373;
  --border:#e5e5e5;
  --input:#e5e5e5;
  --ring:#a1a1a1;
  --destructive:#e40014;
  --status-success:#15803d;
  --status-warning:#f59e0b;
  --ai-action-accent:#8b5cf6;
  --graph-edge:#e5e5e5;
  --graph-node:#737373;
  --graph-hub:#171717;
  --graph-superseded:#8b5cf6;
  --graph-contradiction:#e40014;
  --graph-duplicate:#f59e0b
}
*{box-sizing:border-box}
body{margin:0;background:var(--background);color:var(--foreground);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans KR",sans-serif}
button,input,select,textarea{font:inherit}
button{cursor:pointer}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.shell{min-height:100vh;display:grid;grid-template-columns:200px minmax(0,1fr)}
.sidebar{position:sticky;top:0;height:100vh;z-index:5;background:var(--sidebar);border-right:1px solid var(--sidebar-border);display:flex;flex-direction:column}
.top{background:var(--sidebar)}
.header{min-height:88px;padding:24px 20px 14px;display:flex;flex-direction:column;align-items:flex-start;gap:10px}
.brand{font-size:20px;font-weight:700;letter-spacing:-.01em}
.health{display:flex;align-items:center;gap:8px;color:var(--muted-foreground);font-size:12px}
.dot{width:8px;height:8px;border-radius:999px;background:var(--muted-foreground)}
.dot.ok{background:var(--status-success)}
.dot.warn{background:var(--status-warning)}
.dawn{height:2px;background:var(--ai-action-accent);transform-origin:left;transition:transform .3s ease}
.dawn.off{background:none;border-top:1px dashed var(--sidebar-border)}
.nav{padding:10px;display:flex;flex-direction:column;gap:3px}
.nav button{width:100%;border:0;background:transparent;color:var(--muted-foreground);padding:9px 10px;border-radius:var(--radius-sm);text-align:left}
.nav button:hover{background:color-mix(in srgb,var(--accent) 25%,transparent);color:var(--foreground)}
.nav button.active{color:var(--foreground);background:var(--secondary)}
.theme-toggle{display:flex;align-items:center;gap:7px;margin:auto 10px 12px;border:0;border-radius:var(--radius-sm);background:transparent;color:var(--muted-foreground);padding:7px 10px;font-size:12px;line-height:1.4;text-align:left;white-space:nowrap}
.theme-toggle:hover{background:color-mix(in srgb,var(--accent) 25%,transparent);color:var(--foreground)}
.badge{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--border);border-radius:999px;padding:2px 7px;color:var(--muted-foreground);font-size:12px;white-space:nowrap}
.nav .badge{margin-left:4px;color:inherit}
.badge.review-warn{border-color:color-mix(in srgb,var(--destructive) 35%,var(--border));color:var(--destructive)}
.badge.status-dead{color:var(--muted-foreground);border-style:dashed}
.badge.status-connected{border-color:color-mix(in srgb,var(--status-success) 25%,transparent);background:color-mix(in srgb,var(--status-success) 10%,transparent);color:var(--status-success)}
.badge.status-installed{color:var(--foreground)}
.page{width:100%;max-width:860px;margin:0 auto;padding:32px 32px 64px}
.page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:24px}
.page h1{font-size:20px;font-weight:600;letter-spacing:-.01em;line-height:1.3;margin:0}
.lead{color:var(--muted-foreground);margin:6px 0 0}
.hero{margin-bottom:8px}
.hero h1{font-size:24px;font-weight:700;letter-spacing:-.02em;line-height:1.3;margin:0}
.hero .lead{max-width:520px}
.hero-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}
.microcopy{color:var(--muted-foreground);font-size:12px}
.progress-row{display:flex;align-items:center;gap:14px;margin:28px 0 12px}
.progress-row .section-title{margin:0;white-space:nowrap}
.progress{flex:1;height:4px;background:var(--muted);border-radius:999px;overflow:hidden}
.progress i{display:block;height:100%;background:var(--ai-action-accent);border-radius:999px;transition:width .3s ease}
.section-title{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted-foreground);margin:28px 0 12px}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px;margin-bottom:12px}
.step{display:grid;grid-template-columns:24px 1fr auto;gap:12px;align-items:center}
.step.next{border-color:var(--ring)}
.step.done{padding:10px 20px;background:transparent}
.step.done h2{font-weight:500;color:var(--muted-foreground)}
.state{font-size:18px;color:var(--muted-foreground)}
.state.ok{color:var(--status-success)}
.state.warn{color:var(--status-warning)}
.step h2{font-size:15px;margin:0}
.step p,.muted{color:var(--muted-foreground);margin:4px 0 0;line-height:1.5}
.actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.btn{border:1px solid var(--border);border-radius:var(--radius-md);background:var(--card);color:var(--foreground);padding:9px 12px}
.btn:hover,.btn.selected{background:var(--accent);border-color:var(--input)}
.btn.primary{background:var(--primary);border-color:var(--primary);color:var(--primary-foreground);font-weight:600}
.btn.primary:hover{background:var(--foreground);border-color:var(--foreground)}
.btn.quiet{border-color:transparent;background:transparent;color:var(--muted-foreground);padding:9px 8px}
.btn.quiet:hover{color:var(--foreground);background:var(--accent);border-color:transparent}
.btn.danger:hover{border-color:var(--destructive);color:var(--destructive)}
.btn:disabled{cursor:not-allowed;opacity:.65}
.banner{border-color:color-mix(in srgb,var(--status-success) 25%,transparent);color:var(--status-success);background:color-mix(in srgb,var(--status-success) 10%,transparent)}
.warning{border-color:var(--status-warning);color:var(--status-warning)}
.claim{font:500 15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans KR",sans-serif;margin:8px 0;text-align:left;word-spacing:0;letter-spacing:normal;white-space:normal}
.fact{background:var(--secondary);border:1px solid var(--border);border-radius:var(--radius-md);padding:12px;margin:8px 0}
.meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center;color:var(--muted-foreground);font-size:12px}
.metric-line{display:flex;align-items:baseline;gap:8px;margin-top:12px}
.metric{font-size:2.75rem;font-weight:700;line-height:1;letter-spacing:-.04em}
.metric-label,.stamp{color:var(--muted-foreground)}
details{margin-top:12px;color:var(--muted-foreground)}
summary{cursor:pointer}
.hint{margin-top:8px;color:var(--muted-foreground)}
.field{width:100%;background:var(--background);color:var(--foreground);border:1px solid var(--input);border-radius:var(--radius-md);padding:10px 12px}
.field:focus{outline:1px solid var(--ring);outline-offset:0;border-color:var(--ring)}
textarea.field{min-height:88px;resize:vertical}
.toolbar{display:grid;grid-template-columns:1fr 180px auto;gap:8px;margin-bottom:16px}
.toolbar input[type="checkbox"],.memory-options input,.folder-list input{accent-color:var(--primary)}
.add{display:grid;grid-template-columns:1fr auto;gap:8px}
.summary{color:var(--muted-foreground);font-size:13px;margin:-12px 0 20px}
.memory-row{cursor:pointer}
.memory-row:hover{background:var(--secondary);border-color:var(--input)}
.memory-row.dead{color:var(--muted-foreground)}
.review-card{min-height:320px}
.review-context{display:flex;justify-content:space-between;gap:16px;border-top:1px solid var(--border);margin-top:20px;padding-top:12px;color:var(--muted-foreground);font-size:12px}
.empty{text-align:center;color:var(--muted-foreground);padding:40px 20px}
.empty .actions{justify-content:center;margin-top:16px}
.toast{position:fixed;right:20px;bottom:20px;max-width:420px;background:var(--card);border:1px solid var(--border);border-left:4px solid var(--status-success);border-radius:var(--radius-lg);padding:12px 16px;z-index:20}
.toast.error{border-left-color:var(--destructive)}
.toast .actions{margin-top:8px}
.hidden{display:none!important}
.modal-wrap{position:fixed;inset:0;background:rgb(0 0 0 / .5);display:grid;place-items:center;padding:20px;z-index:15}
.modal{width:min(680px,100%);max-height:80vh;overflow:auto;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px}
.modal pre{white-space:pre-wrap;background:var(--background);border:1px solid var(--border);border-radius:var(--radius-md);padding:16px;font:13px/1.6 "SF Mono",ui-monospace,Menlo,monospace;color:var(--foreground)}
.graph-legend{display:flex;align-items:center;gap:14px;flex-wrap:wrap;color:var(--muted-foreground);font-size:12px;margin-bottom:10px}
.legend-item{display:inline-flex;align-items:center;gap:6px}
.legend-dot{width:7px;height:7px;border-radius:999px;background:var(--graph-node)}
.legend-dot.hub{width:11px;height:11px;background:var(--graph-hub)}
.legend-line{width:18px;height:2px;background:var(--graph-superseded)}
.legend-line.contradiction{background:var(--graph-contradiction)}
.legend-line.duplicate{background:var(--graph-duplicate)}
.graph-stage{position:relative;height:70vh;min-height:420px;background:var(--background);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden}
.graph-canvas{display:block;width:100%;height:100%;cursor:grab}
.graph-canvas.panning{cursor:grabbing}
.graph-tooltip{position:absolute;max-width:280px;pointer-events:none;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:7px 9px;color:var(--foreground);font-size:12px;line-height:1.45}
.graph-note{color:var(--muted-foreground);font-size:12px;margin-top:8px}
.continuity{border-color:var(--ring);padding:24px}
.continuity-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:18px}
.continuity-head h1{font-size:24px}
.continuity-step{border-top:1px solid var(--border);padding:16px 0;display:grid;grid-template-columns:28px 1fr;gap:12px}
.continuity-step:first-of-type{border-top:0}
.continuity-step h2{font-size:15px;margin:0}
.continuity-step .actions{margin-top:10px}
.continuity-number{width:24px;height:24px;display:grid;place-items:center;border:1px solid var(--border);border-radius:999px;color:var(--muted-foreground);font-size:12px}
.continuity-step.active .continuity-number{border-color:var(--ai-action-accent);color:var(--ai-action-accent)}
.continuity-step.skipped{color:var(--muted-foreground)}
.continuity-step.skipped .continuity-number{border-style:dashed}
.memory-options{display:grid;gap:7px;margin:10px 0}
.memory-options label,.folder-list label{display:flex;align-items:center;gap:8px}
.inline-field{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin-top:8px}
.detected{color:var(--status-success)}
.shared-brain{border:1px solid color-mix(in srgb,var(--ai-action-accent) 25%,transparent);background:color-mix(in srgb,var(--ai-action-accent) 10%,transparent);color:var(--foreground);border-radius:var(--radius-md);padding:12px;margin-top:10px}
.folder-list{display:grid;gap:8px;background:var(--secondary);border:1px solid var(--border);border-radius:var(--radius-md);padding:12px;margin-top:12px}
.preflight{border:1px solid var(--border);border-radius:var(--radius-md);padding:12px;margin-top:12px}
.preflight.fail{border-color:var(--status-warning)}
.checkup-teaser{background:var(--secondary);border-left:2px solid var(--ai-action-accent);padding:10px 12px;margin-top:10px}
.share-canvas{display:block;width:100%;height:auto;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--background)}
:root[data-theme="dark"] .preflight:not(.fail),:root[data-theme="dark"] .share-canvas{border-color:rgb(255 255 255 / .12)}
.share-note{flex-basis:100%;color:var(--muted-foreground);font-size:12px}
.agent-rows{display:grid;gap:10px;margin-top:8px}
.agent-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;padding-top:10px;border-top:1px solid var(--border)}
.agent-row:first-child{padding-top:0;border-top:0}
.agent-row-title{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.checklist-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:24px 0 12px}
.checklist-head .section-title{margin:0}
.checklist-detail{margin:0 0 12px 36px}
.checklist-detail .continuity,.checklist-detail>.card{margin-bottom:0}
@media(max-width:720px){
  .shell{display:block}
  .sidebar{position:sticky;height:auto;border-right:0;border-bottom:1px solid var(--sidebar-border)}
  .top{display:flex;align-items:center}
  .header{min-height:52px;padding:10px 130px 10px 14px;flex:1;flex-direction:row;align-items:center;justify-content:space-between}
  .brand{font-size:18px}
  .dawn{align-self:stretch;width:2px;height:auto}
  .nav{padding:6px 8px;flex-direction:row;overflow:auto}
  .nav button{width:auto;flex:0 0 auto;text-align:center}
  .theme-toggle{position:absolute;top:8px;right:8px;margin:0}
  .page{padding:24px 16px 48px}
  .step{grid-template-columns:24px 1fr}
  .step .actions{grid-column:2}
  .step.done{padding:12px 20px}
  .step.done .actions:empty{display:none}
  .agent-row{grid-template-columns:1fr}
  .checklist-detail{margin-left:0}
  .toolbar,.add,.inline-field{grid-template-columns:1fr}
  .review-context{flex-direction:column;gap:4px}
  .graph-stage{height:65vh;min-height:360px}
  .continuity-head{display:block}
}
</style>
</head>
<body>
<div class="shell">
  <aside class="sidebar"><header class="top"><div class="header"><div class="brand">${BRAND}</div><div id="health" class="health hidden"><span id="health-dot" class="dot"></span><span id="health-label"></span></div></div><div id="dawn" class="dawn off"></div></header>
  <nav class="nav" aria-label="대시보드"><button data-tab="setup">설정</button><button data-tab="graph">그래프</button><button data-tab="review">카드 <span id="pending-badge" class="badge hidden">0</span></button><button data-tab="memory">기억</button></nav><button id="theme-toggle" class="theme-toggle" type="button"><span aria-hidden="true">◐</span><span>테마: 다크</span></button></aside>
  <main id="app" class="page"><div class="page-head"><div><h1>${BRAND}</h1><p class="lead">로컬 상태를 확인하고 있어요…</p></div></div></main>
</div>
<div id="toast" class="toast hidden" role="status"></div>
<div id="modal" class="modal-wrap hidden" role="dialog" aria-modal="true"><div class="modal"><div class="page-head"><div><h1 id="modal-title">미리보기</h1><p id="modal-lead" class="lead"></p></div><button class="btn" data-close-modal>닫기</button></div><pre id="preview"></pre><div id="modal-body" class="hidden"></div><textarea id="manual-copy" class="field hidden" aria-label="수동 복사할 지시문" readonly></textarea><div id="modal-actions" class="actions"></div></div></div>
<script>
(function(){
  "use strict";
  var TABS=["setup","graph","review","memory"];
  var initialTab=location.hash.slice(1);var state={status:null,statusError:null,tab:TABS.includes(initialTab)?initialTab:"setup",cards:[],cardsLoaded:false,memory:[],memoryLoaded:false,memoryLoading:false,memoryError:null,memoryQuery:"",memoryScope:"",includeDead:false,graph:null,graphLoaded:false,graphLoading:false,graphError:null,graphCleanup:null,statusTimer:null,digesting:false,checkup:null,checkupError:null,checkupTimer:null,checkupPath:"",checkupPreflight:null,continuityTimer:null,continuityPolling:false,continuity:null,shareCard:null,scan:null,scanLoading:false,scanError:null,scanErrorToastShown:false,scanAutoRefreshAttempted:false,checklistOpen:"",checklistExpanded:false};
  try{state.continuity=JSON.parse(localStorage.getItem("nautli-continuity")||"null");}catch(error){}
  if(!state.continuity)state.continuity={choice:"나는 커밋 메시지를 한국어로 쓴다",custom:"",a:"ready",b:"locked",c:"ready",factId:"",factClaim:"",since:"",crossSince:"",recalled:null,candidate:null,ignoredCandidate:""};
  if(state.continuity.candidate===undefined)state.continuity.candidate=null;if(state.continuity.ignoredCandidate===undefined)state.continuity.ignoredCandidate="";
  var app=document.getElementById("app");
  var themeMedia=typeof window.matchMedia==="function"?window.matchMedia("(prefers-color-scheme: dark)"):null;var themeMode="dark";try{var savedTheme=localStorage.getItem("nautli-theme");if(savedTheme==="dark"||savedTheme==="light"||savedTheme==="system")themeMode=savedTheme;}catch(error){}
  function applyTheme(persist){var resolved=themeMode==="system"?(themeMedia&&themeMedia.matches?"dark":"light"):themeMode;document.documentElement.dataset.theme=resolved;var toggle=document.getElementById("theme-toggle");var label=themeMode==="dark"?"다크":themeMode==="light"?"라이트":"시스템";if(toggle){toggle.lastElementChild.textContent="테마: "+label;toggle.setAttribute("aria-label","테마: "+label);}if(persist){try{localStorage.setItem("nautli-theme",themeMode);}catch(error){}}window.dispatchEvent(new CustomEvent("nautli-theme-change",{detail:{mode:themeMode,resolved:resolved}}));}
  function cycleTheme(){var themes=["dark","light","system"];themeMode=themes[(themes.indexOf(themeMode)+1)%themes.length];applyTheme(true);}
  function handleSystemThemeChange(){if(themeMode==="system")applyTheme(false);}if(themeMedia){if(typeof themeMedia.addEventListener==="function")themeMedia.addEventListener("change",handleSystemThemeChange);else if(typeof themeMedia.addListener==="function")themeMedia.addListener(handleSystemThemeChange);}applyTheme(false);
  function esc(value){return String(value==null?"":value).replace(/[&<>"']/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch];});}
  function toast(message,error,actionsHtml){var el=document.getElementById("toast");el.innerHTML='<div>'+esc(message)+'</div>'+(actionsHtml?'<div class="actions">'+actionsHtml+'</div>':'');el.className="toast"+(error?" error":"");clearTimeout(toast.timer);if(!actionsHtml)toast.timer=setTimeout(function(){el.classList.add("hidden");},3500);}
  function scopeLabel(scope){return scope==="person"?"개인":scope==="procedure"?"절차":String(scope||"").replace(/^project:/,"프로젝트 ");}
  function openModal(title,lead,preText,actionsHtml,bodyHtml){document.getElementById("modal-title").textContent=title;document.getElementById("modal-lead").textContent=lead;var pre=document.getElementById("preview");pre.textContent=preText;pre.classList.toggle("hidden",!preText);var body=document.getElementById("modal-body");body.innerHTML=bodyHtml||"";body.classList.toggle("hidden",!bodyHtml);document.getElementById("modal-actions").innerHTML=actionsHtml||"";document.getElementById("manual-copy").classList.add("hidden");document.getElementById("modal").classList.remove("hidden");}
  async function copyText(value,message){
    try{await navigator.clipboard.writeText(value);toast(message);return true;}catch(error){}
    try{var temp=document.createElement("textarea");temp.value=value;temp.setAttribute("readonly","");temp.style.position="fixed";temp.style.opacity="0";document.body.appendChild(temp);temp.focus();temp.select();var copied=document.execCommand("copy");temp.remove();if(copied){toast(message);return true;}}catch(error){}
    openModal("직접 복사","자동 복사가 안 되는 환경이에요. 아래 텍스트를 직접 복사해 주세요.","");var fallback=document.getElementById("manual-copy");fallback.value=value;fallback.classList.remove("hidden");fallback.focus();fallback.select();toast("클립보드 복사에 실패했어요. 아래 텍스트를 직접 복사해 주세요.",true);return false;
  }
  async function api(url,options){var response=await fetch(url,options);var data=await response.json();if(!response.ok){var error=new Error(data.message||"요청을 처리하지 못했어요.");Object.assign(error,data);throw error;}return data;}
  function post(url,body){return api(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body||{})});}
  function fmt(value){if(!value)return "기록 없음";var date=new Date(value);return Number.isNaN(date.getTime())?String(value):date.toLocaleString("ko-KR");}
  function nextRunMs(daemon){var next=Number(daemon.next_run_ms);var now=Date.now();if(!Number.isFinite(next)){next=new Date(daemon.next_run).getTime();}if(!Number.isFinite(next)){var fallback=new Date();fallback.setHours(3,30,0,0);next=fallback.getTime();}var date=new Date(next);while(date.getTime()<=now)date.setDate(date.getDate()+1);return date.getTime();}
  function sampleState(){var optional=state.status&&state.status.setup.optional;return (optional&&optional.sample)||{complete:false};}
  function scanAgents(){return state.scan&&Array.isArray(state.scan.agents)?state.scan.agents:[];}
  function agentLabel(name){return {claude:"Claude Code",codex:"Codex",cursor:"Cursor",gemini:"Gemini"}[name]||name;}
  function detectedAgents(){return scanAgents().filter(function(agent){return agent.installed===true;});}
  function detectedLine(suffix){var agents=detectedAgents();return "감지된 AI "+agents.length+"개"+(agents.length?" · "+agents.map(function(agent){return agentLabel(agent.name);}).join(", "):"")+(suffix?" · "+suffix:"");}
  function scanFailure(message){state.scanError=message||"AI 사용량을 감지하지 못했어요. 다시 시도해 주세요.";if(!state.scanErrorToastShown){state.scanErrorToastShown=true;toast(state.scanError,true);}if(state.tab==="setup"&&state.status)setupView();}
  async function refreshStaleScan(){if(state.scanAutoRefreshAttempted)return;state.scanAutoRefreshAttempted=true;state.scanLoading=true;try{var result=await post("/api/scan");if(result.ok===false)throw new Error(result.reason||"AI 사용량을 감지하지 못했어요. 다시 시도해 주세요.");state.scan=result;state.scanError=null;state.scanErrorToastShown=false;}catch(error){state.scanError=error.message||"AI 사용량을 감지하지 못했어요. 다시 시도해 주세요.";}finally{state.scanLoading=false;if(state.tab==="setup"&&state.status)setupView();}}
  async function loadScan(){if(state.scanLoading)return;state.scanLoading=true;var refresh=false;try{var result=await api("/api/scan");if(result.ok===false){scanFailure(result.reason);return;}state.scan=result;state.scanError=null;state.scanErrorToastShown=false;refresh=result.stale===true&&Boolean(result.usage)&&!state.scanAutoRefreshAttempted;}catch(error){scanFailure(error.message);}finally{state.scanLoading=false;if(state.tab==="setup"&&state.status)setupView();}if(refresh)void refreshStaleScan();}
  async function runUsageScan(button){if(state.scanLoading)return;state.scanLoading=true;state.scanError=null;state.scanErrorToastShown=false;var old=button.textContent;button.disabled=true;button.textContent="감지 중…";try{var result=await post("/api/scan");if(result.ok===false){scanFailure(result.reason);return;}state.scan=result;state.scanError=null;}catch(error){scanFailure(error.message);}finally{state.scanLoading=false;if(state.tab==="setup"&&state.status)setupView();if(button.isConnected){button.disabled=false;button.textContent=old;}}}
  function setupHero(){var title="모든 AI가 공유하는 하나의 뇌";var lead=state.scanError?detectedLine(""):state.scan?detectedLine(""):"AI를 감지하고 있어요…";var usage=state.scan&&state.scan.usage;var remembered=Number(state.scan&&state.scan.remembered||0);if(usage){var claude=Number(usage.claude_sessions30d||0);var codex=Number(usage.codex_sessions30d||0);var total=claude+codex;if(total>=10){title="최근 30일 Claude "+claude+"·Codex "+codex+" 세션 · nautli에 기억된 건 "+remembered+"개";lead=remembered===0?"다음 대화부터는 여기 남아요.":total+"세션에서 "+remembered+"개를 기억했어요.";}else{title="감지된 AI "+detectedAgents().length+"개 · 연결하면 여기서부터 기억돼요.";lead=remembered===0?"다음 대화부터는 여기 남아요.":"기억 "+remembered+"개가 쌓여 있어요.";}}
    var label=state.scanError?"다시 감지":usage?"다시 확인하기":"내 AI 사용량 확인하기";return '<div class="hero"><h1>'+esc(title)+'</h1><p class="lead">'+esc(lead)+'</p><div class="hero-actions"><button class="btn quiet" data-scan-usage '+(state.scanLoading?'disabled':'')+'>'+label+'</button><span class="microcopy">로컬에서만 · 파일 목록과 수정 시각만 · 네트워크 요청 0회</span></div></div>';}
  async function maybeShowStarNag(){if(state.status&&state.status.star_nag_shown_at)return false;try{var result=await post("/api/star-nag-seen");if(!result.recorded)return false;toast("첫 카드 처리 완료. nautli가 쓸만하면 별 하나 주세요",false,'<button class="btn primary" data-star-github>GitHub 열기</button><button class="btn quiet" data-star-later>나중에</button>');return true;}catch(error){return false;}}
  function saveContinuity(){try{localStorage.setItem("nautli-continuity",JSON.stringify(state.continuity));}catch(error){}}
  function ensureContinuitySince(){if(state.continuity.since)return;state.continuity.since=new Date(Date.now()-1000).toISOString();saveContinuity();}
  function continuityClaim(){return state.continuity.choice==="custom"?state.continuity.custom.trim():state.continuity.choice;}
  function normalizeContinuityClaim(value){return String(value||"").trim().replace(/\\s+/g," ").replace(/[.。]/g,"");}
  function continuityClaimsMatch(leftValue,rightValue){var left=normalizeContinuityClaim(leftValue);var right=normalizeContinuityClaim(rightValue);return Boolean(left&&right&&(left===right||left.includes(right)||right.includes(left)));}
  function continuityCandidateKey(item){return String(item.fact_id||"")+"|"+String(item.at||"");}
  function continuityWaitCopy(){var elapsed=Math.max(0,Date.now()-Date.parse(state.continuity.since||new Date().toISOString()));if(elapsed<15000)return "붙여넣으셨나요?";if(elapsed<60000)return "Claude가 응답하면 자동으로 감지됩니다";return 'Claude가 문장을 다듬어 저장했을 수 있어요. 위 후보가 없다면 MCP 연결을 진단해 보세요. <button class="btn quiet" data-copy="nautli doctor">진단 실행</button>';}
  function updateContinuityWait(){var el=document.getElementById("continuity-wait");if(el)el.innerHTML=continuityWaitCopy();}
  function stopContinuityPolling(){clearTimeout(state.continuityTimer);state.continuityTimer=null;state.continuityPolling=false;}
  function ensureContinuityPolling(){if(state.continuityPolling)return;var kind=state.continuity.a==="ready"||state.continuity.a==="waiting"?"remember":state.continuity.c==="waiting"?"recall":null;if(!kind){stopContinuityPolling();return;}state.continuityPolling=true;void pollContinuity(kind);}
  async function pollContinuity(kind){var waiting=kind==="remember"?(state.continuity.a==="ready"||state.continuity.a==="waiting"):state.continuity.c==="waiting";if(!waiting){stopContinuityPolling();return;}clearTimeout(state.continuityTimer);state.continuityTimer=null;var since=kind==="remember"?state.continuity.since:state.continuity.crossSince;try{var data=await api("/api/activity?since="+encodeURIComponent(since));waiting=kind==="remember"?(state.continuity.a==="ready"||state.continuity.a==="waiting"):state.continuity.c==="waiting";if(!waiting){stopContinuityPolling();return;}var targetClaim=state.continuity.factClaim||continuityClaim();var match=data.events.find(function(item){if(item.source!=="mcp")return false;if(kind==="remember")return item.type==="remember"&&continuityClaimsMatch(item.claim,targetClaim);return item.type==="recall"&&Array.isArray(item.hits)&&item.hits.includes(state.continuity.factId);});if(match){if(kind==="remember"){state.continuity.a="done";state.continuity.b="ready";state.continuity.factId=match.fact_id;state.continuity.factClaim=match.claim;state.continuity.factResult=match.result||"added";state.continuity.candidate=null;state.continuity.ignoredCandidate="";}else state.continuity.c="done";saveContinuity();stopContinuityPolling();if(state.tab==="setup")setupView();return;}if(kind==="remember"){var candidates=data.events.filter(function(item){return item.source==="mcp"&&item.type==="remember";});var candidate=candidates[candidates.length-1];if(candidate&&continuityCandidateKey(candidate)!==state.continuity.ignoredCandidate){var previousKey=state.continuity.candidate?continuityCandidateKey(state.continuity.candidate):"";var nextKey=continuityCandidateKey(candidate);if(previousKey!==nextKey){state.continuity.candidate={fact_id:candidate.fact_id,claim:candidate.claim,result:candidate.result||"added",at:candidate.at};saveContinuity();if(state.tab==="setup")setupView();}}}}catch(error){}
    waiting=kind==="remember"?(state.continuity.a==="ready"||state.continuity.a==="waiting"):state.continuity.c==="waiting";if(!waiting){stopContinuityPolling();return;}updateContinuityWait();state.continuityTimer=setTimeout(function(){state.continuityTimer=null;void pollContinuity(kind);},2000);
  }
  function digestContext(){var daemon=state.status.setup.required.daemon;var result=daemon.health.result||{};var summary=daemon.health.last_run?"마지막 소화 "+fmt(daemon.health.last_run)+" · 적용 "+esc(result.applied||0)+" · 큐 "+esc(result.queued||(result.report&&result.report.pending)||0):"아직 완료된 소화가 없어요";return '<div class="review-context"><span>다음 소화 '+fmt(nextRunMs(daemon))+'</span><span>'+summary+'</span></div>';}
  function setChrome(){
    var pending=state.status?state.status.pending:0;var badge=document.getElementById("pending-badge");badge.textContent=String(pending);badge.classList.toggle("hidden",pending===0);
    document.querySelectorAll("[data-tab]").forEach(function(button){button.classList.toggle("active",button.dataset.tab===state.tab);});
    if(!state.status)return;var daemon=state.status.setup.required.daemon;var health=document.getElementById("health");var dot=document.getElementById("health-dot");var label=document.getElementById("health-label");var dawn=document.getElementById("dawn");
    health.classList.toggle("hidden",!daemon.plist_exists);
    dot.className="dot"+(daemon.health.healthy&&!daemon.health.stale?" ok":daemon.plist_exists?" warn":"");label.textContent=daemon.health.healthy&&!daemon.health.stale?"밤 소화 정상":"밤 소화 확인 필요";
    if(!daemon.plist_exists){dawn.className="dawn off";dawn.style.transform="";["title","role","aria-label","aria-valuemin","aria-valuemax","aria-valuenow"].forEach(function(name){dawn.removeAttribute(name);});}else{dawn.className="dawn";var last=Date.parse(daemon.health.last_run);var next=nextRunMs(daemon);var ratio=Number.isFinite(last)&&next>last?Math.max(0,Math.min(1,(Date.now()-last)/(next-last))):0;var percent=Math.round(ratio*100);dawn.style.transform="scaleX("+ratio+")";dawn.setAttribute("role","progressbar");dawn.setAttribute("aria-label","다음 소화까지의 진행률");dawn.setAttribute("aria-valuemin","0");dawn.setAttribute("aria-valuemax","100");dawn.setAttribute("aria-valuenow",String(percent));dawn.title="마지막 소화부터 다음 소화까지 "+percent+"%";}
  }
  async function loadCheckup(){var previous=state.checkup;var previousJson=previous===null?null:JSON.stringify(previous);var previousError=state.checkupError;try{state.checkup=await api("/api/checkup/status");state.checkupError=null;}catch(error){state.checkupError="상태를 못 읽었어요. 잠시 후 다시 시도합니다";clearTimeout(state.checkupTimer);state.checkupTimer=setTimeout(function(){loadCheckup();},10000);if(state.tab==="setup"&&state.status){var failedSlot=document.getElementById("checkup-slot");if(failedSlot)failedSlot.innerHTML=checkupSlot();else setupView();}return;}
    clearTimeout(state.checkupTimer);
    if(state.checkupWatch&&previous&&previous.state!=="running"&&state.checkup.state==="running"){toast("진단이 시작됐어요. 이 화면에서 진행 상황이 보여요.");state.checkupWatch=null;var modal=document.getElementById("modal");if(modal&&!modal.classList.contains("hidden"))modal.classList.add("hidden");}
    if(state.checkup.state==="running"||(state.checkupWatch&&Date.now()-state.checkupWatch<30*60*1000&&state.checkup.state!=="running")){state.checkupTimer=setTimeout(function(){var before=state.checkup&&state.checkup.state;loadCheckup().then(function(){if(before==="running"&&state.checkup.state==="done")toast("건강검진이 끝났어요. 결과가 설정 탭에 있어요.");});},5000);}
    var changed=previousJson!==JSON.stringify(state.checkup)||previousError!==state.checkupError;if(changed&&state.tab==="setup"&&state.status){if(previous&&previous.state===state.checkup.state){var slot=document.getElementById("checkup-slot");if(slot)slot.innerHTML=checkupSlot();else setupView();}else setupView();}
  }
  function preflightReason(preflight){if(!preflight.python3.available)return "python3가 필요해요.";if(!preflight.claude.cli_exists)return "Claude CLI가 설치되어 있지 않아요.";if(!preflight.claude.logged_in)return "Claude CLI 로그인이 필요해요.";if(preflight.files===0)return "선택한 범위에 진단할 마크다운 노트가 없어요.";return "사전검사가 끝났어요.";}
  function checkupAgentPrompt(){var p=String(state.checkupPath||"").replace(/'/g,"'\\\\''");return 'nautli 기억 건강검진을 돌려줘. 터미널에서 npx nautli checkup \\''+p+'\\' 를 실행하면 진행 로그가 나와. 끝나면 요약 JSON의 중복·모순 건수를 알려주고, report_file 리포트를 읽고 핵심을 짚어줘.';}
  function renderCheckupPreflight(){var target=document.getElementById("checkup-preflight");if(!target)return;var p=state.checkupPreflight;if(!p){target.innerHTML='<div class="preflight muted">폴더를 확인하고 있어요…</div>';document.getElementById("modal-actions").innerHTML='<button class="btn primary" data-checkup-start disabled>진단 시작</button>';return;}var excluded=new Set(p.excluded_dirs||[]);var folders=(p.top_level_dirs||[]).map(function(folder){return '<label><input type="checkbox" data-checkup-dir value="'+esc(folder.name)+'" '+(excluded.has(folder.name)?'':'checked')+'> <span>'+esc(folder.name)+' <span class="badge">노트 '+esc(folder.files)+'개</span></span></label>';}).join("");var reason=preflightReason(p);target.innerHTML='<div class="folder-list"><strong>진단할 최상위 폴더</strong>'+(folders||'<span class="muted">최상위 폴더 없이 루트의 노트만 있어요.</span>')+'</div><div class="preflight '+(p.ok?'':'fail')+'"><strong>'+(p.ok?'시작할 수 있어요':esc(reason))+'</strong><p class="muted">예상 파일 '+esc(p.files)+'개 · 표본 '+esc(p.sampled_files)+'개 · 예상 '+esc(p.estimated_minutes)+'분</p>'+(!p.ok&&p.python3.available&&(!p.claude.cli_exists||!p.claude.logged_in)?'<p class="muted">Claude Code·Codex 같은 AI 에이전트를 쓰고 있다면, 프롬프트를 복사해 그 채팅에 붙여넣으면 대신 돌려줘요.</p>':'')+'</div>';var actions='<button class="btn primary" data-checkup-start '+(p.ok?'':'disabled')+'>진단 시작</button>';if(!p.ok)actions+='<button class="btn'+(p.ok?' quiet':'')+'" data-copy-agent-prompt>내 AI에게 시키기</button>';if(!p.python3.available)actions+='<button class="btn" data-copy="xcode-select --install">python3 설치 명령 복사</button>';else if(!p.claude.cli_exists)actions+='<button class="btn" data-copy="npm install -g @anthropic-ai/claude-code && claude">Claude 설치 명령 복사</button>';else if(!p.claude.logged_in)actions+='<button class="btn" data-copy="claude /login">로그인 명령 복사</button>';if(p.ok)actions+='<button class="btn'+(p.ok?' quiet':'')+'" data-copy-agent-prompt>내 AI에게 시키기</button>';document.getElementById("modal-actions").innerHTML=actions;}
  async function loadCheckupPreflight(path,excluded){if(!path)return;state.checkupPath=path;state.checkupPreflight=null;renderCheckupPreflight();try{state.checkupPreflight=await post("/api/checkup/preflight",{path:path,excluded_dirs:excluded});renderCheckupPreflight();}catch(error){var target=document.getElementById("checkup-preflight");if(target)target.innerHTML='<div class="preflight fail"><strong>'+esc(error.message)+'</strong><p class="muted">폴더 경로와 접근 권한을 확인해 주세요.</p></div>';document.getElementById("modal-actions").innerHTML='<button class="btn primary" data-checkup-start disabled>진단 시작</button>';}}
  var KIND_BADGES={"obsidian":"옵시디언","claude-harness":"Claude 하네스","codex-harness":"Codex 하네스","gemini-harness":"Gemini 하네스","cursor-harness":"Cursor 하네스","shared-memory":"공유 메모리"};
  async function openCheckupModal(){var found=(await api("/api/checkup/candidates")).candidates;state.checkupCandidates=found;state.checkupPath=found[0]?found[0].path:"";var body=found.map(function(cand,index){var single=found.length===1;return '<'+(single?'div':'label')+' class="card step" style="cursor:pointer;margin-bottom:8px">'+(single?'':'<input type="radio" name="checkup-path" value="'+esc(cand.path)+'" '+(index===0?'checked':'')+'>')+'<div><h2>'+esc(cand.label)+' <span class="badge">'+(KIND_BADGES[cand.kind]||"노트 폴더")+'</span></h2><p>노트 '+esc(cand.notes)+'개 · '+esc(cand.path)+'</p></div></'+(single?'div':'label')+'>';}).join("");body+='<div class="inline-field"><input class="field" id="checkup-custom" placeholder="'+(found.length?"또는 폴더 경로 직접 입력 (~/…)":"진단할 폴더 경로를 입력하세요 (~/…)")+'"><button class="btn" data-checkup-preflight>폴더 확인</button></div><div id="checkup-preflight"></div>';openModal("내 기억 건강검진","선택한 폴더의 노트 텍스트가 내 Claude 구독을 거쳐 Anthropic에서 처리됩니다. 요약·점수만 로컬에 저장되고 어디에도 업로드되지 않습니다.","",'<button class="btn primary" data-checkup-start disabled>진단 시작</button>',body);if(state.checkupPath)await loadCheckupPreflight(state.checkupPath,[]);else renderCheckupPreflight();}
  function shareSnippet(data){return "내 AI 기억에서 모순 "+data.contradictions+"건과 중복 "+data.duplicates+"건을 찾았어요. "+data.minutes+"분 만에 몰랐던 기록을 확인했습니다. npx nautli dashboard";}
  function drawShareCard(canvas,data){var scale=2;canvas.width=600*scale;canvas.height=338*scale;var ctx=canvas.getContext("2d");var styles=getComputedStyle(document.documentElement);function css(name){return styles.getPropertyValue(name).trim();}var colors={background:css("--background"),foreground:css("--foreground"),card:css("--card"),border:css("--border"),muted:css("--muted-foreground"),warning:css("--status-warning"),accent:css("--ai-action-accent")};ctx.scale(scale,scale);ctx.fillStyle=colors.background;ctx.fillRect(0,0,600,338);ctx.strokeStyle=colors.border;ctx.lineWidth=1;ctx.strokeRect(.5,.5,599,337);ctx.fillStyle=colors.foreground;ctx.font='700 21px system-ui,"Apple SD Gothic Neo","Noto Sans KR","Segoe UI",sans-serif';ctx.fillText("nautli",34,42);ctx.fillStyle=colors.muted;ctx.font='500 13px system-ui,"Apple SD Gothic Neo","Noto Sans KR","Segoe UI",sans-serif';ctx.fillText(data.minutes+"분 만에 내 AI 기억에서 찾았습니다",34,77);ctx.fillStyle=colors.foreground;ctx.font='700 48px system-ui,"Apple SD Gothic Neo","Noto Sans KR","Segoe UI",sans-serif';ctx.fillText("모순 "+data.contradictions+"건",34,142);ctx.fillStyle=colors.warning;ctx.fillText("중복 "+data.duplicates+"건",34,199);ctx.fillStyle=colors.muted;ctx.font='500 15px system-ui,"Apple SD Gothic Neo","Noto Sans KR","Segoe UI",sans-serif';ctx.fillText("기억 가치 없는 조각 "+(data.junk_percent==null?"측정 안 됨":"약 "+data.junk_percent+"%"),34,230);ctx.fillStyle=colors.card;ctx.beginPath();if(typeof ctx.roundRect==="function")ctx.roundRect(34,257,82,27,14);else ctx.rect(34,257,82,27);ctx.fill();ctx.fillStyle=colors.foreground;ctx.font='600 12px system-ui,"Apple SD Gothic Neo","Noto Sans KR","Segoe UI",sans-serif';ctx.fillText(data.score+"/100",52,275);ctx.fillStyle=colors.muted;ctx.fillText("sampled "+data.sampled_notes+" notes",130,275);ctx.fillStyle=colors.accent;ctx.font='600 13px system-ui,"Apple SD Gothic Neo","Noto Sans KR","Segoe UI",sans-serif';ctx.fillText(data.cta,34,313);}
  async function openShareCard(){var data=await api("/api/checkup/share-card");state.shareCard=data;openModal("공유 카드 미리보기","노트 내용, 파일 경로, 프로젝트 이름은 카드 데이터에 포함되지 않아요.","",'<button class="btn primary" data-share-download>PNG 다운로드</button><button class="btn" data-copy-share="'+esc(shareSnippet(data))+'">X용 문구 복사</button>','<canvas id="share-canvas" class="share-canvas" aria-label="공유 카드 미리보기"></canvas>');requestAnimationFrame(function(){var canvas=document.getElementById("share-canvas");if(canvas)drawShareCard(canvas,data);});}
  function checkupBlock(){
    var c=state.checkup;
    if(!c)return '<section class="card step"><div class="state">…</div><div><h2>내 기억 건강검진</h2><p>상태 확인 중…</p></div><div class="actions"></div></section>';
    if(c.state==="dismissed")return "";
    if(c.state==="none")return '<section class="card step next"><div class="state">＋</div><div><h2>내 기억 건강검진</h2><p>옵시디언 볼트나 CLAUDE.md에 이미 쌓인 기록을 스캔해서 중복·모순·낡은 기억을 리포트로 보여줘요. 맛보기는 10분 안팎.</p></div><div class="actions"><button class="btn primary" data-checkup-open>내 기억 진단하기</button><button class="btn quiet" data-checkup-dismiss>건너뛰기</button></div></section>';
    if(c.state==="running"){var p=c.progress||{};var judging=p.phase==="judge";var total=judging?p.judge_total:p.batches_total;var completed=judging?p.judge_done:p.batches_done;var pct=total?Math.round((completed||0)/total*100):null;var progressText=judging?(p.judge_total==null?"중복·모순 판정 중…":"중복·모순 판정 "+esc(p.judge_done||0)+"/"+esc(p.judge_total)+" 배치"):(pct==null?"스캔 준비 중":"추출 "+esc(p.batches_done||0)+"/"+esc(p.batches_total)+" 배치");var findings=c.findings||{contradictions:0,duplicates:0};var teaser=findings.teaser?'<div class="checkup-teaser"><div class="meta"><span class="badge">첫 발견</span></div><div class="claim">'+esc(findings.teaser.a.claim)+'</div><div class="muted">겹치거나 부딪히는 기록을 찾았어요. 완료 후 함께 확인할 수 있어요.</div></div>':'';return '<section class="card step next"><div class="state">…</div><div><h2>건강검진 진행 중</h2><p>'+esc(c.vault||"")+' · '+progressText+'. 이 화면을 떠나도 계속 돌아요.</p>'+(pct!=null?'<div class="progress" style="margin-top:8px"><i style="width:'+pct+'%"></i></div>':'')+'<p><strong>지금까지: 모순 '+esc(findings.contradictions)+'건 · 중복 '+esc(findings.duplicates)+'건</strong></p>'+teaser+'</div><div class="actions"></div></section>';}
    if(c.state==="failed")return '<section class="card step"><div class="state warn">!</div><div><h2>건강검진이 중단됐어요</h2><p>'+esc(c.log_tail||"원인이 기록되지 않았어요.")+'</p></div><div class="actions"><button class="btn" data-checkup-open>다시 시도</button><button class="btn quiet" data-checkup-dismiss>건너뛰기</button></div></section>';
    if(c.state==="done"){
      var s=c.summary||{};var contra=s.contradictions||0;var dup=s.duplicates||0;
      var headline=c.partial?"진단 일부가 실패했어요. 아래 수치는 부분 결과예요. (Claude CLI 로그인 상태를 확인하고 다시 시도해 주세요)":contra>0?"같은 주제가 서로 다르게 적혀 있어요. AI가 어느 쪽을 믿을지 복불복인 상태예요.":dup>0?"같은 얘기가 여러 곳에 흩어져 있어요. AI가 매번 전부 다시 읽고 있어요.":s.atoms===0?"가져올 기억 조각을 찾지 못했어요. 전체 리포트를 확인해 주세요.":"생각보다 깨끗해요. 지금부터 쌓이는 기억만 관리하면 돼요.";
      var junkStr=s.junk_rate==null?"측정 안 됨":"~"+Math.round(s.junk_rate*100)+"%";var filesSampled=c.files_sampled==null?s.notes:c.files_sampled;
      var html='<section class="card"><div class="meta"><span class="badge review-warn">건강검진 결과</span><span class="badge">'+esc(c.vault||"")+'</span></div><div class="metric-line"><div class="metric">'+esc(s.score)+'</div><div class="metric-label">/100점 · 노트 '+esc(filesSampled)+'개 표본</div></div><p><strong>'+headline+'</strong></p><p class="muted">기억 조각 '+esc(s.atoms)+'건 · 중복 '+esc(dup)+'쌍 · 서로 부딪히는 기록 '+esc(contra)+'쌍 · 기억 가치 없는 조각 '+junkStr+'</p>';
      (c.cards||[]).forEach(function(card){html+='<div class="fact"><div class="meta"><span class="badge '+(card.kind==="contradiction"?"review-warn":"")+'">'+(card.kind==="contradiction"?"부딪히는 기록":"중복")+'</span>'+(card.a.src?'<span>'+esc(card.a.src)+'</span>':'')+'</div><div class="claim">A: '+esc(card.a.claim)+'</div><div class="claim">B: '+esc(card.b.claim)+'</div></div>';});
      html+='<div class="actions">'+(s.atoms===0?'':'<button class="btn primary" data-checkup-import>이 기억 '+esc(Math.min(s.atoms||0,800))+'건 가져오고 연결 계속</button>')+'<button class="btn quiet" data-checkup-report>전체 리포트</button><button class="btn quiet" data-checkup-dismiss>가져오지 않고 새로 시작</button></div><p class="hint">가져오면 위 중복·모순을 카드 탭에 바로 올려요. 원본 파일은 건드리지 않아요.</p></section>';
      return html;
    }
    if(c.state==="imported"){var im=c.imported||{};var summary=c.summary||{};return stepRow({title:"건강검진 완료 · "+esc(summary.score)+"/100 · 기억 "+esc(im.imported||0)+"건 가져옴",desc:"노트 "+esc(c.files_sampled==null?summary.notes:c.files_sampled)+"개 표본",complete:true,actions:'<button class="btn quiet" data-checkup-report>리포트</button>'});}
    return "";
  }
  function checkupSlot(){return checkupBlock()+(state.checkupError?'<p class="warning">'+esc(state.checkupError)+'</p>':'');}
  function stepRow(options){
    if(options.complete)return '<section class="card step done"><div class="state ok">✓</div><div><h2>'+options.title+'</h2>'+(options.desc?'<p>'+options.desc+'</p>':'')+'</div><div class="actions">'+(options.actions||'')+'</div></section>';
    return '<section class="card step'+(options.next?' next':'')+'"><div class="state '+(options.warn?'warn':'')+'">'+(options.warn?'!':'○')+'</div><div><h2>'+options.title+'</h2><p>'+options.desc+'</p></div><div class="actions">'+options.actions+'</div></section>';
  }
  function mcpAgent(name){var mcp=state.status.setup.required.mcp;var current=mcp[name]||{};var detected=scanAgents().find(function(agent){return agent.name===name;})||{};return {name:name,installed:current.cli_exists===true||detected.installed===true,connected:current.registered===true,checking:current.status==="checking"||current.cli_exists==null};}
  function checklistState(){var active=Number(state.status.stats&&state.status.stats.byStatus&&state.status.stats.byStatus.active||0);var firstDone=active>0||(state.continuity.a==="done"||state.continuity.a==="skipped")&&(state.continuity.b==="done"||state.continuity.b==="skipped");var checkup=state.checkup||{state:"loading"};var checkupDone=checkup.state==="done"||checkup.state==="imported";var checkupSkipped=checkup.state==="dismissed";var claude=mcpAgent("claude");var codex=mcpAgent("codex");var cursor=state.status.setup.optional.cursor||{};var second;if(claude.connected&&codex.connected){second={title:"Cursor 연결",desc:cursor.complete?"세 번째 AI도 같은 기억 저장소를 쓰고 있어요.":"Claude Code와 Codex 다음으로 Cursor도 같은 기억을 쓸 수 있어요.",complete:cursor.complete===true,skipped:false,target:"cursor"};}else{var target=claude.connected?codex:claude;second={title:agentLabel(target.name)+" 연결",desc:target.connected?"두 번째 AI도 같은 기억 저장소를 쓰고 있어요.":target.checking?"설치와 연결 상태를 확인하고 있어요.":target.installed?agentLabel(target.name)+"에서도 같은 기억을 읽고 쓸 수 있어요.":agentLabel(target.name)+"가 설치되지 않아 이 항목은 건너뜁니다.",complete:target.connected,skipped:!target.checking&&!target.installed,target:target.name};}
    var items=[
      {key:"continuity",title:"첫 진짜 기억",desc:firstDone?state.continuity.a==="skipped"?"첫 기억 확인을 건너뛰었어요.":active>0&&state.continuity.a!=="done"?"nautli에 실제 기억이 쌓였어요.":"AI가 남긴 첫 기억을 다시 읽는 흐름을 확인했어요.":"실제로 쓸 습관 하나를 저장하고 다시 읽어보세요.",complete:firstDone,skipped:state.continuity.a==="skipped"},
      {key:"checkup",title:"내 기억 건강검진",desc:checkupDone?"기존 기록의 중복과 모순을 확인했어요.":checkupSkipped?"건강검진을 건너뛰었어요.":checkup.state==="running"?"건강검진이 이 컴퓨터에서 진행 중이에요.":"기존 기록에 숨은 중복과 모순을 확인해 보세요.",complete:checkupDone,skipped:checkupSkipped},
      Object.assign({key:"second-ai"},second),
      {key:"share",title:"공유 카드 만들기",desc:checkupDone?"건강검진 결과로 개인정보 없는 공유 카드를 만들 수 있어요.":checkupSkipped?"건강검진을 건너뛰어 공유 카드도 건너뜁니다.":"건강검진을 마치면 발견 수만 담은 카드를 만들 수 있어요.",complete:checkupDone,skipped:checkupSkipped},
    ];return {items:items,done:items.filter(function(item){return item.complete||item.skipped;}).length,total:items.length,allDone:items.every(function(item){return item.complete||item.skipped;})};}
  function checklistAction(item,isFirst){var open=state.checklistOpen===item.key;var cls="btn "+(isFirst&&!open?"primary":"quiet");if(item.key==="continuity")return '<button class="'+cls+'" data-checklist-toggle="continuity">'+(open?"접기":item.complete||item.skipped?"다시 보기":"시작하기")+'</button>';if(item.key==="checkup"){if(item.complete)return '<button class="btn quiet" data-checkup-report>리포트 보기</button>';if(item.skipped)return '<button class="'+cls+'" data-checkup-open>진단하기</button>';return '<button class="'+cls+'" data-checklist-toggle="checkup">'+(open?"접기":state.checkup&&state.checkup.state==="running"?"진행 보기":"진단하기")+'</button>';}
    if(item.key==="second-ai"){if(item.complete||item.skipped)return '<button class="btn quiet" data-refresh-status>상태 새로고침</button>';if(item.target==="cursor")return '<button class="'+cls+'" data-copy-cursor>Cursor 설정 복사</button>';return '<button class="'+cls+'" data-setup="'+(item.target==="codex"?"codex":"mcp")+'">자동 등록</button>';}
    if(item.complete)return '<button class="btn quiet" data-share-card>공유 카드</button>';if(item.skipped)return '<button class="btn quiet" data-checkup-open>진단하기</button>';return '<button class="'+cls+'" data-checklist-toggle="checkup">건강검진 먼저</button>';}
  function checklistRow(item,index,firstIncomplete){var done=item.complete||item.skipped;var stateClass=item.complete?" ok":"";var icon=item.complete?"✓":item.skipped?"↷":"○";var title=item.title+(item.skipped?' <span class="badge status-dead">건너뜀</span>':'');return '<section class="card step '+(done?'done':index===firstIncomplete?'next':'')+'"><div class="state'+stateClass+'">'+icon+'</div><div><h2>'+title+'</h2><p>'+item.desc+'</p></div><div class="actions">'+checklistAction(item,index===firstIncomplete)+'</div></section>';}
  function checklistBlock(){var list=checklistState();if(list.allDone&&!state.checklistExpanded)return '<div class="card banner">다 됐어요. 이제 nautli는 알아서 굴러가요 <button class="btn quiet" data-checklist-expand>다시 보기</button></div>';var firstIncomplete=list.items.findIndex(function(item){return !item.complete&&!item.skipped;});var html='<div class="checklist-head"><span class="section-title">다음 할 일 '+list.done+'/'+list.total+'</span><div class="progress"><i style="width:'+(list.done/list.total*100)+'%"></i></div>'+(list.allDone?'<button class="btn quiet" data-checklist-collapse>접기</button>':'')+'</div>';list.items.forEach(function(item,index){html+=checklistRow(item,index,firstIncomplete);if(state.checklistOpen===item.key){if(item.key==="continuity")html+='<div class="checklist-detail">'+continuityBlock()+'</div>';if(item.key==="checkup")html+='<div id="checkup-slot" class="checklist-detail">'+checkupSlot()+'</div>';}});return html;}
  function continuityBlock(){
    ensureContinuitySince();var c=state.continuity;var examples=["나는 커밋 메시지를 한국어로 쓴다","내 기본 브랜치는 main이다","배포 전에는 항상 테스트를 먼저 돌린다"];
    function statusClass(value,active){return "continuity-step "+(value==="skipped"?"skipped":active?"active":"");}
    function skipped(label){return '<div class="muted">'+label+' <span class="badge status-dead">건너뜀</span></div>';}
    var html='<section class="card continuity"><div class="continuity-head"><div><h1>첫 진짜 기억을 남겨보세요</h1><p class="lead">지금도 쓸 만한 습관 하나를 저장하고, nautli가 다시 꺼내는 것까지 확인해요.</p></div><span class="badge">약 1분</span></div>';
    html+='<div class="'+statusClass(c.a,c.a==="ready"||c.a==="waiting")+'"><div class="continuity-number">A</div><div><h2>Claude Code에 이 한 줄을 붙여넣으세요</h2>';
    if(c.a==="skipped")html+=skipped("저장 확인을");
    else if(c.a==="done")html+='<p class="detected">'+(c.factResult==="duplicate"?"이미 있던 기억이에요. 연결은 확인됐어요!":"저장 감지 ✓ Claude가 nautli에 썼어요")+'</p><div class="fact"><div class="claim">'+esc(c.factClaim)+'</div></div>';
    else{html+='<div class="memory-options">'+examples.map(function(example,index){return '<label><input type="radio" name="continuity-memory" value="'+esc(example)+'" '+(c.choice===example?'checked':'')+'> '+esc(example)+'</label>';}).join("")+'<label><input type="radio" name="continuity-memory" value="custom" '+(c.choice==="custom"?'checked':'')+'> 직접 입력</label></div><div class="inline-field"><input id="continuity-custom" class="field" maxlength="240" placeholder="실제로 기억해 둘 습관을 한 문장으로 적어 주세요" value="'+esc(c.custom)+'"><button class="btn primary" data-continuity-copy '+(!continuityClaim()?'disabled':'')+'>복사</button></div>'+(c.candidate?'<div class="fact"><div class="meta"><span class="badge">저장 후보</span></div><div class="claim">방금 이 기억이 저장됐어요: '+esc(c.candidate.claim)+'</div><div class="actions"><button class="btn primary" data-continuity-accept>이걸로 계속</button><button class="btn quiet" data-continuity-reject>아니에요</button></div></div>':'')+(c.a==="waiting"?'<div id="continuity-wait" class="hint">'+continuityWaitCopy()+'</div>':'');}
    if(c.a!=="done"&&c.a!=="skipped")html+='<div class="actions"><button class="btn quiet" data-continuity-skip="a">건너뛰기</button></div>';html+='</div></div>';
    var bActive=c.a==="done"&&(c.b==="ready"||c.b==="reading");html+='<div class="'+statusClass(c.b,bActive)+'"><div class="continuity-number">B</div><div><h2>이제 nautli가 직접 읽어볼게요</h2>';
    if(c.b==="skipped")html+=skipped("읽기 확인을");
    else if(c.b==="done")html+='<div class="fact"><div class="meta"><span class="badge">방금 읽은 기억</span></div><div class="claim">'+esc((c.recalled||{}).claim)+'</div></div><p>이 기억은 Cursor든 새 세션이든 어디서 물어도 똑같이 나옵니다.</p>';
    else if(c.a!=="done")html+='<p class="muted">스텝 A에서 저장을 감지하면 여기서 실물을 읽을 수 있어요.</p><div class="actions"><button class="btn quiet" data-continuity-skip="b">건너뛰기</button></div>';
    else html+='<p class="muted">버튼을 누르면 방금 저장한 기억을 대시보드가 직접 recall해요.</p><div class="actions"><button class="btn primary" data-continuity-recall '+(c.b==="reading"?'disabled':'')+'>'+(c.b==="reading"?'읽는 중…':'읽어보기')+'</button><button class="btn quiet" data-continuity-skip="b">건너뛰기</button></div>';html+='</div></div>';
    var cursor=state.status.setup.optional.cursor||{};if(cursor.complete&&c.factId){html+='<div class="'+statusClass(c.c,c.c==="ready"||c.c==="waiting")+'"><div class="continuity-number">C</div><div><h2>회의적이라면: Cursor에서 직접 물어보세요</h2>';
      if(c.c==="skipped")html+=skipped("다른 세션 확인을");else if(c.c==="done")html+='<div class="shared-brain">방금 두 도구가 같은 뇌를 썼습니다</div>';else{var question='나의 습관 중 "'+c.factClaim+'"에 대해 기억하고 있는 내용을 알려줘';html+='<p class="muted">다른 Cursor 세션에서 질문한 뒤 응답을 기다리면 자동으로 감지해요.</p><div class="actions"><button class="btn" data-continuity-cursor-question="'+esc(question)+'">질문 복사</button><button class="btn quiet" data-continuity-skip="c">건너뛰기</button></div>'+(c.c==="waiting"?'<p class="hint">다른 세션의 recall을 기다리고 있어요.</p>':'');}html+='</div></div>';}
    html+='</section>';return html;
  }
  function aiConnectionStep(mcp,next){var agents=[mcpAgent("claude"),mcpAgent("codex")];var shown=agents.filter(function(agent){return agent.installed;});if(shown.length===0)shown=[agents[0]];var promoted=false;var rows=shown.map(function(agent){var status=agent.connected?"연결됨":agent.installed?"설치됨":agent.checking?"확인 중":"미설치";var statusClass=agent.connected?"status-connected":agent.installed?"status-installed":"status-dead";var desc=agent.name==="claude"?agent.installed?"기억 도구를 연결할 수 있어요. 습관 지시문 설치는 다음 단계에서 따로 진행해요.":agent.checking?"Claude Code 설치 상태를 확인하고 있어요.":"Claude Code CLI가 필요해요. 설치한 뒤 claude로 로그인해 주세요.":agent.installed?"Codex에서도 같은 기억 저장소를 읽고 쓸 수 있어요.":"Codex가 설치되지 않았어요.";var action="";if(!agent.connected&&agent.installed){var primary=next&&!promoted;promoted=promoted||primary;action='<button class="btn '+(primary?'primary':'')+'" data-setup="'+(agent.name==="codex"?'codex':'mcp')+'">자동 등록</button>';}var tooltip=agent.name==="codex"?' title="습관 지시문은 지금은 Claude Code에만 설치돼요"':'';return '<div class="agent-row"'+tooltip+'><div><div class="agent-row-title"><strong>'+agentLabel(agent.name)+'</strong><span class="badge '+statusClass+'">'+status+'</span></div><p>'+desc+'</p></div><div class="actions">'+action+'</div></div>';}).join("");return '<section class="card step '+(mcp.complete?'done':next?'next':'')+'"><div class="state '+(mcp.complete?'ok':'')+'">'+(mcp.complete?'✓':'○')+'</div><div><h2>AI 연결</h2><p>설치된 AI만 표시해요. 필수 완료 여부는 한 개 이상의 실제 연결 상태로 판단해요.</p><div class="agent-rows">'+rows+'</div></div><div class="actions"></div></section>';}
  function setupView(){var s=state.status.setup;var r=s.required;var done=[r.store,r.mcp,r.instructions,r.daemon].filter(function(item){return item.complete;}).length;var firstKey=!r.store.complete?"store":!r.mcp.complete?"mcp":!r.instructions.complete?"instructions":!r.daemon.complete?"daemon":null;function main(key,label,attrs){return '<button class="btn '+(firstKey===key?'primary':'')+'" '+attrs+'>'+label+'</button>';}
    var daemonWarn=r.daemon.plist_exists&&(!r.daemon.health.healthy||r.daemon.health.stale);var digestButton='<button class="btn quiet" data-setup="digest" '+(state.digesting?'disabled':'')+'>'+(state.digesting?'소화 중… 최대 2분':'지금 소화 테스트')+'</button>';var html=setupHero();if(s.complete){if(daemonWarn)html+=stepRow({title:"밤 소화 확인 필요",desc:"마지막 소화가 오래됐거나 실패했어요. 지금 소화 테스트로 확인해 주세요.",warn:true,actions:digestButton});html+=checklistBlock();app.innerHTML=html;if(state.checklistOpen==="continuity")ensureContinuityPolling();return;}html+='<div class="progress-row"><span class="section-title">필수 연결 '+done+'/4</span><div class="progress"><i style="width:'+(done*25)+'%"></i></div></div>';var daemonDesc=r.daemon.complete?"마지막 실행 "+fmt(r.daemon.health.last_run)+" · 다음 실행 "+fmt(nextRunMs(r.daemon)):daemonWarn?(r.daemon.health.exists?"마지막 소화가 오래됐거나 실패했어요. 지금 소화 테스트로 확인해 주세요.":"설치됐어요. 지금 소화 테스트 한 번으로 연결을 확인해 주세요."):"자는 동안 중복을 합치고 모순을 카드로 만들어요. 매일 밤 3:30.";
    html+=stepRow({title:"기억 저장소",desc:r.store.complete?"":"기억이 저장될 곳을 만들어요. 전부 이 컴퓨터 안에만 저장돼요.",complete:r.store.complete,next:firstKey==="store",actions:r.store.complete?"":main("store","기억 저장소 만들기",'data-setup="init"')});html+=aiConnectionStep(r.mcp,firstKey==="mcp");html+=stepRow({title:"AI 습관 지시문",desc:r.instructions.complete?"":"Claude가 기억 도구를 쓰도록 CLAUDE.md에 지시문 한 블록을 추가해요.",complete:r.instructions.complete,next:firstKey==="instructions",actions:r.instructions.complete?'<button class="btn quiet danger" data-setup="instructions-remove">제거</button>':main("instructions","설치 미리보기","data-preview")+'<button class="btn quiet" data-copy-instructions>지시문 복사</button>'});html+=stepRow({title:"밤 소화 데몬",desc:daemonDesc,complete:r.daemon.complete,next:firstKey==="daemon",warn:daemonWarn,actions:r.daemon.complete?digestButton+'<button class="btn quiet danger" data-setup="daemon-remove">제거</button>':main("daemon","데몬 설치","data-daemon-preview")+(daemonWarn?digestButton:'')});app.innerHTML=html;}
  function factHtml(fact,label){if(!fact)return '<div class="fact"><div class="muted">'+label+' 기억을 찾을 수 없어요.</div></div>';return '<div class="fact"><div class="meta"><span class="badge">기억 '+label+'</span><span class="badge">'+esc(scopeLabel(fact.scope))+'</span>'+(fact.subject?'<span>'+esc(fact.subject)+'</span>':'')+'<span>'+esc(fact.t_valid)+'</span></div><div class="claim">'+esc(fact.claim)+'</div></div>';}
  function reviewView(){
    var html='<div class="page-head"><div><h1>카드</h1><p class="lead">밤 소화가 정리하다 사람의 판단이 필요한 것만 카드로 올려요.</p></div></div>';
    if(state.cards.length===0){
      var setup=state.status.setup;
      var connected=setup.required.store.complete&&setup.required.mcp.complete;var health=setup.required.daemon.health;
      if(!connected){app.innerHTML=html+'<div class="card empty">카드는 밤 소화가 만들어요. 먼저 설정을 완료해 주세요.<div class="actions"><button class="btn primary" data-tab="setup">설정으로 가기</button></div></div>';return;}
      if(health.exists&&!health.healthy){app.innerHTML=html+'<div class="card empty">마지막 소화가 실패했어요. 설정 탭에서 [지금 소화 테스트]로 확인해 주세요.<div class="actions"><button class="btn primary" data-tab="setup">설정으로 가기</button></div>'+digestContext()+'</div>';return;}
      if(!sampleState().complete){app.innerHTML=html+'<div class="card empty">아직 검토할 카드가 없어요. 체험 소화로 첫 카드를 바로 경험해 볼 수 있어요.<div class="actions"><button class="btn primary" data-sample '+(state.digesting?'disabled':'')+'>'+(state.digesting?'소화 중… 최대 2분':'체험 소화')+'</button></div>'+digestContext()+'</div>';return;}
      app.innerHTML=html+'<div class="card empty">검토할 카드가 없어요. 새 기억이 쌓이면 밤 소화가 카드를 만들어요.'+digestContext()+'</div>';return;
    }
    state.cards.forEach(function(card){if(card.type==="capture"){html+='<section class="card review-card"><div class="meta"><span class="badge">대화에서 발견</span><span class="badge">'+esc(scopeLabel(card.scope))+'</span><span class="badge">'+(card.confidence==null?'확신 ?':'확신 '+Math.round(Number(card.confidence)*100)+'%')+'</span></div><div class="claim">'+esc(card.claim)+'</div><div class="actions" data-pair="'+encodeURIComponent(card.pair_id)+'"><button class="btn" data-action="remember">기억하기</button><button class="btn" data-action="dismissed">버리기</button><button class="btn" data-action="deferred">나중에</button></div>'+(state.cards.length===1?digestContext():'')+'</section>';return;}var duplicate=card.verdict==="duplicate";html+='<section class="card review-card"><div class="meta"><span class="badge '+(duplicate?'':'review-warn')+'">'+(duplicate?'중복 정리':'모순 발견')+'</span><span class="badge">'+(card.confidence==null?'확신 ?':'확신 '+Math.round(Number(card.confidence)*100)+'%')+'</span></div><p>'+(duplicate?'이 두 기억이 같은 내용 같아요. 하나로 합칠까요?':'두 기억이 동시에 맞기 어려워 보여요. 어떤 기억이 맞나요?')+'</p>'+factHtml(card.facts&&card.facts.a,"A")+factHtml(card.facts&&card.facts.b,"B")+'<details><summary>판정 근거</summary><p>'+esc(card.reason||"근거가 기록되지 않았어요.")+'</p></details><div class="actions" data-pair="'+encodeURIComponent(card.pair_id)+'">';
      if(duplicate)html+='<button class="btn" data-action="merge">합치기</button><button class="btn danger" data-action="keep_separate">따로 유지</button><button class="btn" data-action="defer">내일 다시 보기</button>';
      else html+='<button class="btn" data-action="newer_wins">새 기억이 맞음</button><button class="btn danger" data-action="older_wins">옛 기억이 맞음</button><button class="btn" data-action="both_valid">둘 다 유효함</button><button class="btn" data-other>기타…</button>';
      html+='</div><div class="add hidden" data-other-form="'+encodeURIComponent(card.pair_id)+'"><input class="field" aria-label="정정할 기억" placeholder="정정할 내용을 한 문장으로 적어 주세요"><button class="btn primary" data-action="other">정정 저장</button></div>'+(state.cards.length===1?digestContext():'')+'</section>';
    });app.innerHTML=html;
  }
  function graphView(){
    if(state.graphCleanup){state.graphCleanup();state.graphCleanup=null;}
    var graph=state.graph||{nodes:[],links:[]};var facts=graph.nodes.filter(function(node){return node.kind==="fact";});
    var head='<div class="page-head"><div><h1>그래프</h1><p class="lead">기억이 스코프와 서로 어떻게 연결됐는지 보여줘요.</p></div><button class="btn" data-refresh-graph>새로고침</button></div>';
    if(facts.length===0){app.innerHTML=head+'<div class="card empty">아직 기억이 없어요. 설정을 마치면 여기서 기억이 자라는 걸 볼 수 있어요.<div class="actions"><button class="btn primary" data-tab="setup">설정으로 가기</button></div></div>';return;}
    var note=graph.truncated?'<div class="graph-note">최신 기억 600개를 표시하고 있어요.</div>':'';
    app.innerHTML=head+'<div class="graph-legend" aria-label="그래프 범례"><span class="legend-item"><i class="legend-dot hub"></i>허브=프로젝트</span><span class="legend-item"><i class="legend-line"></i>보라=대체</span><span class="legend-item"><i class="legend-line contradiction"></i>빨강=모순</span><span class="legend-item"><i class="legend-line duplicate"></i>노랑=중복 확인 필요</span></div><div class="graph-stage"><canvas class="graph-canvas" aria-label="기억 연결 그래프"></canvas><div class="graph-tooltip hidden" role="tooltip"></div></div>'+note;
    requestAnimationFrame(function(){startGraph(graph);});
  }
  function startGraph(graph){
    var canvas=app.querySelector(".graph-canvas");if(!canvas)return;var stage=canvas.parentElement;var tooltip=stage.querySelector(".graph-tooltip");var ctx=canvas.getContext("2d");if(!ctx)return;
    var colors={};function alphaColor(value,alpha){var hex=value.replace("#","");if(hex.length===3)hex=hex.split("").map(function(part){return part+part;}).join("");if(!/^[0-9a-f]{6}$/i.test(hex))return value;return "rgba("+parseInt(hex.slice(0,2),16)+","+parseInt(hex.slice(2,4),16)+","+parseInt(hex.slice(4,6),16)+","+alpha+")";}function readGraphColors(){var styles=getComputedStyle(document.documentElement);var text=styles.getPropertyValue("--foreground").trim();colors={edge:styles.getPropertyValue("--graph-edge").trim(),node:styles.getPropertyValue("--graph-node").trim(),hub:styles.getPropertyValue("--graph-hub").trim(),superseded:styles.getPropertyValue("--graph-superseded").trim(),contradiction:styles.getPropertyValue("--graph-contradiction").trim(),duplicate:styles.getPropertyValue("--graph-duplicate").trim(),text:text,hoverGlow:alphaColor(text,.28),hoverStroke:alphaColor(text,.55)};}readGraphColors();function handleThemeChange(){readGraphColors();draw();}window.addEventListener("nautli-theme-change",handleThemeChange);
    var width=1;var height=1;var dpr=1;var camera={x:0,y:0,zoom:1};var hovered=null;var running=true;var started=performance.now();var simLive=false;var userMoved=false;
    function fitCamera(){if(userMoved||!nodes.length)return;var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;nodes.forEach(function(node){if(node.x<minX)minX=node.x;if(node.x>maxX)maxX=node.x;if(node.y<minY)minY=node.y;if(node.y>maxY)maxY=node.y;});var pad=60;var spanX=Math.max(1,maxX-minX+pad*2);var spanY=Math.max(1,maxY-minY+pad*2);var zoom=Math.min(1.6,Math.min(width/spanX,height/spanY));var cx=(minX+maxX)/2;var cy=(minY+maxY)/2;camera.zoom=zoom;camera.x=-cx*zoom;camera.y=-cy*zoom;}
    var nodes=graph.nodes.map(function(node,index){return Object.assign({i:index,x:0,y:0,vx:0,vy:0},node);});var byId=new Map(nodes.map(function(node){return [node.id,node];}));var links=graph.links.map(function(link){return {a:byId.get(link.a),b:byId.get(link.b),kind:link.kind};}).filter(function(link){return link.a&&link.b;});
    var scopes=nodes.filter(function(node){return node.kind==="scope";});
    function hash(value){var out=2166136261;for(var i=0;i<value.length;i+=1){out^=value.charCodeAt(i);out=Math.imul(out,16777619);}return out>>>0;}
    var clusterCount=new Map();nodes.forEach(function(node){if(node.kind==="scope")return;clusterCount.set(node.scope,(clusterCount.get(node.scope)||0)+1);});
    function clusterRadius(scope){return Math.max(38,Math.round(Math.sqrt(clusterCount.get(scope)||1)*17));}
    function place(){var radiusX=Math.max(160,width*.33);var radiusY=Math.max(140,height*.3);scopes.forEach(function(node,index){var angle=(Math.PI*2*index/Math.max(1,scopes.length))-Math.PI/2;node.x=Math.cos(angle)*radiusX;node.y=Math.sin(angle)*radiusY;});nodes.forEach(function(node){if(node.kind==="scope")return;var hub=byId.get("scope:"+node.scope);var seed=hash(node.id);var angle=(seed%6283)/1000;var distance=14+((seed>>>8)%clusterRadius(node.scope));node.x=(hub?hub.x:0)+Math.cos(angle)*distance;node.y=(hub?hub.y:0)+Math.sin(angle)*distance;node.vx=0;node.vy=0;});}
    function resize(){var box=stage.getBoundingClientRect();var previousWidth=width;width=Math.max(1,Math.round(box.width));height=Math.max(1,Math.round(box.height));dpr=Math.max(1,window.devicePixelRatio||1);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);if(previousWidth===1){place();started=performance.now();if(!simLive){simLive=true;requestAnimationFrame(simulate);}}draw();}
    function nodeRadius(node){return node.kind==="scope"?8:3;}
    function draw(){if(!canvas.isConnected)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);ctx.save();ctx.translate(width/2+camera.x,height/2+camera.y);ctx.scale(camera.zoom,camera.zoom);
      links.forEach(function(link){ctx.beginPath();ctx.moveTo(link.a.x,link.a.y);ctx.lineTo(link.b.x,link.b.y);ctx.lineWidth=(link.kind==="scope"?.6:1.4)/camera.zoom;ctx.strokeStyle=link.kind==="scope"?colors.edge:link.kind==="supersedes"?colors.superseded:link.kind==="contradiction"?colors.contradiction:colors.duplicate;ctx.stroke();});
      nodes.forEach(function(node){var radius=nodeRadius(node);ctx.beginPath();ctx.arc(node.x,node.y,radius,0,Math.PI*2);ctx.fillStyle=node.kind==="scope"?colors.hub:colors.node;if(node===hovered){ctx.shadowColor=colors.hoverGlow;ctx.shadowBlur=10/camera.zoom;ctx.strokeStyle=colors.hoverStroke;ctx.lineWidth=1.5/camera.zoom;ctx.stroke();}ctx.fill();ctx.shadowBlur=0;if(node.kind==="scope"){ctx.fillStyle=colors.text;ctx.font=(12/camera.zoom)+'px system-ui,"Apple SD Gothic Neo","Noto Sans KR","Segoe UI",sans-serif';ctx.fillText(node.label,node.x+(12/camera.zoom),node.y+(4/camera.zoom));}});ctx.restore();
    }
    function simulate(now){if(!running||!canvas.isConnected||state.tab!=="graph"){simLive=false;return;}var elapsed=Math.min(3000,now-started);var alpha=Math.pow(1-elapsed/3000,2);var cell=70;var buckets=new Map();nodes.forEach(function(node){node.fx=0;node.fy=0;var key=Math.floor(node.x/cell)+","+Math.floor(node.y/cell);var bucket=buckets.get(key)||[];bucket.push(node);buckets.set(key,bucket);});
      nodes.forEach(function(node){var cx=Math.floor(node.x/cell);var cy=Math.floor(node.y/cell);for(var gx=cx-1;gx<=cx+1;gx+=1){for(var gy=cy-1;gy<=cy+1;gy+=1){var nearby=buckets.get(gx+","+gy)||[];nearby.forEach(function(other){if(other.i<=node.i)return;var dx=node.x-other.x;var dy=node.y-other.y;var distance2=Math.max(25,dx*dx+dy*dy);var charge=(node.kind==="scope"||other.kind==="scope"?700:35)*alpha/distance2;node.fx+=dx*charge;node.fy+=dy*charge;other.fx-=dx*charge;other.fy-=dy*charge;});}}});
      links.forEach(function(link){var dx=link.b.x-link.a.x;var dy=link.b.y-link.a.y;var distance=Math.max(1,Math.sqrt(dx*dx+dy*dy));var desired=link.kind==="scope"?34:90;var pull=(distance-desired)*(link.kind==="scope"?.03:.012)*alpha;var fx=dx/distance*pull;var fy=dy/distance*pull;link.a.fx+=fx;link.a.fy+=fy;link.b.fx-=fx;link.b.fy-=fy;});
      nodes.forEach(function(node){if(node.kind==="scope"){node.fx-=node.x*.0015*alpha;node.fy-=node.y*.0015*alpha;}else{var hub=byId.get("scope:"+node.scope);if(hub){node.fx+=(hub.x-node.x)*.016*alpha;node.fy+=(hub.y-node.y)*.016*alpha;}}node.vx=(node.vx+node.fx)*.82;node.vy=(node.vy+node.fy)*.82;node.x+=node.vx;node.y+=node.vy;
      if(node.kind!=="scope"){var anchor=byId.get("scope:"+node.scope);if(anchor){var ax=node.x-anchor.x;var ay=node.y-anchor.y;var dist=Math.sqrt(ax*ax+ay*ay);var maxR=clusterRadius(node.scope)*1.35+12;if(dist>maxR){var scale=maxR/dist;node.x=anchor.x+ax*scale;node.y=anchor.y+ay*scale;node.vx*=.4;node.vy*=.4;}}}});fitCamera();draw();if(elapsed<3000)requestAnimationFrame(simulate);else simLive=false;}
    function point(event){var box=canvas.getBoundingClientRect();return {x:event.clientX-box.left,y:event.clientY-box.top};}
    function findNode(screen){var found=null;var best=Infinity;nodes.forEach(function(node){var x=width/2+camera.x+node.x*camera.zoom;var y=height/2+camera.y+node.y*camera.zoom;var dx=screen.x-x;var dy=screen.y-y;var distance=dx*dx+dy*dy;var limit=Math.max(8,nodeRadius(node)*camera.zoom+4);if(distance<limit*limit&&distance<best){best=distance;found=node;}});return found;}
    function showHover(event){var screen=point(event);var next=findNode(screen);if(next!==hovered){hovered=next;draw();}if(!next){tooltip.classList.add("hidden");canvas.style.cursor="grab";return;}tooltip.textContent=next.label;tooltip.classList.remove("hidden");tooltip.style.left=Math.min(width-tooltip.offsetWidth-8,screen.x+12)+"px";tooltip.style.top=Math.min(height-tooltip.offsetHeight-8,screen.y+12)+"px";canvas.style.cursor="pointer";}
    var drag=null;canvas.addEventListener("pointerdown",function(event){var p=point(event);drag={x:p.x,y:p.y,cameraX:camera.x,cameraY:camera.y,moved:false};canvas.setPointerCapture(event.pointerId);canvas.classList.add("panning");});
    canvas.addEventListener("pointermove",function(event){if(!drag){showHover(event);return;}var p=point(event);var dx=p.x-drag.x;var dy=p.y-drag.y;if(Math.abs(dx)+Math.abs(dy)>4){drag.moved=true;userMoved=true;}camera.x=drag.cameraX+dx;camera.y=drag.cameraY+dy;tooltip.classList.add("hidden");draw();});
    canvas.addEventListener("pointerup",function(event){if(!drag)return;var moved=drag.moved;drag=null;canvas.classList.remove("panning");showHover(event);if(!moved&&hovered){state.memoryScope=hovered.scope;state.memoryQuery="";if(hovered.kind==="fact"&&hovered.status!=="active")state.includeDead=true;state.memoryLoaded=false;state.memoryError=null;state.tab="memory";location.hash="memory";render();}});
    canvas.addEventListener("pointerleave",function(){if(!drag){hovered=null;tooltip.classList.add("hidden");draw();}});
    canvas.addEventListener("wheel",function(event){event.preventDefault();userMoved=true;var p=point(event);var old=camera.zoom;var next=Math.max(.25,Math.min(4,old*Math.exp(-event.deltaY*.001)));var worldX=(p.x-width/2-camera.x)/old;var worldY=(p.y-height/2-camera.y)/old;camera.x=p.x-width/2-worldX*next;camera.y=p.y-height/2-worldY*next;camera.zoom=next;draw();},{passive:false});
    var observer=typeof ResizeObserver==="function"?new ResizeObserver(resize):null;if(observer)observer.observe(stage);resize();if(!simLive){simLive=true;requestAnimationFrame(simulate);}state.graphCleanup=function(){running=false;if(observer)observer.disconnect();window.removeEventListener("nautli-theme-change",handleThemeChange);};
  }
  function scopeOptions(){var scopes={person:true,procedure:true};state.memory.forEach(function(f){scopes[f.scope]=true;});return '<option value="">전체</option>'+Object.keys(scopes).sort().map(function(scope){return '<option value="'+esc(scope)+'" '+(state.memoryScope===scope?'selected':'')+'>'+esc(scopeLabel(scope))+'</option>';}).join("");}
  function memoryView(){
    var stats=state.status.stats||{total:0,byScope:{},byStatus:{}};var daemon=state.status.setup.required.daemon;
    var active=(stats.byStatus&&stats.byStatus.active)||0;var past=Math.max(0,(stats.total||0)-active);
    var summary="기억 "+esc(active)+"개"+(past?" · 지난 기억 "+esc(past)+"개":"")+" · 스코프 "+esc(Object.keys(stats.byScope||{}).length)+"개 · 마지막 소화 "+fmt(daemon.health.last_run);
    var html='<div class="page-head"><div><h1>기억</h1><p class="lead">AI가 저장해 둔 기억을 검색해요.</p></div></div><div class="summary">'+summary+'</div><form class="toolbar" id="memory-search"><input class="field" name="q" value="'+esc(state.memoryQuery)+'" placeholder="기억 검색"><select class="field" name="scope">'+scopeOptions()+'</select><label class="btn"><input type="checkbox" name="includeDead" '+(state.includeDead?'checked':'')+'> 지난 기억 포함</label></form>';
    if(state.memory.length===0){
      var empty=stats.total===0?"아직 기억이 없어요. Claude와 대화하면 여기 자동으로 쌓여요.":"검색 결과가 없어요. 다른 검색어를 입력해 보세요.";
      app.innerHTML=html+'<div class="card empty">'+empty+(stats.total===0?'<div class="actions"><button class="btn" data-tab="setup">설정 보기</button></div>':'')+'</div>';return;
    }
    state.memory.forEach(function(f){var dead=f.status!=="active";var supersedes=Array.isArray(f.supersedes)&&f.supersedes.length?f.supersedes.join(", "):"없음";html+='<article class="card memory-row '+(dead?'dead':'')+'" data-memory="'+esc(f.id)+'"><div class="meta"><span class="badge">'+esc(scopeLabel(f.scope))+'</span><span class="badge">'+esc(f.t_valid)+'</span>'+(dead?'<span class="badge status-dead"><span class="stamp">🔖</span>지난 기억</span>':'')+'</div><div class="claim">'+esc(f.claim)+'</div><div class="muted hidden" data-detail="'+esc(f.id)+'">id: '+esc(f.id)+' · subject: '+esc(f.subject||"없음")+' · confidence: '+esc(f.confidence)+' · t_valid: '+esc(f.t_valid)+' · status: '+esc(f.status)+' · supersedes: '+esc(supersedes)+' · superseded_by: '+esc(f.superseded_by||"없음")+' · created: '+esc(f.t_created)+'</div></article>';});app.innerHTML=html;
  }
  function loadingView(){var title=state.tab==="review"?"카드":state.tab==="memory"?"기억":state.tab==="graph"?"그래프":"설정";app.innerHTML='<div class="page-head"><div><h1>'+title+'</h1><p class="lead">불러오는 중…</p></div></div><div class="card muted">이 섹션을 불러오는 중…</div>';}
  async function loadStatus(){state.statusError=null;state.status=await api("/api/status");if(!location.hash){state.tab=state.status.setup.complete?(state.status.pending?"review":"memory"):"setup";}setChrome();render();var mcp=state.status.setup.required.mcp;if(mcp.status==="checking"||(mcp.claude&&mcp.claude.status==="checking")||(mcp.codex&&mcp.codex.status==="checking")){clearTimeout(state.statusTimer);state.statusTimer=setTimeout(function(){loadStatus().catch(function(error){toast(error.message,true);});},500);}}
  async function loadCards(){try{state.cards=(await api("/api/cards")).cards;state.cardsLoaded=true;if(state.tab==="review")reviewView();}catch(error){state.cardsLoaded=false;if(state.tab==="review")app.innerHTML='<div class="page-head"><div><h1>카드</h1></div></div><div class="card warning">'+esc(error.message)+' doctor로 저장소 상태를 확인해 주세요.<div class="actions"><button class="btn" data-retry-cards>다시 시도</button><button class="btn" data-copy="nautli doctor">doctor 명령 복사</button></div></div>';}}
  async function loadGraph(force){if(state.graphLoading)return;state.graphLoading=true;state.graphError=null;if(force){if(state.graphCleanup){state.graphCleanup();state.graphCleanup=null;}state.graphLoaded=false;loadingView();}try{state.graph=await api("/api/graph");state.graphLoaded=true;if(state.tab==="graph")graphView();}catch(error){state.graphError=error.message;state.graphLoaded=false;if(state.tab==="graph")app.innerHTML='<div class="page-head"><div><h1>그래프</h1><p class="lead">그래프를 불러오지 못했어요.</p></div></div><div class="card warning">'+esc(error.message)+'<div class="actions"><button class="btn" data-refresh-graph>다시 시도</button><button class="btn" data-copy="nautli doctor">doctor 명령 복사</button></div></div>';}finally{state.graphLoading=false;}}
  async function loadMemory(){if(state.memoryLoading)return;state.memoryLoading=true;state.memoryError=null;var query=new URLSearchParams({q:state.memoryQuery,scope:state.memoryScope,includeDead:String(state.includeDead)});try{state.memory=(await api("/api/memory?"+query.toString())).facts;state.memoryLoaded=true;if(state.tab==="memory")memoryView();}catch(error){state.memoryError=error.message;state.memoryLoaded=false;if(state.tab==="memory")app.innerHTML='<div class="page-head"><div><h1>기억</h1><p class="lead">기억을 불러오지 못했어요.</p></div></div><div class="card warning">'+esc(error.message)+'<div class="actions"><button class="btn" data-retry-memory>다시 시도</button><button class="btn" data-copy="nautli doctor">doctor 명령 복사</button></div></div>';}finally{state.memoryLoading=false;}}
  function render(){setChrome();if(state.tab!=="graph"&&state.graphCleanup){state.graphCleanup();state.graphCleanup=null;}if(state.statusError){app.innerHTML='<div class="page-head"><div><h1>상태를 불러오지 못했어요</h1><p class="lead">nautli doctor로 저장소를 확인한 뒤 다시 시도해 주세요.</p></div></div><div class="card warning">'+esc(state.statusError)+'<div class="actions"><button class="btn primary" data-retry-status>다시 시도</button><button class="btn" data-copy="nautli doctor">doctor 명령 복사</button></div></div>';return;}if(!state.status){loadingView();return;}if(state.tab==="setup"){setupView();if(state.scan===null&&!state.scanLoading)void loadScan();if(state.checkup===null)void loadCheckup();}else if(state.tab==="graph"){if(state.graphError){loadGraph();}else if(state.graphLoaded){if(!app.querySelector(".graph-canvas"))graphView();}else{loadingView();loadGraph();}}else if(state.tab==="review"){if(state.cardsLoaded)reviewView();else loadingView();loadCards();}else{if(state.memoryError){loadMemory();}else if(state.memoryLoaded)memoryView();else loadingView();loadMemory();}}
  async function pollDigest(previous,expectCards){state.digesting=true;render();try{for(var attempt=0;attempt<120;attempt+=1){await new Promise(function(resolve){setTimeout(resolve,1000);});var next=await api("/api/status");state.status=next;setChrome();var health=next.setup.required.daemon.health;var last=health.last_run;if(last&&last!==previous){if(!health.healthy){toast((health.result&&health.result.reason)||health.error||"소화 테스트에 실패했어요.",true);return;}if(expectCards){state.cardsLoaded=false;await loadCards();if(state.cards.length===0){toast("소화는 끝났지만 도착한 카드가 없어요. judge 연결을 확인해 주세요.",true);return;}state.tab="review";location.hash="review";toast("카드 "+state.cards.length+"장이 도착했어요");return;}toast("소화 테스트를 완료했어요.");return;}}toast("2분 안에 소화가 끝나지 않았어요. 잠시 후 상태를 다시 확인해 주세요.",true);}finally{state.digesting=false;render();}}
  function showDigestError(error){if(error&&error.error==="E_CLAUDE_LOGIN"){toast("Claude CLI 로그인이 풀렸어요. 터미널에서 로그인 후 다시 시도해 주세요.",true,'<button class="btn primary" data-copy="claude /login">로그인 명령 복사</button>');return;}toast(error&&error.message?error.message:"소화 테스트에 실패했어요.",true);}
  async function setupAction(name,button){var old=button.textContent;var previous=state.status.setup.required.daemon.health.last_run;button.disabled=true;button.textContent=name==="mcp"||name==="codex"?"등록 중…":name==="digest"?"소화 중… 최대 2분":"처리 중…";var doneMessage={init:"기억 저장소를 만들었어요. 전부 이 컴퓨터 안에만 저장돼요.",mcp:"Claude Code에 연결했어요.",codex:"Codex에 연결했어요.",instructions:"CLAUDE.md에 지시문을 설치했어요.","instructions-remove":"지시문을 제거했어요.",daemon:"밤 소화 데몬을 설치했어요. 매일 밤 3:30에 돌아요.","daemon-remove":"데몬을 제거했어요.","sample-remove":"샘플을 지웠어요."}[name]||"완료했어요.";try{await post("/api/setup/"+name);toast(name==="digest"?"소화를 시작했어요. 완료될 때까지 확인합니다.":doneMessage);document.getElementById("modal").classList.add("hidden");await loadStatus();if(name==="digest")void pollDigest(previous);}catch(error){if(error.manual_command&&(name==="mcp"||name==="codex"))openModal(agentLabel(name==="codex"?"codex":"claude")+" 수동 등록",error.message,error.manual_command,'<button class="btn primary" data-copy="'+esc(error.manual_command)+'">복사</button>');if(name==="digest")showDigestError(error);else toast(error.message,true);}finally{if(button.isConnected){button.disabled=false;button.textContent=old;}}}
  document.addEventListener("click",async function(event){
    var themeToggle=event.target.closest("#theme-toggle");if(themeToggle){cycleTheme();return;}
    var tab=event.target.closest("[data-tab]");if(tab){state.tab=tab.dataset.tab;render();if(location.hash!=="#"+state.tab)location.hash=state.tab;return;}
    var scan=event.target.closest("[data-scan-usage]");if(scan){await runUsageScan(scan);return;}
    var checklistExpand=event.target.closest("[data-checklist-expand]");if(checklistExpand){state.checklistExpanded=true;setupView();return;}
    var checklistCollapse=event.target.closest("[data-checklist-collapse]");if(checklistCollapse){state.checklistExpanded=false;state.checklistOpen="";setupView();return;}
    var checklistToggle=event.target.closest("[data-checklist-toggle]");if(checklistToggle){state.checklistOpen=state.checklistOpen===checklistToggle.dataset.checklistToggle?"":checklistToggle.dataset.checklistToggle;setupView();return;}
    var refreshStatus=event.target.closest("[data-refresh-status]");if(refreshStatus){refreshStatus.disabled=true;try{await loadStatus();}catch(error){toast(error.message,true);}finally{if(refreshStatus.isConnected)refreshStatus.disabled=false;}return;}
    var starGithub=event.target.closest("[data-star-github]");if(starGithub){document.getElementById("toast").classList.add("hidden");window.open("https://github.com/Nautli/nautli","_blank","noopener,noreferrer");return;}
    var starLater=event.target.closest("[data-star-later]");if(starLater){document.getElementById("toast").classList.add("hidden");return;}
    var close=event.target.closest("[data-close-modal]");if(close){document.getElementById("modal").classList.add("hidden");return;}
    var continuityCopy=event.target.closest("[data-continuity-copy]");if(continuityCopy){var claim=continuityClaim();if(!claim){toast("기억할 습관을 한 문장으로 적어 주세요.",true);return;}ensureContinuitySince();state.continuity.a="waiting";state.continuity.factClaim=claim;saveContinuity();await copyText("기억해줘: "+claim,"Claude Code에 붙여넣을 문장을 복사했어요.");setupView();ensureContinuityPolling();return;}
    var continuityAccept=event.target.closest("[data-continuity-accept]");if(continuityAccept&&state.continuity.candidate){var accepted=state.continuity.candidate;state.continuity.a="done";state.continuity.b="ready";state.continuity.factId=accepted.fact_id;state.continuity.factClaim=accepted.claim;state.continuity.factResult=accepted.result||"added";state.continuity.candidate=null;state.continuity.ignoredCandidate="";saveContinuity();stopContinuityPolling();setupView();return;}
    var continuityReject=event.target.closest("[data-continuity-reject]");if(continuityReject&&state.continuity.candidate){state.continuity.ignoredCandidate=continuityCandidateKey(state.continuity.candidate);state.continuity.candidate=null;saveContinuity();setupView();ensureContinuityPolling();return;}
    var continuitySkip=event.target.closest("[data-continuity-skip]");if(continuitySkip){var step=continuitySkip.dataset.continuitySkip;state.continuity[step]="skipped";if(step==="a"&&state.continuity.b==="locked")state.continuity.b="ready";stopContinuityPolling();saveContinuity();setupView();return;}
    var continuityRecall=event.target.closest("[data-continuity-recall]");if(continuityRecall){state.continuity.b="reading";saveContinuity();setupView();try{var recalled=await post("/api/continuity/recall",{fact_id:state.continuity.factId});state.continuity.recalled=recalled.fact;state.continuity.b="done";saveContinuity();setupView();}catch(error){state.continuity.b="ready";saveContinuity();setupView();toast(error.message,true);}return;}
    var cursorQuestion=event.target.closest("[data-continuity-cursor-question]");if(cursorQuestion){state.continuity.crossSince=new Date(Date.now()-1000).toISOString();state.continuity.c="waiting";saveContinuity();await copyText(cursorQuestion.dataset.continuityCursorQuestion,"Cursor에서 물어볼 질문을 복사했어요.");setupView();ensureContinuityPolling();return;}
    var share=event.target.closest("[data-share-card]");if(share){share.disabled=true;try{await openShareCard();}catch(error){toast(error.message,true);}finally{if(share.isConnected)share.disabled=false;}return;}
    var shareCopy=event.target.closest("[data-copy-share]");if(shareCopy){var shareText=shareCopy.dataset.copyShare;try{shareText=shareSnippet(await api("/api/checkup/share-card"));}catch(error){}await copyText(shareText,"X용 문구를 복사했어요.");return;}
    var shareDownload=event.target.closest("[data-share-download]");if(shareDownload){var shareCanvas=document.getElementById("share-canvas");if(!shareCanvas)return;shareDownload.disabled=true;shareCanvas.toBlob(function(blob){if(!blob){toast("PNG를 만들지 못했어요.",true);shareDownload.disabled=false;return;}var url=URL.createObjectURL(blob);var link=document.createElement("a");link.href=url;link.download="nautli-memory-checkup.png";link.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);shareDownload.disabled=false;toast("PNG를 저장했어요.");},"image/png");return;}
    var preview=event.target.closest("[data-preview]");if(preview){try{var data=await api("/api/instructions/preview");openModal("추가될 블록 미리보기","추가될 위치와 마커 사이의 순수 블록을 확인하세요.",data.preview,'<button class="btn primary" data-setup="instructions">Claude Code 지시문 추가</button>');}catch(error){toast(error.message,true);}return;}
    var daemonPreview=event.target.closest("[data-daemon-preview]");if(daemonPreview){var daemonInfo=state.status.setup.required.daemon;openModal("설치 전에 확인하세요","컴퓨터에 등록되는 것과 하는 일이에요. 언제든 [제거]로 되돌릴 수 있어요.","등록: launchd 예약 작업 1개 (com.nautli.daemon)\\n파일: "+daemonInfo.plist+"\\n실행: 매일 밤 3:30, 이 컴퓨터 안에서만\\n하는 일: 중복 기억 병합 · 모순은 카드로만 올림(자동 삭제 없음)\\n제거: 설정 화면의 [제거] 버튼",'<button class="btn primary" data-setup="daemon">데몬 설치</button>');return;}
    var agentPrompt=event.target.closest("[data-copy-agent-prompt]");if(agentPrompt){await copyText(checkupAgentPrompt(),"프롬프트를 복사했어요. 쓰는 AI 채팅에 붙여넣으세요.");state.checkupWatch=Date.now();loadCheckup();return;}
    var copy=event.target.closest("[data-copy]");if(copy){await copyText(copy.dataset.copy,"명령을 복사했어요.");return;}
    var copyCursorConfirm=event.target.closest("[data-copy-cursor-confirm]");if(copyCursorConfirm){await copyText(JSON.stringify({mcpServers:{nautli:{command:"nautli",args:["mcp"]}}},null,2),"Cursor 설정을 복사했어요. mcp.json에 붙여 넣으세요.");return;}
    var copyCursor=event.target.closest("[data-copy-cursor]");if(copyCursor){openModal("Cursor에 추가할 설정","Cursor의 mcp.json에 아래 블록을 추가하면 같은 기억을 씁니다. 복사만 되고 파일은 직접 건드리지 않아요.",JSON.stringify({mcpServers:{nautli:{command:"nautli",args:["mcp"]}}},null,2),'<button class="btn primary" data-copy-cursor-confirm>복사</button>');return;}
    var copyInstructions=event.target.closest("[data-copy-instructions]");if(copyInstructions){try{var instruction=await api("/api/instructions/preview");await copyText(instruction.block,"지시문을 복사했어요.");}catch(error){toast(error.message,true);}return;}
    var checkupOpen=event.target.closest("[data-checkup-open]");if(checkupOpen){checkupOpen.disabled=true;try{await openCheckupModal();}catch(error){toast(error.message,true);}finally{checkupOpen.disabled=false;}return;}
    var checkupPreflight=event.target.closest("[data-checkup-preflight]");if(checkupPreflight){var custom=(document.getElementById("checkup-custom")||{}).value||"";if(!custom.trim()){toast("확인할 폴더 경로를 입력해 주세요.",true);return;}document.querySelectorAll('input[name="checkup-path"]').forEach(function(input){input.checked=false;});await loadCheckupPreflight(custom.trim(),[]);return;}
    var checkupStart=event.target.closest("[data-checkup-start]");if(checkupStart){if(!state.checkupPreflight||!state.checkupPreflight.ok)return;var excluded=[].slice.call(document.querySelectorAll("[data-checkup-dir]")).filter(function(input){return !input.checked;}).map(function(input){return input.value;});checkupStart.disabled=true;try{await post("/api/checkup/start",{path:state.checkupPath,excluded_dirs:excluded});document.getElementById("modal").classList.add("hidden");toast("진단을 시작했어요. 진행 중인 발견도 이 화면에 바로 보여요.");await loadCheckup();}catch(error){toast(error.message,true);checkupStart.disabled=false;}return;}
    var checkupImport=event.target.closest("[data-checkup-import]");if(checkupImport){checkupImport.disabled=true;checkupImport.textContent="가져오는 중…";try{var imported=await post("/api/checkup/import");state.memoryLoaded=false;state.cardsLoaded=false;toast("기억 "+imported.imported+"건을 가져왔어요."+(imported.duplicates?" 중복 "+imported.duplicates+"건은 게이트가 걸렀어요.":"")+(imported.cards?" 리뷰 카드 "+imported.cards+"장도 카드 탭에 올렸어요.":"")+(imported.omitted>0?" (표본 캡으로 "+imported.omitted+"건은 제외)":""));await loadCheckup();await loadStatus();}catch(error){toast(error.message,true);if(checkupImport.isConnected){checkupImport.disabled=false;checkupImport.textContent="이 기억 가져오고 연결 계속";}}return;}
    var checkupReport=event.target.closest("[data-checkup-report]");if(checkupReport){try{var reportData=await api("/api/checkup/report");openModal("건강검진 전체 리포트","이 파일은 내 컴퓨터에만 있어요.",reportData.report,"");}catch(error){toast(error.message,true);}return;}
    var checkupDismiss=event.target.closest("[data-checkup-dismiss]");if(checkupDismiss){try{await post("/api/checkup/dismiss");await loadCheckup();}catch(error){toast(error.message,true);}return;}
    var setup=event.target.closest("[data-setup]");if(setup){setupAction(setup.dataset.setup,setup);return;}
    var sample=event.target.closest("[data-sample]");if(sample){var sampleOld=sample.textContent;try{var previous=state.status.setup.required.daemon.health.last_run;sample.disabled=true;sample.textContent="소화 중… 최대 2분";await post("/api/setup/sample");await post("/api/setup/digest");toast("샘플을 저장하고 소화를 시작했어요.");await loadStatus();void pollDigest(previous,true);}catch(error){showDigestError(error);}finally{if(sample.isConnected){sample.disabled=false;sample.textContent=sampleOld;}}return;}
    var retryStatus=event.target.closest("[data-retry-status]");if(retryStatus){state.statusError=null;state.status=null;loadingView();loadStatus().catch(function(error){state.statusError=error.message;render();toast(error.message,true);});return;}
    var retryCards=event.target.closest("[data-retry-cards]");if(retryCards){loadingView();loadCards();return;}
    var refreshGraph=event.target.closest("[data-refresh-graph]");if(refreshGraph){loadGraph(true);return;}
    var retryMemory=event.target.closest("[data-retry-memory]");if(retryMemory){state.memoryError=null;state.memoryLoaded=false;loadingView();loadMemory();return;}
    var other=event.target.closest("[data-other]");if(other){var pair=other.parentElement.dataset.pair;document.querySelector('[data-other-form="'+pair+'"]')?.classList.remove("hidden");return;}
    var action=event.target.closest("[data-action]");if(action&&action.closest("[data-pair], [data-other-form]")){var holder=action.closest("[data-pair]")||action.closest("[data-other-form]");var pairId=holder.dataset.pair||holder.dataset.otherForm;var extra=action.dataset.action==="other"?holder.querySelector("input").value:undefined;try{action.disabled=true;action.textContent="처리 중…";var handled=await post("/api/cards/"+pairId,{action:action.dataset.action,extraText:extra});if(handled.ok!==true)throw new Error("이미 처리된 카드예요. 상태를 새로고침해 주세요.");await loadStatus();state.tab="review";await loadCards();setChrome();if(!await maybeShowStarNag())toast("카드를 처리했어요.");}catch(error){toast(error.message,true);if(action.isConnected)action.disabled=false;}return;}
    var memory=event.target.closest("[data-memory]");if(memory){memory.querySelector("[data-detail]").classList.toggle("hidden");}
  });
  document.addEventListener("keydown",function(event){if(event.key!=="Enter"||event.defaultPrevented||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||state.tab!=="setup")return;var target=event.target;if(target&&target.closest("input,textarea,select,button,a,[contenteditable=true]"))return;var modal=document.getElementById("modal");var scope=modal.classList.contains("hidden")?app:modal;var primary=[].slice.call(scope.querySelectorAll(".btn.primary:not(:disabled)")).find(function(button){return button.offsetParent!==null;});if(!primary)return;event.preventDefault();primary.click();});
  document.addEventListener("change",function(event){var form=event.target.closest("#memory-search");if(form&&(event.target.name==="includeDead"||event.target.name==="scope")){if(form.requestSubmit)form.requestSubmit();else form.dispatchEvent(new Event("submit",{cancelable:true,bubbles:true}));return;}if(event.target.name==="continuity-memory"){state.continuity.choice=event.target.value;saveContinuity();setupView();return;}if(event.target.name==="checkup-path"){var custom=document.getElementById("checkup-custom");if(custom)custom.value="";void loadCheckupPreflight(event.target.value,[]);return;}if(event.target.matches("[data-checkup-dir]")){var excluded=[].slice.call(document.querySelectorAll("[data-checkup-dir]")).filter(function(input){return !input.checked;}).map(function(input){return input.value;});void loadCheckupPreflight(state.checkupPath,excluded);}});
  document.addEventListener("input",function(event){if(event.target.id!=="continuity-custom")return;state.continuity.custom=event.target.value;if(event.target.value.trim())state.continuity.choice="custom";saveContinuity();var button=document.querySelector("[data-continuity-copy]");if(button)button.disabled=!continuityClaim();});
  document.addEventListener("submit",async function(event){
    if(event.target.id==="memory-search"){event.preventDefault();var data=new FormData(event.target);state.memoryQuery=String(data.get("q")||"");state.memoryScope=String(data.get("scope")||"");state.includeDead=data.get("includeDead")!==null;await loadMemory();}
  });
  window.addEventListener("hashchange",function(){var tab=location.hash.slice(1);if(TABS.includes(tab)&&state.tab!==tab){state.tab=tab;render();}});
  void loadScan();
  loadStatus().catch(function(error){state.statusError=error.message;render();toast(error.message,true);});
}());
</script>
</body>
</html>`;
