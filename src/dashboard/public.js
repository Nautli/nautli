import { BRAND } from "../brand.js";
import { STRINGS } from "../i18n/strings.js";

const CLIENT_STRINGS = JSON.stringify(STRINGS)
  .replace(/</gu, "\\u003c")
  .replace(/\u2028/gu, "\\u2028")
  .replace(/\u2029/gu, "\\u2029");

export const HTML = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${BRAND}</title>
<script>
(function(){var mode="dark";var languageMode="auto";try{var stored=localStorage.getItem("nautli-theme");if(stored==="dark"||stored==="light"||stored==="system")mode=stored;var storedLanguage=localStorage.getItem("nautli-lang");if(storedLanguage==="en"||storedLanguage==="ko"||storedLanguage==="auto")languageMode=storedLanguage;}catch(error){}var systemDark=typeof window.matchMedia==="function"&&window.matchMedia("(prefers-color-scheme: dark)").matches;var browserLanguage=String(navigator.language||"").toLowerCase();document.documentElement.dataset.theme=mode==="system"?(systemDark?"dark":"light"):mode;document.documentElement.lang=languageMode==="auto"?(browserLanguage.indexOf("ko")===0?"ko":"en"):languageMode;}());
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
.sidebar-toggles{display:flex;align-items:center;gap:2px;margin:auto 10px 12px}
.theme-toggle,.language-toggle{display:flex;align-items:center;gap:7px;margin:0;border:0;border-radius:var(--radius-sm);background:transparent;color:var(--muted-foreground);padding:7px 10px;font-size:12px;line-height:1.4;text-align:left;white-space:nowrap}
.theme-toggle:hover,.language-toggle:hover{background:color-mix(in srgb,var(--accent) 25%,transparent);color:var(--foreground)}
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
  .sidebar-toggles{position:absolute;top:8px;right:8px;margin:0}
  .language-toggle{padding-left:7px;padding-right:7px}
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
  <nav class="nav" aria-label="Dashboard"><button data-tab="setup"></button><button data-tab="graph"></button><button data-tab="review"><span data-tab-label></span> <span id="pending-badge" class="badge hidden">0</span></button><button data-tab="memory"></button></nav><div class="sidebar-toggles"><button id="theme-toggle" class="theme-toggle" type="button"><span aria-hidden="true">◐</span><span></span></button><button id="language-toggle" class="language-toggle" type="button"><span aria-hidden="true">文</span><span></span></button></div></aside>
  <main id="app" class="page"><div class="page-head"><div><h1>${BRAND}</h1><p class="lead"></p></div></div></main>
</div>
<div id="toast" class="toast hidden" role="status"></div>
<div id="modal" class="modal-wrap hidden" role="dialog" aria-modal="true"><div class="modal"><div class="page-head"><div><h1 id="modal-title"></h1><p id="modal-lead" class="lead"></p></div><button class="btn" data-close-modal></button></div><pre id="preview"></pre><div id="modal-body" class="hidden"></div><textarea id="manual-copy" class="field hidden" readonly></textarea><div id="modal-actions" class="actions"></div></div></div>
<script>
(function(){
  "use strict";
  var STRINGS=${CLIENT_STRINGS};
  var languageMode="auto";try{var savedLanguage=localStorage.getItem("nautli-lang");if(savedLanguage==="en"||savedLanguage==="ko"||savedLanguage==="auto")languageMode=savedLanguage;}catch(error){}
  function resolveClientLocale(){if(languageMode==="en"||languageMode==="ko")return languageMode;return String(navigator.language||"").toLowerCase().indexOf("ko")===0?"ko":"en";}
  var locale=resolveClientLocale();
  function t(key,vars){var entry=STRINGS[key];var template=entry?(entry[locale]||entry.en):key;return String(template).replace(/\{([A-Za-z0-9_]+)\}/g,function(match,name){return vars&&Object.prototype.hasOwnProperty.call(vars,name)?String(vars[name]):match;});}
  var TABS=["setup","graph","review","memory"];
  var initialTab=location.hash.slice(1);var state={status:null,statusError:null,tab:TABS.includes(initialTab)?initialTab:"setup",cards:[],cardsLoaded:false,memory:[],memoryLoaded:false,memoryLoading:false,memoryError:null,memoryQuery:"",memoryScope:"",includeDead:false,graph:null,graphLoaded:false,graphLoading:false,graphError:null,graphCleanup:null,statusTimer:null,digesting:false,checkup:null,checkupError:null,checkupTimer:null,checkupPath:"",checkupPreflight:null,continuityTimer:null,continuityPolling:false,continuity:null,shareCard:null,scan:null,scanLoading:false,scanError:null,scanErrorToastShown:false,scanAutoRefreshAttempted:false,checklistOpen:"",checklistExpanded:false};
  try{state.continuity=JSON.parse(localStorage.getItem("nautli-continuity")||"null");}catch(error){}
  if(!state.continuity)state.continuity={choice:t("dash.continuity.example_commit"),custom:"",a:"ready",b:"locked",c:"ready",factId:"",factClaim:"",since:"",crossSince:"",recalled:null,candidate:null,ignoredCandidate:""};
  if(state.continuity.candidate===undefined)state.continuity.candidate=null;if(state.continuity.ignoredCandidate===undefined)state.continuity.ignoredCandidate="";
  var app=document.getElementById("app");
  var themeMedia=typeof window.matchMedia==="function"?window.matchMedia("(prefers-color-scheme: dark)"):null;var themeMode="dark";try{var savedTheme=localStorage.getItem("nautli-theme");if(savedTheme==="dark"||savedTheme==="light"||savedTheme==="system")themeMode=savedTheme;}catch(error){}
  function applyTheme(persist){var resolved=themeMode==="system"?(themeMedia&&themeMedia.matches?"dark":"light"):themeMode;document.documentElement.dataset.theme=resolved;var toggle=document.getElementById("theme-toggle");var label=t("dash.theme."+themeMode);if(toggle){toggle.lastElementChild.textContent=t("dash.theme.label",{mode:label});toggle.setAttribute("aria-label",t("dash.theme.label",{mode:label}));}if(persist){try{localStorage.setItem("nautli-theme",themeMode);}catch(error){}}window.dispatchEvent(new CustomEvent("nautli-theme-change",{detail:{mode:themeMode,resolved:resolved}}));}
  function cycleTheme(){var themes=["dark","light","system"];themeMode=themes[(themes.indexOf(themeMode)+1)%themes.length];applyTheme(true);}
  function handleSystemThemeChange(){if(themeMode==="system")applyTheme(false);}if(themeMedia){if(typeof themeMedia.addEventListener==="function")themeMedia.addEventListener("change",handleSystemThemeChange);else if(typeof themeMedia.addListener==="function")themeMedia.addListener(handleSystemThemeChange);}applyTheme(false);
  function localizeChrome(){document.documentElement.lang=locale;var nav=document.querySelector(".nav");if(nav)nav.setAttribute("aria-label",t("dash.nav.aria"));document.querySelectorAll(".nav [data-tab]").forEach(function(button){var label=t("dash.nav."+button.dataset.tab);var target=button.querySelector("[data-tab-label]");if(target)target.textContent=label;else button.textContent=label;});var languageToggle=document.getElementById("language-toggle");if(languageToggle){var languageLabel=t("dash.language."+languageMode);languageToggle.lastElementChild.textContent=t("dash.language.label",{language:languageLabel});languageToggle.setAttribute("aria-label",t("dash.language.label",{language:languageLabel}));}var close=document.querySelector("[data-close-modal]");if(close)close.textContent=t("dash.action.close");var manual=document.getElementById("manual-copy");if(manual)manual.setAttribute("aria-label",t("dash.copy.manual_aria"));var initialLead=app.querySelector(".lead");if(!state.status&&initialLead)initialLead.textContent=t("dash.status.checking_local");applyTheme(false);}
  function cycleLanguage(){var languages=["en","ko","auto"];languageMode=languages[(languages.indexOf(languageMode)+1)%languages.length];try{localStorage.setItem("nautli-lang",languageMode);}catch(error){}locale=resolveClientLocale();localizeChrome();render();}
  function esc(value){return String(value==null?"":value).replace(/[&<>"']/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch];});}
  function toast(message,error,actionsHtml){var el=document.getElementById("toast");el.innerHTML='<div>'+esc(message)+'</div>'+(actionsHtml?'<div class="actions">'+actionsHtml+'</div>':'');el.className="toast"+(error?" error":"");clearTimeout(toast.timer);if(!actionsHtml)toast.timer=setTimeout(function(){el.classList.add("hidden");},3500);}
  function scopeLabel(scope){return scope==="person"?t("dash.scope.person"):scope==="procedure"?t("dash.scope.procedure"):t("dash.scope.project",{name:String(scope||"").replace(/^project:/,"")});}
  function openModal(title,lead,preText,actionsHtml,bodyHtml){document.getElementById("modal-title").textContent=title;document.getElementById("modal-lead").textContent=lead;var pre=document.getElementById("preview");pre.textContent=preText;pre.classList.toggle("hidden",!preText);var body=document.getElementById("modal-body");body.innerHTML=bodyHtml||"";body.classList.toggle("hidden",!bodyHtml);document.getElementById("modal-actions").innerHTML=actionsHtml||"";document.getElementById("manual-copy").classList.add("hidden");document.getElementById("modal").classList.remove("hidden");}
  async function copyText(value,message){
    try{await navigator.clipboard.writeText(value);toast(message);return true;}catch(error){}
    try{var temp=document.createElement("textarea");temp.value=value;temp.setAttribute("readonly","");temp.style.position="fixed";temp.style.opacity="0";document.body.appendChild(temp);temp.focus();temp.select();var copied=document.execCommand("copy");temp.remove();if(copied){toast(message);return true;}}catch(error){}
    openModal(t("dash.copy.manual_title"),t("dash.copy.manual_lead"),"");var fallback=document.getElementById("manual-copy");fallback.value=value;fallback.classList.remove("hidden");fallback.focus();fallback.select();toast(t("dash.copy.failed"),true);return false;
  }
  async function api(url,options){var requestOptions=Object.assign({},options||{});requestOptions.headers=Object.assign({"accept-language":locale},requestOptions.headers||{});var response=await fetch(url,requestOptions);var data=await response.json();if(!response.ok){var error=new Error(data.message||t("dash.error.generic"));Object.assign(error,data);throw error;}return data;}
  function post(url,body){return api(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body||{})});}
  function fmt(value){if(!value)return t("dash.common.no_record");var date=new Date(value);return Number.isNaN(date.getTime())?String(value):date.toLocaleString(locale==="ko"?"ko-KR":"en-US");}
  function nextRunMs(daemon){var next=Number(daemon.next_run_ms);var now=Date.now();if(!Number.isFinite(next)){next=new Date(daemon.next_run).getTime();}if(!Number.isFinite(next)){var fallback=new Date();fallback.setHours(3,30,0,0);next=fallback.getTime();}var date=new Date(next);while(date.getTime()<=now)date.setDate(date.getDate()+1);return date.getTime();}
  function sampleState(){var optional=state.status&&state.status.setup.optional;return (optional&&optional.sample)||{complete:false};}
  function scanAgents(){return state.scan&&Array.isArray(state.scan.agents)?state.scan.agents:[];}
  function agentLabel(name){return {claude:"Claude Code",codex:"Codex",cursor:"Cursor",gemini:"Gemini"}[name]||name;}
  function detectedAgents(){return scanAgents().filter(function(agent){return agent.installed===true;});}
  function detectedLine(suffix){var agents=detectedAgents();return t("dash.scan.detected",{count:agents.length,agents:agents.length?" · "+agents.map(function(agent){return agentLabel(agent.name);}).join(", "):"",suffix:suffix?" · "+suffix:""});}
  function scanFailure(message){state.scanError=message||t("dash.scan.failed");if(!state.scanErrorToastShown){state.scanErrorToastShown=true;toast(state.scanError,true);}if(state.tab==="setup"&&state.status)setupView();}
  async function refreshStaleScan(){if(state.scanAutoRefreshAttempted)return;state.scanAutoRefreshAttempted=true;state.scanLoading=true;try{var result=await post("/api/scan");if(result.ok===false)throw new Error(result.reason||t("dash.scan.failed"));state.scan=result;state.scanError=null;state.scanErrorToastShown=false;}catch(error){state.scanError=error.message||t("dash.scan.failed");}finally{state.scanLoading=false;if(state.tab==="setup"&&state.status)setupView();}}
  async function loadScan(){if(state.scanLoading)return;state.scanLoading=true;var refresh=false;try{var result=await api("/api/scan");if(result.ok===false){scanFailure(result.reason);return;}state.scan=result;state.scanError=null;state.scanErrorToastShown=false;refresh=result.stale===true&&Boolean(result.usage)&&!state.scanAutoRefreshAttempted;}catch(error){scanFailure(error.message);}finally{state.scanLoading=false;if(state.tab==="setup"&&state.status)setupView();}if(refresh)void refreshStaleScan();}
  async function runUsageScan(button){if(state.scanLoading)return;state.scanLoading=true;state.scanError=null;state.scanErrorToastShown=false;var old=button.textContent;button.disabled=true;button.textContent=t("dash.scan.detecting");try{var result=await post("/api/scan");if(result.ok===false){scanFailure(result.reason);return;}state.scan=result;state.scanError=null;}catch(error){scanFailure(error.message);}finally{state.scanLoading=false;if(state.tab==="setup"&&state.status)setupView();if(button.isConnected){button.disabled=false;button.textContent=old;}}}
  function setupHero(){var title=t("dash.hero.title");var lead=state.scanError?detectedLine(""):state.scan?detectedLine(""):t("dash.scan.detecting_ai");var usage=state.scan&&state.scan.usage;var remembered=Number(state.scan&&state.scan.remembered||0);if(usage){var claude=Number(usage.claude_sessions30d||0);var codex=Number(usage.codex_sessions30d||0);var total=claude+codex;if(total>=10){title=t("dash.hero.usage_title",{claude:claude,codex:codex,remembered:remembered});lead=remembered===0?t("dash.hero.next_conversation"):t("dash.hero.remembered_sessions",{sessions:total,remembered:remembered});}else{title=t("dash.hero.detected_title",{count:detectedAgents().length});lead=remembered===0?t("dash.hero.next_conversation"):t("dash.hero.remembered_count",{count:remembered});}}
    var label=state.scanError?t("dash.action.detect_again"):usage?t("dash.action.check_again"):t("dash.action.check_usage");return '<div class="hero"><h1>'+esc(title)+'</h1><p class="lead">'+esc(lead)+'</p><div class="hero-actions"><button class="btn quiet" data-scan-usage '+(state.scanLoading?'disabled':'')+'>'+label+'</button><span class="microcopy">'+t("dash.hero.privacy")+'</span></div></div>';}
  async function maybeShowStarNag(){if(state.status&&state.status.star_nag_shown_at)return false;try{var result=await post("/api/star-nag-seen");if(!result.recorded)return false;toast(t("dash.star.prompt"),false,'<button class="btn primary" data-star-github>'+t("dash.action.open_github")+'</button><button class="btn quiet" data-star-later>'+t("dash.action.later")+'</button>');return true;}catch(error){return false;}}
  function saveContinuity(){try{localStorage.setItem("nautli-continuity",JSON.stringify(state.continuity));}catch(error){}}
  function ensureContinuitySince(){if(state.continuity.since)return;state.continuity.since=new Date(Date.now()-1000).toISOString();saveContinuity();}
  function continuityClaim(){return state.continuity.choice==="custom"?state.continuity.custom.trim():state.continuity.choice;}
  function normalizeContinuityClaim(value){return String(value||"").trim().replace(/\\s+/g," ").replace(/[.。]/g,"");}
  function continuityClaimsMatch(leftValue,rightValue){var left=normalizeContinuityClaim(leftValue);var right=normalizeContinuityClaim(rightValue);return Boolean(left&&right&&(left===right||left.includes(right)||right.includes(left)));}
  function continuityCandidateKey(item){return String(item.fact_id||"")+"|"+String(item.at||"");}
  function continuityWaitCopy(){var elapsed=Math.max(0,Date.now()-Date.parse(state.continuity.since||new Date().toISOString()));if(elapsed<15000)return t("dash.continuity.pasted");if(elapsed<60000)return t("dash.continuity.auto_detect");return t("dash.continuity.wait_long")+' <button class="btn quiet" data-copy="nautli doctor">'+t("dash.action.run_diagnosis")+'</button>';}
  function updateContinuityWait(){var el=document.getElementById("continuity-wait");if(el)el.innerHTML=continuityWaitCopy();}
  function stopContinuityPolling(){clearTimeout(state.continuityTimer);state.continuityTimer=null;state.continuityPolling=false;}
  function ensureContinuityPolling(){if(state.continuityPolling)return;var kind=state.continuity.a==="ready"||state.continuity.a==="waiting"?"remember":state.continuity.c==="waiting"?"recall":null;if(!kind){stopContinuityPolling();return;}state.continuityPolling=true;void pollContinuity(kind);}
  async function pollContinuity(kind){var waiting=kind==="remember"?(state.continuity.a==="ready"||state.continuity.a==="waiting"):state.continuity.c==="waiting";if(!waiting){stopContinuityPolling();return;}clearTimeout(state.continuityTimer);state.continuityTimer=null;var since=kind==="remember"?state.continuity.since:state.continuity.crossSince;try{var data=await api("/api/activity?since="+encodeURIComponent(since));waiting=kind==="remember"?(state.continuity.a==="ready"||state.continuity.a==="waiting"):state.continuity.c==="waiting";if(!waiting){stopContinuityPolling();return;}var targetClaim=state.continuity.factClaim||continuityClaim();var match=data.events.find(function(item){if(item.source!=="mcp")return false;if(kind==="remember")return item.type==="remember"&&continuityClaimsMatch(item.claim,targetClaim);return item.type==="recall"&&Array.isArray(item.hits)&&item.hits.includes(state.continuity.factId);});if(match){if(kind==="remember"){state.continuity.a="done";state.continuity.b="ready";state.continuity.factId=match.fact_id;state.continuity.factClaim=match.claim;state.continuity.factResult=match.result||"added";state.continuity.candidate=null;state.continuity.ignoredCandidate="";}else state.continuity.c="done";saveContinuity();stopContinuityPolling();if(state.tab==="setup")setupView();return;}if(kind==="remember"){var candidates=data.events.filter(function(item){return item.source==="mcp"&&item.type==="remember";});var candidate=candidates[candidates.length-1];if(candidate&&continuityCandidateKey(candidate)!==state.continuity.ignoredCandidate){var previousKey=state.continuity.candidate?continuityCandidateKey(state.continuity.candidate):"";var nextKey=continuityCandidateKey(candidate);if(previousKey!==nextKey){state.continuity.candidate={fact_id:candidate.fact_id,claim:candidate.claim,result:candidate.result||"added",at:candidate.at};saveContinuity();if(state.tab==="setup")setupView();}}}}catch(error){}
    waiting=kind==="remember"?(state.continuity.a==="ready"||state.continuity.a==="waiting"):state.continuity.c==="waiting";if(!waiting){stopContinuityPolling();return;}updateContinuityWait();state.continuityTimer=setTimeout(function(){state.continuityTimer=null;void pollContinuity(kind);},2000);
  }
  function digestContext(){var daemon=state.status.setup.required.daemon;var result=daemon.health.result||{};var summary=daemon.health.last_run?t("dash.digest.summary",{last:fmt(daemon.health.last_run),applied:esc(result.applied||0),queued:esc(result.queued||(result.report&&result.report.pending)||0)}):t("dash.digest.none_complete");return '<div class="review-context"><span>'+t("dash.digest.next",{date:fmt(nextRunMs(daemon))})+'</span><span>'+summary+'</span></div>';}
  function setChrome(){
    var pending=state.status?state.status.pending:0;var badge=document.getElementById("pending-badge");badge.textContent=String(pending);badge.classList.toggle("hidden",pending===0);
    document.querySelectorAll("[data-tab]").forEach(function(button){button.classList.toggle("active",button.dataset.tab===state.tab);});
    if(!state.status)return;var daemon=state.status.setup.required.daemon;var health=document.getElementById("health");var dot=document.getElementById("health-dot");var label=document.getElementById("health-label");var dawn=document.getElementById("dawn");
    health.classList.toggle("hidden",!daemon.plist_exists);
    dot.className="dot"+(daemon.health.healthy&&!daemon.health.stale?" ok":daemon.plist_exists?" warn":"");label.textContent=daemon.health.healthy&&!daemon.health.stale?t("dash.digest.healthy"):t("dash.digest.needs_check");
    if(!daemon.plist_exists){dawn.className="dawn off";dawn.style.transform="";["title","role","aria-label","aria-valuemin","aria-valuemax","aria-valuenow"].forEach(function(name){dawn.removeAttribute(name);});}else{dawn.className="dawn";var last=Date.parse(daemon.health.last_run);var next=nextRunMs(daemon);var ratio=Number.isFinite(last)&&next>last?Math.max(0,Math.min(1,(Date.now()-last)/(next-last))):0;var percent=Math.round(ratio*100);dawn.style.transform="scaleX("+ratio+")";dawn.setAttribute("role","progressbar");dawn.setAttribute("aria-label",t("dash.digest.progress_aria"));dawn.setAttribute("aria-valuemin","0");dawn.setAttribute("aria-valuemax","100");dawn.setAttribute("aria-valuenow",String(percent));dawn.title=t("dash.digest.progress_title",{percent:percent});}
  }
  async function loadCheckup(){var previous=state.checkup;var previousJson=previous===null?null:JSON.stringify(previous);var previousError=state.checkupError;try{state.checkup=await api("/api/checkup/status");state.checkupError=null;}catch(error){state.checkupError=t("dash.checkup.status_failed");clearTimeout(state.checkupTimer);state.checkupTimer=setTimeout(function(){loadCheckup();},10000);if(state.tab==="setup"&&state.status){var failedSlot=document.getElementById("checkup-slot");if(failedSlot)failedSlot.innerHTML=checkupSlot();else setupView();}return;}
    clearTimeout(state.checkupTimer);
    if(state.checkupWatch&&previous&&previous.state!=="running"&&state.checkup.state==="running"){toast(t("dash.checkup.started_visible"));state.checkupWatch=null;var modal=document.getElementById("modal");if(modal&&!modal.classList.contains("hidden"))modal.classList.add("hidden");}
    if(state.checkup.state==="running"||(state.checkupWatch&&Date.now()-state.checkupWatch<30*60*1000&&state.checkup.state!=="running")){state.checkupTimer=setTimeout(function(){var before=state.checkup&&state.checkup.state;loadCheckup().then(function(){if(before==="running"&&state.checkup.state==="done")toast(t("dash.checkup.finished"));});},5000);}
    var changed=previousJson!==JSON.stringify(state.checkup)||previousError!==state.checkupError;if(changed&&state.tab==="setup"&&state.status){if(previous&&previous.state===state.checkup.state){var slot=document.getElementById("checkup-slot");if(slot)slot.innerHTML=checkupSlot();else setupView();}else setupView();}
  }
  function preflightReason(preflight){if(!preflight.python3.available)return t("dash.checkup.python_required");if(!preflight.claude.cli_exists)return t("dash.error.claude_missing");if(!preflight.claude.logged_in)return t("dash.digest.claude_login");if(preflight.files===0)return t("dash.checkup.no_notes");return t("dash.checkup.preflight_done");}
  function checkupAgentPrompt(){var p=String(state.checkupPath||"").replace(/'/g,"'\\\\''");return t("dash.checkup.agent_prompt",{path:p});}
  function checkupStartButton(){return '<button class="btn primary" data-checkup-start disabled>'+t("dash.action.start_checkup")+'</button>';}
  function renderCheckupPreflight(){var target=document.getElementById("checkup-preflight");if(!target)return;var p=state.checkupPreflight;if(!p){target.innerHTML='<div class="preflight muted">'+t("dash.checkup.checking_folder")+'</div>';document.getElementById("modal-actions").innerHTML=checkupStartButton();return;}var excluded=new Set(p.excluded_dirs||[]);var folders=(p.top_level_dirs||[]).map(function(folder){return '<label><input type="checkbox" data-checkup-dir value="'+esc(folder.name)+'" '+(excluded.has(folder.name)?'':'checked')+'> <span>'+esc(folder.name)+' <span class="badge">'+t("dash.checkup.note_count",{count:esc(folder.files)})+'</span></span></label>';}).join("");var reason=preflightReason(p);target.innerHTML='<div class="folder-list"><strong>'+t("dash.checkup.top_folders")+'</strong>'+(folders||'<span class="muted">'+t("dash.checkup.root_only")+'</span>')+'</div><div class="preflight '+(p.ok?'':'fail')+'"><strong>'+(p.ok?t("dash.checkup.can_start"):esc(reason))+'</strong><p class="muted">'+t("dash.checkup.estimate",{files:esc(p.files),sampled:esc(p.sampled_files),minutes:esc(p.estimated_minutes)})+'</p>'+(!p.ok&&p.python3.available&&(!p.claude.cli_exists||!p.claude.logged_in)?'<p class="muted">'+t("dash.checkup.agent_help")+'</p>':'')+'</div>';var actions='<button class="btn primary" data-checkup-start '+(p.ok?'':'disabled')+'>'+t("dash.action.start_checkup")+'</button>';if(!p.ok)actions+='<button class="btn'+(p.ok?' quiet':'')+'" data-copy-agent-prompt>'+t("dash.action.ask_ai")+'</button>';if(!p.python3.available)actions+='<button class="btn" data-copy="xcode-select --install">'+t("dash.action.copy_python_install")+'</button>';else if(!p.claude.cli_exists)actions+='<button class="btn" data-copy="npm install -g @anthropic-ai/claude-code && claude">'+t("dash.action.copy_claude_install")+'</button>';else if(!p.claude.logged_in)actions+='<button class="btn" data-copy="claude /login">'+t("dash.action.copy_login")+'</button>';if(p.ok)actions+='<button class="btn'+(p.ok?' quiet':'')+'" data-copy-agent-prompt>'+t("dash.action.ask_ai")+'</button>';document.getElementById("modal-actions").innerHTML=actions;}
  async function loadCheckupPreflight(path,excluded){if(!path)return;state.checkupPath=path;state.checkupPreflight=null;renderCheckupPreflight();try{state.checkupPreflight=await post("/api/checkup/preflight",{path:path,excluded_dirs:excluded});renderCheckupPreflight();}catch(error){var target=document.getElementById("checkup-preflight");if(target)target.innerHTML='<div class="preflight fail"><strong>'+esc(error.message)+'</strong><p class="muted">'+t("dash.checkup.check_path_access")+'</p></div>';document.getElementById("modal-actions").innerHTML=checkupStartButton();}}
  var KIND_BADGES={"obsidian":"dash.kind.obsidian","claude-harness":"dash.kind.claude","codex-harness":"dash.kind.codex","gemini-harness":"dash.kind.gemini","cursor-harness":"dash.kind.cursor","shared-memory":"dash.kind.shared"};
  async function openCheckupModal(){var found=(await api("/api/checkup/candidates")).candidates;state.checkupCandidates=found;state.checkupPath=found[0]?found[0].path:"";var body=found.map(function(cand,index){var single=found.length===1;return '<'+(single?'div':'label')+' class="card step" style="cursor:pointer;margin-bottom:8px">'+(single?'':'<input type="radio" name="checkup-path" value="'+esc(cand.path)+'" '+(index===0?'checked':'')+'>')+'<div><h2>'+esc(cand.label)+' <span class="badge">'+t(KIND_BADGES[cand.kind]||"dash.kind.notes")+'</span></h2><p>'+t("dash.checkup.note_path",{count:esc(cand.notes),path:esc(cand.path)})+'</p></div></'+(single?'div':'label')+'>';}).join("");body+='<div class="inline-field"><input class="field" id="checkup-custom" placeholder="'+t(found.length?"dash.checkup.path_or":"dash.checkup.path_prompt")+'"><button class="btn" data-checkup-preflight>'+t("dash.action.check_folder")+'</button></div><div id="checkup-preflight"></div>';openModal(t("dash.checkup.title"),t("dash.checkup.privacy"),"",checkupStartButton(),body);if(state.checkupPath)await loadCheckupPreflight(state.checkupPath,[]);else renderCheckupPreflight();}
  function shareSnippet(data){return t("dash.share.snippet",{contradictions:data.contradictions,duplicates:data.duplicates,minutes:data.minutes});}
  function drawShareCard(canvas,data){var scale=2;canvas.width=600*scale;canvas.height=338*scale;var ctx=canvas.getContext("2d");var styles=getComputedStyle(document.documentElement);function css(name){return styles.getPropertyValue(name).trim();}var colors={background:css("--background"),foreground:css("--foreground"),card:css("--card"),border:css("--border"),muted:css("--muted-foreground"),warning:css("--status-warning"),accent:css("--ai-action-accent")};ctx.scale(scale,scale);ctx.fillStyle=colors.background;ctx.fillRect(0,0,600,338);ctx.strokeStyle=colors.border;ctx.lineWidth=1;ctx.strokeRect(.5,.5,599,337);ctx.fillStyle=colors.foreground;ctx.font='700 21px system-ui,"Apple SD Gothic Neo","Noto Sans KR","Segoe UI",sans-serif';ctx.fillText("nautli",34,42);ctx.fillStyle=colors.muted;ctx.font='500 13px system-ui,"Apple SD Gothic Neo","Noto Sans KR","Segoe UI",sans-serif';ctx.fillText(t("dash.share.found_in",{minutes:data.minutes}),34,77);ctx.fillStyle=colors.foreground;ctx.font='700 48px system-ui,"Apple SD Gothic Neo","Noto Sans KR","Segoe UI",sans-serif';ctx.fillText(t("dash.share.contradictions",{count:data.contradictions}),34,142);ctx.fillStyle=colors.warning;ctx.fillText(t("dash.share.duplicates",{count:data.duplicates}),34,199);ctx.fillStyle=colors.muted;ctx.font='500 15px system-ui,"Apple SD Gothic Neo","Noto Sans KR","Segoe UI",sans-serif';ctx.fillText(t("dash.share.junk",{value:data.junk_percent==null?t("dash.common.not_measured"):t("dash.common.approx_percent",{percent:data.junk_percent})}),34,230);ctx.fillStyle=colors.card;ctx.beginPath();if(typeof ctx.roundRect==="function")ctx.roundRect(34,257,82,27,14);else ctx.rect(34,257,82,27);ctx.fill();ctx.fillStyle=colors.foreground;ctx.font='600 12px system-ui,"Apple SD Gothic Neo","Noto Sans KR","Segoe UI",sans-serif';ctx.fillText(data.score+"/100",52,275);ctx.fillStyle=colors.muted;ctx.fillText(t("dash.share.sampled",{count:data.sampled_notes}),130,275);ctx.fillStyle=colors.accent;ctx.font='600 13px system-ui,"Apple SD Gothic Neo","Noto Sans KR","Segoe UI",sans-serif';ctx.fillText(data.cta,34,313);}
  async function openShareCard(){var data=await api("/api/checkup/share-card");state.shareCard=data;openModal(t("dash.share.preview_title"),t("dash.share.privacy"),"",'<button class="btn primary" data-share-download>'+t("dash.action.download_png")+'</button><button class="btn" data-copy-share="'+esc(shareSnippet(data))+'">'+t("dash.action.copy_x")+'</button>','<canvas id="share-canvas" class="share-canvas" aria-label="'+t("dash.share.preview_aria")+'"></canvas>');requestAnimationFrame(function(){var canvas=document.getElementById("share-canvas");if(canvas)drawShareCard(canvas,data);});}
  function checkupBlock(){
    var c=state.checkup;
    if(!c)return '<section class="card step"><div class="state">…</div><div><h2>'+t("dash.checkup.title")+'</h2><p>'+t("dash.common.checking_status")+'</p></div><div class="actions"></div></section>';
    if(c.state==="dismissed")return "";
    if(c.state==="none")return '<section class="card step next"><div class="state">＋</div><div><h2>'+t("dash.checkup.title")+'</h2><p>'+t("dash.checkup.pitch")+'</p></div><div class="actions"><button class="btn primary" data-checkup-open>'+t("dash.action.diagnose_memory")+'</button><button class="btn quiet" data-checkup-dismiss>'+t("dash.action.skip")+'</button></div></section>';
    if(c.state==="running"){var p=c.progress||{};var judging=p.phase==="judge";var total=judging?p.judge_total:p.batches_total;var completed=judging?p.judge_done:p.batches_done;var pct=total?Math.round((completed||0)/total*100):null;var progressText=judging?(p.judge_total==null?t("dash.checkup.judging"):t("dash.checkup.judge_batches",{done:esc(p.judge_done||0),total:esc(p.judge_total)})):(pct==null?t("dash.checkup.preparing_scan"):t("dash.checkup.extract_batches",{done:esc(p.batches_done||0),total:esc(p.batches_total)}));var findings=c.findings||{contradictions:0,duplicates:0};var teaser=findings.teaser?'<div class="checkup-teaser"><div class="meta"><span class="badge">'+t("dash.checkup.first_finding")+'</span></div><div class="claim">'+esc(findings.teaser.a.claim)+'</div><div class="muted">'+t("dash.checkup.teaser")+'</div></div>':'';return '<section class="card step next"><div class="state">…</div><div><h2>'+t("dash.checkup.running")+'</h2><p>'+t("dash.checkup.running_vault",{vault:esc(c.vault||""),progress:progressText})+'</p>'+(pct!=null?'<div class="progress" style="margin-top:8px"><i style="width:'+pct+'%"></i></div>':'')+'<p><strong>'+t("dash.checkup.findings_so_far",{contradictions:esc(findings.contradictions),duplicates:esc(findings.duplicates)})+'</strong></p>'+teaser+'</div><div class="actions"></div></section>';}
    if(c.state==="failed")return '<section class="card step"><div class="state warn">!</div><div><h2>'+t("dash.checkup.stopped")+'</h2><p>'+esc(c.log_tail||t("dash.common.no_reason"))+'</p></div><div class="actions"><button class="btn" data-checkup-open>'+t("dash.action.retry")+'</button><button class="btn quiet" data-checkup-dismiss>'+t("dash.action.skip")+'</button></div></section>';
    if(c.state==="done"){
      var s=c.summary||{};var contra=s.contradictions||0;var dup=s.duplicates||0;
      var headline=c.partial?t("dash.checkup.partial"):contra>0?t("dash.checkup.contradiction_headline"):dup>0?t("dash.checkup.duplicate_headline"):s.atoms===0?t("dash.checkup.no_atoms"):t("dash.checkup.clean");
      var junkStr=s.junk_rate==null?t("dash.common.not_measured"):"~"+Math.round(s.junk_rate*100)+"%";var filesSampled=c.files_sampled==null?s.notes:c.files_sampled;
      var html='<section class="card"><div class="meta"><span class="badge review-warn">'+t("dash.checkup.results")+'</span><span class="badge">'+esc(c.vault||"")+'</span></div><div class="metric-line"><div class="metric">'+esc(s.score)+'</div><div class="metric-label">'+t("dash.checkup.score_sample",{count:esc(filesSampled)})+'</div></div><p><strong>'+headline+'</strong></p><p class="muted">'+t("dash.checkup.result_summary",{atoms:esc(s.atoms),duplicates:esc(dup),contradictions:esc(contra),junk:junkStr})+'</p>';
      (c.cards||[]).forEach(function(card){html+='<div class="fact"><div class="meta"><span class="badge '+(card.kind==="contradiction"?"review-warn":"")+'">'+t(card.kind==="contradiction"?"dash.checkup.conflict":"dash.checkup.duplicate")+'</span>'+(card.a.src?'<span>'+esc(card.a.src)+'</span>':'')+'</div><div class="claim">A: '+esc(card.a.claim)+'</div><div class="claim">B: '+esc(card.b.claim)+'</div></div>';});
      html+='<div class="actions">'+(s.atoms===0?'':'<button class="btn primary" data-checkup-import>'+t("dash.action.import_continue",{count:esc(Math.min(s.atoms||0,800))})+'</button>')+'<button class="btn quiet" data-checkup-report>'+t("dash.action.full_report")+'</button><button class="btn quiet" data-checkup-dismiss>'+t("dash.action.start_fresh")+'</button></div><p class="hint">'+t("dash.checkup.import_hint")+'</p></section>';
      return html;
    }
    if(c.state==="imported"){var im=c.imported||{};var summary=c.summary||{};return stepRow({title:t("dash.checkup.imported_title",{score:esc(summary.score),count:esc(im.imported||0)}),desc:t("dash.checkup.notes_sampled",{count:esc(c.files_sampled==null?summary.notes:c.files_sampled)}),complete:true,actions:'<button class="btn quiet" data-checkup-report>'+t("dash.action.report")+'</button>'});}
    return "";
  }
  function checkupSlot(){return checkupBlock()+(state.checkupError?'<p class="warning">'+esc(state.checkupError)+'</p>':'');}
  function stepRow(options){
    if(options.complete)return '<section class="card step done"><div class="state ok">✓</div><div><h2>'+options.title+'</h2>'+(options.desc?'<p>'+options.desc+'</p>':'')+'</div><div class="actions">'+(options.actions||'')+'</div></section>';
    return '<section class="card step'+(options.next?' next':'')+'"><div class="state '+(options.warn?'warn':'')+'">'+(options.warn?'!':'○')+'</div><div><h2>'+options.title+'</h2><p>'+options.desc+'</p></div><div class="actions">'+options.actions+'</div></section>';
  }
  function mcpAgent(name){var mcp=state.status.setup.required.mcp;var current=mcp[name]||{};var detected=scanAgents().find(function(agent){return agent.name===name;})||{};return {name:name,installed:current.cli_exists===true||detected.installed===true,connected:current.registered===true,checking:current.status==="checking"||current.cli_exists==null};}
  function checklistState(){var active=Number(state.status.stats&&state.status.stats.byStatus&&state.status.stats.byStatus.active||0);var firstDone=active>0||(state.continuity.a==="done"||state.continuity.a==="skipped")&&(state.continuity.b==="done"||state.continuity.b==="skipped");var checkup=state.checkup||{state:"loading"};var checkupDone=checkup.state==="done"||checkup.state==="imported";var checkupSkipped=checkup.state==="dismissed";var claude=mcpAgent("claude");var codex=mcpAgent("codex");var cursor=state.status.setup.optional.cursor||{};var second;if(claude.connected&&codex.connected){second={title:t("dash.checklist.cursor_title"),desc:cursor.complete?t("dash.checklist.third_connected"):t("dash.checklist.cursor_available"),complete:cursor.complete===true,skipped:false,target:"cursor"};}else{var target=claude.connected?codex:claude;second={title:t("dash.checklist.connect_title",{agent:agentLabel(target.name)}),desc:target.connected?t("dash.checklist.second_connected"):target.checking?t("dash.checklist.checking_connection"):target.installed?t("dash.checklist.agent_shared",{agent:agentLabel(target.name)}):t("dash.checklist.agent_missing",{agent:agentLabel(target.name)}),complete:target.connected,skipped:!target.checking&&!target.installed,target:target.name};}
    var items=[
      {key:"continuity",title:t("dash.continuity.first_memory"),desc:firstDone?state.continuity.a==="skipped"?t("dash.checklist.first_skipped"):active>0&&state.continuity.a!=="done"?t("dash.checklist.real_memory"):t("dash.checklist.first_verified"):t("dash.checklist.first_prompt"),complete:firstDone,skipped:state.continuity.a==="skipped"},
      {key:"checkup",title:t("dash.checkup.title"),desc:checkupDone?t("dash.checklist.checkup_done"):checkupSkipped?t("dash.checklist.checkup_skipped"):checkup.state==="running"?t("dash.checklist.checkup_running"):t("dash.checklist.checkup_prompt"),complete:checkupDone,skipped:checkupSkipped},
      Object.assign({key:"second-ai"},second),
      {key:"share",title:t("dash.checklist.share_title"),desc:checkupDone?t("dash.checklist.share_ready"):checkupSkipped?t("dash.checklist.share_skipped"):t("dash.checklist.share_prompt"),complete:checkupDone,skipped:checkupSkipped},
    ];return {items:items,done:items.filter(function(item){return item.complete||item.skipped;}).length,total:items.length,allDone:items.every(function(item){return item.complete||item.skipped;})};}
  function checklistAction(item,isFirst){var open=state.checklistOpen===item.key;var cls="btn "+(isFirst&&!open?"primary":"quiet");if(item.key==="continuity")return '<button class="'+cls+'" data-checklist-toggle="continuity">'+t(open?"dash.action.collapse":item.complete||item.skipped?"dash.action.view_again":"dash.action.start")+'</button>';if(item.key==="checkup"){if(item.complete)return '<button class="btn quiet" data-checkup-report>'+t("dash.action.view_report")+'</button>';if(item.skipped)return '<button class="'+cls+'" data-checkup-open>'+t("dash.action.diagnose")+'</button>';return '<button class="'+cls+'" data-checklist-toggle="checkup">'+t(open?"dash.action.collapse":state.checkup&&state.checkup.state==="running"?"dash.action.view_progress":"dash.action.diagnose")+'</button>';}
    if(item.key==="second-ai"){if(item.complete||item.skipped)return '<button class="btn quiet" data-refresh-status>'+t("dash.action.refresh_status")+'</button>';if(item.target==="cursor")return '<button class="'+cls+'" data-copy-cursor>'+t("dash.action.copy_cursor_config")+'</button>';return '<button class="'+cls+'" data-setup="'+(item.target==="codex"?"codex":"mcp")+'">'+t("dash.action.auto_register")+'</button>';}
    if(item.complete)return '<button class="btn quiet" data-share-card>'+t("dash.action.share_card")+'</button>';if(item.skipped)return '<button class="btn quiet" data-checkup-open>'+t("dash.action.diagnose")+'</button>';return '<button class="'+cls+'" data-checklist-toggle="checkup">'+t("dash.action.checkup_first")+'</button>';}
  function checklistRow(item,index,firstIncomplete){var done=item.complete||item.skipped;var stateClass=item.complete?" ok":"";var icon=item.complete?"✓":item.skipped?"↷":"○";var title=item.title+(item.skipped?' <span class="badge status-dead">'+t("dash.common.skipped")+'</span>':'');return '<section class="card step '+(done?'done':index===firstIncomplete?'next':'')+'"><div class="state'+stateClass+'">'+icon+'</div><div><h2>'+title+'</h2><p>'+item.desc+'</p></div><div class="actions">'+checklistAction(item,index===firstIncomplete)+'</div></section>';}
  function checklistBlock(){var list=checklistState();if(list.allDone&&!state.checklistExpanded)return '<div class="card banner">'+t("dash.checklist.all_done")+' <button class="btn quiet" data-checklist-expand>'+t("dash.action.view_again")+'</button></div>';var firstIncomplete=list.items.findIndex(function(item){return !item.complete&&!item.skipped;});var html='<div class="checklist-head"><span class="section-title">'+t("dash.checklist.next",{done:list.done,total:list.total})+'</span><div class="progress"><i style="width:'+(list.done/list.total*100)+'%"></i></div>'+(list.allDone?'<button class="btn quiet" data-checklist-collapse>'+t("dash.action.collapse")+'</button>':'')+'</div>';list.items.forEach(function(item,index){html+=checklistRow(item,index,firstIncomplete);if(state.checklistOpen===item.key){if(item.key==="continuity")html+='<div class="checklist-detail">'+continuityBlock()+'</div>';if(item.key==="checkup")html+='<div id="checkup-slot" class="checklist-detail">'+checkupSlot()+'</div>';}});return html;}
  function continuityBlock(){
    ensureContinuitySince();var c=state.continuity;var examples=[t("dash.continuity.example_commit"),t("dash.continuity.example_branch"),t("dash.continuity.example_test")];
    function statusClass(value,active){return "continuity-step "+(value==="skipped"?"skipped":active?"active":"");}
    function skipped(label){return '<div class="muted">'+label+' <span class="badge status-dead">'+t("dash.common.skipped")+'</span></div>';}
    var html='<section class="card continuity"><div class="continuity-head"><div><h1>'+t("dash.continuity.title")+'</h1><p class="lead">'+t("dash.continuity.lead")+'</p></div><span class="badge">'+t("dash.continuity.duration")+'</span></div>';
    html+='<div class="'+statusClass(c.a,c.a==="ready"||c.a==="waiting")+'"><div class="continuity-number">A</div><div><h2>'+t("dash.continuity.paste_line")+'</h2>';
    if(c.a==="skipped")html+=skipped(t("dash.continuity.save_check"));
    else if(c.a==="done")html+='<p class="detected">'+t(c.factResult==="duplicate"?"dash.continuity.duplicate_connected":"dash.continuity.save_detected")+'</p><div class="fact"><div class="claim">'+esc(c.factClaim)+'</div></div>';
    else{html+='<div class="memory-options">'+examples.map(function(example,index){return '<label><input type="radio" name="continuity-memory" value="'+esc(example)+'" '+(c.choice===example?'checked':'')+'> '+esc(example)+'</label>';}).join("")+'<label><input type="radio" name="continuity-memory" value="custom" '+(c.choice==="custom"?'checked':'')+'> '+t("dash.action.custom_input")+'</label></div><div class="inline-field"><input id="continuity-custom" class="field" maxlength="240" placeholder="'+t("dash.continuity.placeholder")+'" value="'+esc(c.custom)+'"><button class="btn primary" data-continuity-copy '+(!continuityClaim()?'disabled':'')+'>'+t("dash.action.copy")+'</button></div>'+(c.candidate?'<div class="fact"><div class="meta"><span class="badge">'+t("dash.continuity.save_candidate")+'</span></div><div class="claim">'+t("dash.continuity.just_saved",{claim:esc(c.candidate.claim)})+'</div><div class="actions"><button class="btn primary" data-continuity-accept>'+t("dash.action.continue_this")+'</button><button class="btn quiet" data-continuity-reject>'+t("dash.action.not_this")+'</button></div></div>':'')+(c.a==="waiting"?'<div id="continuity-wait" class="hint">'+continuityWaitCopy()+'</div>':'');}
    if(c.a!=="done"&&c.a!=="skipped")html+='<div class="actions"><button class="btn quiet" data-continuity-skip="a">'+t("dash.action.skip")+'</button></div>';html+='</div></div>';
    var bActive=c.a==="done"&&(c.b==="ready"||c.b==="reading");html+='<div class="'+statusClass(c.b,bActive)+'"><div class="continuity-number">B</div><div><h2>'+t("dash.continuity.read_title")+'</h2>';
    if(c.b==="skipped")html+=skipped(t("dash.continuity.read_check"));
    else if(c.b==="done")html+='<div class="fact"><div class="meta"><span class="badge">'+t("dash.continuity.just_read")+'</span></div><div class="claim">'+esc((c.recalled||{}).claim)+'</div></div><p>'+t("dash.continuity.same_everywhere")+'</p>';
    else if(c.a!=="done")html+='<p class="muted">'+t("dash.continuity.after_step_a")+'</p><div class="actions"><button class="btn quiet" data-continuity-skip="b">'+t("dash.action.skip")+'</button></div>';
    else html+='<p class="muted">'+t("dash.continuity.recall_help")+'</p><div class="actions"><button class="btn primary" data-continuity-recall '+(c.b==="reading"?'disabled':'')+'>'+t(c.b==="reading"?"dash.action.reading":"dash.action.read")+'</button><button class="btn quiet" data-continuity-skip="b">'+t("dash.action.skip")+'</button></div>';html+='</div></div>';
    var cursor=state.status.setup.optional.cursor||{};if(cursor.complete&&c.factId){html+='<div class="'+statusClass(c.c,c.c==="ready"||c.c==="waiting")+'"><div class="continuity-number">C</div><div><h2>'+t("dash.continuity.cursor_title")+'</h2>';
      if(c.c==="skipped")html+=skipped(t("dash.continuity.other_session_check"));else if(c.c==="done")html+='<div class="shared-brain">'+t("dash.continuity.shared_brain")+'</div>';else{var question=t("dash.continuity.cursor_question",{claim:c.factClaim});html+='<p class="muted">'+t("dash.continuity.cursor_help")+'</p><div class="actions"><button class="btn" data-continuity-cursor-question="'+esc(question)+'">'+t("dash.action.copy_question")+'</button><button class="btn quiet" data-continuity-skip="c">'+t("dash.action.skip")+'</button></div>'+(c.c==="waiting"?'<p class="hint">'+t("dash.continuity.wait_recall")+'</p>':'');}html+='</div></div>';}
    html+='</section>';return html;
  }
  function aiConnectionStep(mcp,next){var agents=[mcpAgent("claude"),mcpAgent("codex")];var shown=agents.filter(function(agent){return agent.installed;});if(shown.length===0)shown=[agents[0]];var promoted=false;var rows=shown.map(function(agent){var status=t(agent.connected?"dash.connection.connected":agent.installed?"dash.connection.installed":agent.checking?"dash.connection.checking":"dash.connection.missing");var statusClass=agent.connected?"status-connected":agent.installed?"status-installed":"status-dead";var desc=agent.name==="claude"?agent.installed?t("dash.connection.claude_ready"):agent.checking?t("dash.connection.claude_checking"):t("dash.connection.claude_required"):agent.installed?t("dash.connection.codex_ready"):t("dash.connection.codex_missing");var action="";if(!agent.connected&&agent.installed){var primary=next&&!promoted;promoted=promoted||primary;action='<button class="btn '+(primary?'primary':'')+'" data-setup="'+(agent.name==="codex"?'codex':'mcp')+'">'+t("dash.action.auto_register")+'</button>';}var tooltip=agent.name==="codex"?' title="'+t("dash.connection.instructions_tooltip")+'"':'';return '<div class="agent-row"'+tooltip+'><div><div class="agent-row-title"><strong>'+agentLabel(agent.name)+'</strong><span class="badge '+statusClass+'">'+status+'</span></div><p>'+desc+'</p></div><div class="actions">'+action+'</div></div>';}).join("");return '<section class="card step '+(mcp.complete?'done':next?'next':'')+'"><div class="state '+(mcp.complete?'ok':'')+'">'+(mcp.complete?'✓':'○')+'</div><div><h2>'+t("dash.connection.title")+'</h2><p>'+t("dash.connection.lead")+'</p><div class="agent-rows">'+rows+'</div></div><div class="actions"></div></section>';}
  function setupView(){var s=state.status.setup;var r=s.required;var done=[r.store,r.mcp,r.instructions,r.daemon].filter(function(item){return item.complete;}).length;var firstKey=!r.store.complete?"store":!r.mcp.complete?"mcp":!r.instructions.complete?"instructions":!r.daemon.complete?"daemon":null;function main(key,label,attrs){return '<button class="btn '+(firstKey===key?'primary':'')+'" '+attrs+'>'+label+'</button>';}
    var daemonWarn=r.daemon.plist_exists&&(!r.daemon.health.healthy||r.daemon.health.stale);var digestButton='<button class="btn quiet" data-setup="digest" '+(state.digesting?'disabled':'')+'>'+t(state.digesting?"dash.digest.running":"dash.digest.test_now")+'</button>';var html=setupHero();if(s.complete){if(daemonWarn)html+=stepRow({title:t("dash.digest.needs_check"),desc:t("dash.digest.stale_help"),warn:true,actions:digestButton});html+=checklistBlock();app.innerHTML=html;if(state.checklistOpen==="continuity")ensureContinuityPolling();return;}html+='<div class="progress-row"><span class="section-title">'+t("dash.setup.required",{done:done,total:4})+'</span><div class="progress"><i style="width:'+(done*25)+'%"></i></div></div>';var daemonDesc=r.daemon.complete?t("dash.digest.schedule",{last:fmt(r.daemon.health.last_run),next:fmt(nextRunMs(r.daemon))}):daemonWarn?(r.daemon.health.exists?t("dash.digest.stale_help"):t("dash.digest.installed_test")):t("dash.digest.description");
    html+=stepRow({title:t("dash.setup.store_title"),desc:r.store.complete?"":t("dash.setup.store_desc"),complete:r.store.complete,next:firstKey==="store",actions:r.store.complete?"":main("store",t("dash.action.create_store"),'data-setup="init"')});html+=aiConnectionStep(r.mcp,firstKey==="mcp");html+=stepRow({title:t("dash.setup.instructions_title"),desc:r.instructions.complete?"":t("dash.setup.instructions_desc"),complete:r.instructions.complete,next:firstKey==="instructions",actions:r.instructions.complete?'<button class="btn quiet danger" data-setup="instructions-remove">'+t("dash.action.remove")+'</button>':main("instructions",t("dash.action.preview_install"),"data-preview")+'<button class="btn quiet" data-copy-instructions>'+t("dash.action.copy_instructions")+'</button>'});html+=stepRow({title:t("dash.setup.daemon_title"),desc:daemonDesc,complete:r.daemon.complete,next:firstKey==="daemon",warn:daemonWarn,actions:r.daemon.complete?digestButton+'<button class="btn quiet danger" data-setup="daemon-remove">'+t("dash.action.remove")+'</button>':main("daemon",t("dash.action.install_daemon"),"data-daemon-preview")+(daemonWarn?digestButton:'')});app.innerHTML=html;}
  function factHtml(fact,label){if(!fact)return '<div class="fact"><div class="muted">'+t("dash.review.fact_missing",{label:label})+'</div></div>';return '<div class="fact"><div class="meta"><span class="badge">'+t("dash.review.memory_label",{label:label})+'</span><span class="badge">'+esc(scopeLabel(fact.scope))+'</span>'+(fact.subject?'<span>'+esc(fact.subject)+'</span>':'')+'<span>'+esc(fact.t_valid)+'</span></div><div class="claim">'+esc(fact.claim)+'</div></div>';}
  function reviewView(){
    var html='<div class="page-head"><div><h1>'+t("dash.nav.review")+'</h1><p class="lead">'+t("dash.review.lead")+'</p></div></div>';
    if(state.cards.length===0){
      var setup=state.status.setup;
      var connected=setup.required.store.complete&&setup.required.mcp.complete;var health=setup.required.daemon.health;
      if(!connected){app.innerHTML=html+'<div class="card empty">'+t("dash.review.setup_first")+'<div class="actions"><button class="btn primary" data-tab="setup">'+t("dash.action.go_setup")+'</button></div></div>';return;}
      if(health.exists&&!health.healthy){app.innerHTML=html+'<div class="card empty">'+t("dash.review.digest_failed")+'<div class="actions"><button class="btn primary" data-tab="setup">'+t("dash.action.go_setup")+'</button></div>'+digestContext()+'</div>';return;}
      if(!sampleState().complete){app.innerHTML=html+'<div class="card empty">'+t("dash.review.try_sample")+'<div class="actions"><button class="btn primary" data-sample '+(state.digesting?'disabled':'')+'>'+t(state.digesting?"dash.digest.running":"dash.digest.sample")+'</button></div>'+digestContext()+'</div>';return;}
      app.innerHTML=html+'<div class="card empty">'+t("dash.review.empty")+digestContext()+'</div>';return;
    }
    state.cards.forEach(function(card){if(card.type==="capture"){html+='<section class="card review-card"><div class="meta"><span class="badge">'+t("dash.review.from_conversation")+'</span><span class="badge">'+esc(scopeLabel(card.scope))+'</span><span class="badge">'+(card.confidence==null?t("dash.review.confidence_unknown"):t("dash.review.confidence",{percent:Math.round(Number(card.confidence)*100)}))+'</span></div><div class="claim">'+esc(card.claim)+'</div><div class="actions" data-pair="'+encodeURIComponent(card.pair_id)+'"><button class="btn" data-action="remember">'+t("dash.action.remember")+'</button><button class="btn" data-action="dismissed">'+t("dash.action.discard")+'</button><button class="btn" data-action="deferred">'+t("dash.action.later")+'</button></div>'+(state.cards.length===1?digestContext():'')+'</section>';return;}var duplicate=card.verdict==="duplicate";html+='<section class="card review-card"><div class="meta"><span class="badge '+(duplicate?'':'review-warn')+'">'+t(duplicate?"dash.review.duplicate":"dash.review.contradiction")+'</span><span class="badge">'+(card.confidence==null?t("dash.review.confidence_unknown"):t("dash.review.confidence",{percent:Math.round(Number(card.confidence)*100)}))+'</span></div><p>'+t(duplicate?"dash.review.merge_question":"dash.review.conflict_question")+'</p>'+factHtml(card.facts&&card.facts.a,"A")+factHtml(card.facts&&card.facts.b,"B")+'<details><summary>'+t("dash.review.reason")+'</summary><p>'+esc(card.reason||t("dash.review.no_reason"))+'</p></details><div class="actions" data-pair="'+encodeURIComponent(card.pair_id)+'">';
      if(duplicate)html+='<button class="btn" data-action="merge">'+t("dash.action.merge")+'</button><button class="btn danger" data-action="keep_separate">'+t("dash.action.keep_separate")+'</button><button class="btn" data-action="defer">'+t("dash.action.tomorrow")+'</button>';
      else html+='<button class="btn" data-action="newer_wins">'+t("dash.action.new_memory")+'</button><button class="btn danger" data-action="older_wins">'+t("dash.action.old_memory")+'</button><button class="btn" data-action="both_valid">'+t("dash.action.both_valid")+'</button><button class="btn" data-other>'+t("dash.action.other")+'</button>';
      html+='</div><div class="add hidden" data-other-form="'+encodeURIComponent(card.pair_id)+'"><input class="field" aria-label="'+t("dash.review.correction_aria")+'" placeholder="'+t("dash.review.correction_placeholder")+'"><button class="btn primary" data-action="other">'+t("dash.action.save_correction")+'</button></div>'+(state.cards.length===1?digestContext():'')+'</section>';
    });app.innerHTML=html;
  }
  function graphView(){
    if(state.graphCleanup){state.graphCleanup();state.graphCleanup=null;}
    var graph=state.graph||{nodes:[],links:[]};var facts=graph.nodes.filter(function(node){return node.kind==="fact";});
    var head='<div class="page-head"><div><h1>'+t("dash.nav.graph")+'</h1><p class="lead">'+t("dash.graph.lead")+'</p></div><button class="btn" data-refresh-graph>'+t("dash.action.refresh")+'</button></div>';
    if(facts.length===0){app.innerHTML=head+'<div class="card empty">'+t("dash.graph.empty")+'<div class="actions"><button class="btn primary" data-tab="setup">'+t("dash.action.go_setup")+'</button></div></div>';return;}
    var note=graph.truncated?'<div class="graph-note">'+t("dash.graph.truncated")+'</div>':'';
    app.innerHTML=head+'<div class="graph-legend" aria-label="'+t("dash.graph.legend_aria")+'"><span class="legend-item"><i class="legend-dot hub"></i>'+t("dash.graph.legend_hub")+'</span><span class="legend-item"><i class="legend-line"></i>'+t("dash.graph.legend_superseded")+'</span><span class="legend-item"><i class="legend-line contradiction"></i>'+t("dash.graph.legend_contradiction")+'</span><span class="legend-item"><i class="legend-line duplicate"></i>'+t("dash.graph.legend_duplicate")+'</span></div><div class="graph-stage"><canvas class="graph-canvas" aria-label="'+t("dash.graph.canvas_aria")+'"></canvas><div class="graph-tooltip hidden" role="tooltip"></div></div>'+note;
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
  function scopeOptions(){var scopes={person:true,procedure:true};state.memory.forEach(function(f){scopes[f.scope]=true;});return '<option value="">'+t("dash.common.all")+'</option>'+Object.keys(scopes).sort().map(function(scope){return '<option value="'+esc(scope)+'" '+(state.memoryScope===scope?'selected':'')+'>'+esc(scopeLabel(scope))+'</option>';}).join("");}
  function memoryView(){
    var stats=state.status.stats||{total:0,byScope:{},byStatus:{}};var daemon=state.status.setup.required.daemon;
    var active=(stats.byStatus&&stats.byStatus.active)||0;var past=Math.max(0,(stats.total||0)-active);
    var summary=t("dash.memory.summary",{active:esc(active),past:past?t("dash.memory.past_part",{count:esc(past)}):"",scopes:esc(Object.keys(stats.byScope||{}).length),last:fmt(daemon.health.last_run)});
    var html='<div class="page-head"><div><h1>'+t("dash.nav.memory")+'</h1><p class="lead">'+t("dash.memory.lead")+'</p></div></div><div class="summary">'+summary+'</div><form class="toolbar" id="memory-search"><input class="field" name="q" value="'+esc(state.memoryQuery)+'" placeholder="'+t("dash.memory.search_placeholder")+'"><select class="field" name="scope">'+scopeOptions()+'</select><label class="btn"><input type="checkbox" name="includeDead" '+(state.includeDead?'checked':'')+'> '+t("dash.memory.include_past")+'</label></form>';
    if(state.memory.length===0){
      var empty=stats.total===0?t("dash.memory.empty"):t("dash.memory.no_results");
      app.innerHTML=html+'<div class="card empty">'+empty+(stats.total===0?'<div class="actions"><button class="btn" data-tab="setup">'+t("dash.action.view_setup")+'</button></div>':'')+'</div>';return;
    }
    state.memory.forEach(function(f){var dead=f.status!=="active";var supersedes=Array.isArray(f.supersedes)&&f.supersedes.length?f.supersedes.join(", "):t("dash.common.none");html+='<article class="card memory-row '+(dead?'dead':'')+'" data-memory="'+esc(f.id)+'"><div class="meta"><span class="badge">'+esc(scopeLabel(f.scope))+'</span><span class="badge">'+esc(f.t_valid)+'</span>'+(dead?'<span class="badge status-dead"><span class="stamp">🔖</span>'+t("dash.memory.past")+'</span>':'')+'</div><div class="claim">'+esc(f.claim)+'</div><div class="muted hidden" data-detail="'+esc(f.id)+'">id: '+esc(f.id)+' · subject: '+esc(f.subject||t("dash.common.none"))+' · confidence: '+esc(f.confidence)+' · t_valid: '+esc(f.t_valid)+' · status: '+esc(f.status)+' · supersedes: '+esc(supersedes)+' · superseded_by: '+esc(f.superseded_by||t("dash.common.none"))+' · created: '+esc(f.t_created)+'</div></article>';});app.innerHTML=html;
  }
  function loadingView(){var title=t("dash.nav."+state.tab);app.innerHTML='<div class="page-head"><div><h1>'+title+'</h1><p class="lead">'+t("dash.common.loading")+'</p></div></div><div class="card muted">'+t("dash.common.loading_section")+'</div>';}
  async function loadStatus(){state.statusError=null;state.status=await api("/api/status");if(!location.hash){state.tab=state.status.setup.complete?(state.status.pending?"review":"memory"):"setup";}setChrome();render();var mcp=state.status.setup.required.mcp;if(mcp.status==="checking"||(mcp.claude&&mcp.claude.status==="checking")||(mcp.codex&&mcp.codex.status==="checking")){clearTimeout(state.statusTimer);state.statusTimer=setTimeout(function(){loadStatus().catch(function(error){toast(error.message,true);});},500);}}
  function retryActions(attribute){return '<div class="actions"><button class="btn" '+attribute+'>'+t("dash.action.retry")+'</button><button class="btn" data-copy="nautli doctor">'+t("dash.action.copy_doctor")+'</button></div>';}
  async function loadCards(){try{state.cards=(await api("/api/cards")).cards;state.cardsLoaded=true;if(state.tab==="review")reviewView();}catch(error){state.cardsLoaded=false;if(state.tab==="review")app.innerHTML='<div class="page-head"><div><h1>'+t("dash.nav.review")+'</h1></div></div><div class="card warning">'+esc(error.message)+' '+t("dash.error.check_doctor")+retryActions("data-retry-cards")+'</div>';}}
  async function loadGraph(force){if(state.graphLoading)return;state.graphLoading=true;state.graphError=null;if(force){if(state.graphCleanup){state.graphCleanup();state.graphCleanup=null;}state.graphLoaded=false;loadingView();}try{state.graph=await api("/api/graph");state.graphLoaded=true;if(state.tab==="graph")graphView();}catch(error){state.graphError=error.message;state.graphLoaded=false;if(state.tab==="graph")app.innerHTML='<div class="page-head"><div><h1>'+t("dash.nav.graph")+'</h1><p class="lead">'+t("dash.graph.load_failed")+'</p></div></div><div class="card warning">'+esc(error.message)+retryActions("data-refresh-graph")+'</div>';}finally{state.graphLoading=false;}}
  async function loadMemory(){if(state.memoryLoading)return;state.memoryLoading=true;state.memoryError=null;var query=new URLSearchParams({q:state.memoryQuery,scope:state.memoryScope,includeDead:String(state.includeDead)});try{state.memory=(await api("/api/memory?"+query.toString())).facts;state.memoryLoaded=true;if(state.tab==="memory")memoryView();}catch(error){state.memoryError=error.message;state.memoryLoaded=false;if(state.tab==="memory")app.innerHTML='<div class="page-head"><div><h1>'+t("dash.nav.memory")+'</h1><p class="lead">'+t("dash.memory.load_failed")+'</p></div></div><div class="card warning">'+esc(error.message)+retryActions("data-retry-memory")+'</div>';}finally{state.memoryLoading=false;}}
  function render(){setChrome();if(state.tab!=="graph"&&state.graphCleanup){state.graphCleanup();state.graphCleanup=null;}if(state.statusError){app.innerHTML='<div class="page-head"><div><h1>'+t("dash.status.load_failed")+'</h1><p class="lead">'+t("dash.status.doctor_help")+'</p></div></div><div class="card warning">'+esc(state.statusError)+'<div class="actions"><button class="btn primary" data-retry-status>'+t("dash.action.retry")+'</button><button class="btn" data-copy="nautli doctor">'+t("dash.action.copy_doctor")+'</button></div></div>';return;}if(!state.status){loadingView();return;}if(state.tab==="setup"){setupView();if(state.scan===null&&!state.scanLoading)void loadScan();if(state.checkup===null)void loadCheckup();}else if(state.tab==="graph"){if(state.graphError){loadGraph();}else if(state.graphLoaded){if(!app.querySelector(".graph-canvas"))graphView();}else{loadingView();loadGraph();}}else if(state.tab==="review"){if(state.cardsLoaded)reviewView();else loadingView();loadCards();}else{if(state.memoryError){loadMemory();}else if(state.memoryLoaded)memoryView();else loadingView();loadMemory();}}
  async function pollDigest(previous,expectCards){state.digesting=true;render();try{for(var attempt=0;attempt<120;attempt+=1){await new Promise(function(resolve){setTimeout(resolve,1000);});var next=await api("/api/status");state.status=next;setChrome();var health=next.setup.required.daemon.health;var last=health.last_run;if(last&&last!==previous){if(!health.healthy){toast((health.result&&health.result.reason)||health.error||t("dash.digest.failed"),true);return;}if(expectCards){state.cardsLoaded=false;await loadCards();if(state.cards.length===0){toast(t("dash.digest.no_cards"),true);return;}state.tab="review";location.hash="review";toast(t("dash.digest.cards_arrived",{count:state.cards.length}));return;}toast(t("dash.digest.complete"));return;}}toast(t("dash.digest.timeout"),true);}finally{state.digesting=false;render();}}
  function showDigestError(error){if(error&&error.error==="E_CLAUDE_LOGIN"){toast(t("dash.digest.login_expired"),true,'<button class="btn primary" data-copy="claude /login">'+t("dash.action.copy_login")+'</button>');return;}toast(error&&error.message?error.message:t("dash.digest.failed"),true);}
  async function setupAction(name,button){var old=button.textContent;var previous=state.status.setup.required.daemon.health.last_run;button.disabled=true;button.textContent=t(name==="mcp"||name==="codex"?"dash.action.registering":name==="digest"?"dash.digest.running":"dash.action.processing");var doneKey={init:"dash.setup.store_created",mcp:"dash.setup.claude_connected",codex:"dash.setup.codex_connected",instructions:"dash.setup.instructions_installed","instructions-remove":"dash.setup.instructions_removed",daemon:"dash.setup.daemon_installed","daemon-remove":"dash.setup.daemon_removed","sample-remove":"dash.setup.sample_removed"}[name]||"dash.common.done";try{await post("/api/setup/"+name);toast(t(name==="digest"?"dash.digest.started_polling":doneKey));document.getElementById("modal").classList.add("hidden");await loadStatus();if(name==="digest")void pollDigest(previous);}catch(error){if(error.manual_command&&(name==="mcp"||name==="codex"))openModal(t("dash.setup.manual_register",{agent:agentLabel(name==="codex"?"codex":"claude")}),error.message,error.manual_command,'<button class="btn primary" data-copy="'+esc(error.manual_command)+'">'+t("dash.action.copy")+'</button>');if(name==="digest")showDigestError(error);else toast(error.message,true);}finally{if(button.isConnected){button.disabled=false;button.textContent=old;}}}
  document.addEventListener("click",async function(event){
    var themeToggle=event.target.closest("#theme-toggle");if(themeToggle){cycleTheme();return;}
    var languageToggle=event.target.closest("#language-toggle");if(languageToggle){cycleLanguage();return;}
    var tab=event.target.closest("[data-tab]");if(tab){state.tab=tab.dataset.tab;render();if(location.hash!=="#"+state.tab)location.hash=state.tab;return;}
    var scan=event.target.closest("[data-scan-usage]");if(scan){await runUsageScan(scan);return;}
    var checklistExpand=event.target.closest("[data-checklist-expand]");if(checklistExpand){state.checklistExpanded=true;setupView();return;}
    var checklistCollapse=event.target.closest("[data-checklist-collapse]");if(checklistCollapse){state.checklistExpanded=false;state.checklistOpen="";setupView();return;}
    var checklistToggle=event.target.closest("[data-checklist-toggle]");if(checklistToggle){state.checklistOpen=state.checklistOpen===checklistToggle.dataset.checklistToggle?"":checklistToggle.dataset.checklistToggle;setupView();return;}
    var refreshStatus=event.target.closest("[data-refresh-status]");if(refreshStatus){refreshStatus.disabled=true;try{await loadStatus();}catch(error){toast(error.message,true);}finally{if(refreshStatus.isConnected)refreshStatus.disabled=false;}return;}
    var starGithub=event.target.closest("[data-star-github]");if(starGithub){document.getElementById("toast").classList.add("hidden");window.open("https://github.com/Nautli/nautli","_blank","noopener,noreferrer");return;}
    var starLater=event.target.closest("[data-star-later]");if(starLater){document.getElementById("toast").classList.add("hidden");return;}
    var close=event.target.closest("[data-close-modal]");if(close){document.getElementById("modal").classList.add("hidden");return;}
    var continuityCopy=event.target.closest("[data-continuity-copy]");if(continuityCopy){var claim=continuityClaim();if(!claim){toast(t("dash.continuity.enter_habit"),true);return;}ensureContinuitySince();state.continuity.a="waiting";state.continuity.factClaim=claim;saveContinuity();await copyText(t("dash.continuity.remember_prompt",{claim:claim}),t("dash.continuity.prompt_copied"));setupView();ensureContinuityPolling();return;}
    var continuityAccept=event.target.closest("[data-continuity-accept]");if(continuityAccept&&state.continuity.candidate){var accepted=state.continuity.candidate;state.continuity.a="done";state.continuity.b="ready";state.continuity.factId=accepted.fact_id;state.continuity.factClaim=accepted.claim;state.continuity.factResult=accepted.result||"added";state.continuity.candidate=null;state.continuity.ignoredCandidate="";saveContinuity();stopContinuityPolling();setupView();return;}
    var continuityReject=event.target.closest("[data-continuity-reject]");if(continuityReject&&state.continuity.candidate){state.continuity.ignoredCandidate=continuityCandidateKey(state.continuity.candidate);state.continuity.candidate=null;saveContinuity();setupView();ensureContinuityPolling();return;}
    var continuitySkip=event.target.closest("[data-continuity-skip]");if(continuitySkip){var step=continuitySkip.dataset.continuitySkip;state.continuity[step]="skipped";if(step==="a"&&state.continuity.b==="locked")state.continuity.b="ready";stopContinuityPolling();saveContinuity();setupView();return;}
    var continuityRecall=event.target.closest("[data-continuity-recall]");if(continuityRecall){state.continuity.b="reading";saveContinuity();setupView();try{var recalled=await post("/api/continuity/recall",{fact_id:state.continuity.factId});state.continuity.recalled=recalled.fact;state.continuity.b="done";saveContinuity();setupView();}catch(error){state.continuity.b="ready";saveContinuity();setupView();toast(error.message,true);}return;}
    var cursorQuestion=event.target.closest("[data-continuity-cursor-question]");if(cursorQuestion){state.continuity.crossSince=new Date(Date.now()-1000).toISOString();state.continuity.c="waiting";saveContinuity();await copyText(cursorQuestion.dataset.continuityCursorQuestion,t("dash.continuity.question_copied"));setupView();ensureContinuityPolling();return;}
    var share=event.target.closest("[data-share-card]");if(share){share.disabled=true;try{await openShareCard();}catch(error){toast(error.message,true);}finally{if(share.isConnected)share.disabled=false;}return;}
    var shareCopy=event.target.closest("[data-copy-share]");if(shareCopy){var shareText=shareCopy.dataset.copyShare;try{shareText=shareSnippet(await api("/api/checkup/share-card"));}catch(error){}await copyText(shareText,t("dash.share.x_copied"));return;}
    var shareDownload=event.target.closest("[data-share-download]");if(shareDownload){var shareCanvas=document.getElementById("share-canvas");if(!shareCanvas)return;shareDownload.disabled=true;shareCanvas.toBlob(function(blob){if(!blob){toast(t("dash.share.png_failed"),true);shareDownload.disabled=false;return;}var url=URL.createObjectURL(blob);var link=document.createElement("a");link.href=url;link.download="nautli-memory-checkup.png";link.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);shareDownload.disabled=false;toast(t("dash.share.png_saved"));},"image/png");return;}
    var preview=event.target.closest("[data-preview]");if(preview){try{var data=await api("/api/instructions/preview");openModal(t("dash.instructions.preview_title"),t("dash.instructions.preview_lead"),data.preview,'<button class="btn primary" data-setup="instructions">'+t("dash.action.add_instructions")+'</button>');}catch(error){toast(error.message,true);}return;}
    var daemonPreview=event.target.closest("[data-daemon-preview]");if(daemonPreview){var daemonInfo=state.status.setup.required.daemon;openModal(t("dash.daemon.preview_title"),t("dash.daemon.preview_lead"),t("dash.daemon.preview_body",{file:daemonInfo.plist}),'<button class="btn primary" data-setup="daemon">'+t("dash.action.install_daemon")+'</button>');return;}
    var agentPrompt=event.target.closest("[data-copy-agent-prompt]");if(agentPrompt){await copyText(checkupAgentPrompt(),t("dash.checkup.prompt_copied"));state.checkupWatch=Date.now();loadCheckup();return;}
    var copy=event.target.closest("[data-copy]");if(copy){await copyText(copy.dataset.copy,t("dash.copy.command_copied"));return;}
    var copyCursorConfirm=event.target.closest("[data-copy-cursor-confirm]");if(copyCursorConfirm){await copyText(JSON.stringify({mcpServers:{nautli:{command:"nautli",args:["mcp"]}}},null,2),t("dash.cursor.config_copied"));return;}
    var copyCursor=event.target.closest("[data-copy-cursor]");if(copyCursor){openModal(t("dash.cursor.modal_title"),t("dash.cursor.modal_lead"),JSON.stringify({mcpServers:{nautli:{command:"nautli",args:["mcp"]}}},null,2),'<button class="btn primary" data-copy-cursor-confirm>'+t("dash.action.copy")+'</button>');return;}
    var copyInstructions=event.target.closest("[data-copy-instructions]");if(copyInstructions){try{var instruction=await api("/api/instructions/preview");await copyText(instruction.block,t("dash.instructions.copied"));}catch(error){toast(error.message,true);}return;}
    var checkupOpen=event.target.closest("[data-checkup-open]");if(checkupOpen){checkupOpen.disabled=true;try{await openCheckupModal();}catch(error){toast(error.message,true);}finally{checkupOpen.disabled=false;}return;}
    var checkupPreflight=event.target.closest("[data-checkup-preflight]");if(checkupPreflight){var custom=(document.getElementById("checkup-custom")||{}).value||"";if(!custom.trim()){toast(t("dash.checkup.enter_path"),true);return;}document.querySelectorAll('input[name="checkup-path"]').forEach(function(input){input.checked=false;});await loadCheckupPreflight(custom.trim(),[]);return;}
    var checkupStart=event.target.closest("[data-checkup-start]");if(checkupStart){if(!state.checkupPreflight||!state.checkupPreflight.ok)return;var excluded=[].slice.call(document.querySelectorAll("[data-checkup-dir]")).filter(function(input){return !input.checked;}).map(function(input){return input.value;});checkupStart.disabled=true;try{await post("/api/checkup/start",{path:state.checkupPath,excluded_dirs:excluded});document.getElementById("modal").classList.add("hidden");toast(t("dash.checkup.started_findings"));await loadCheckup();}catch(error){toast(error.message,true);checkupStart.disabled=false;}return;}
    var checkupImport=event.target.closest("[data-checkup-import]");if(checkupImport){checkupImport.disabled=true;checkupImport.textContent=t("dash.action.importing");try{var imported=await post("/api/checkup/import");state.memoryLoaded=false;state.cardsLoaded=false;toast(t("dash.checkup.import_toast",{imported:imported.imported,duplicates:imported.duplicates?t("dash.checkup.import_duplicates",{count:imported.duplicates}):"",cards:imported.cards?t("dash.checkup.import_cards",{count:imported.cards}):"",omitted:imported.omitted>0?t("dash.checkup.import_omitted",{count:imported.omitted}):""}));await loadCheckup();await loadStatus();}catch(error){toast(error.message,true);if(checkupImport.isConnected){checkupImport.disabled=false;checkupImport.textContent=t("dash.action.import_memory_continue");}}return;}
    var checkupReport=event.target.closest("[data-checkup-report]");if(checkupReport){try{var reportData=await api("/api/checkup/report");openModal(t("dash.checkup.full_report_title"),t("dash.checkup.local_file"),reportData.report,"");}catch(error){toast(error.message,true);}return;}
    var checkupDismiss=event.target.closest("[data-checkup-dismiss]");if(checkupDismiss){try{await post("/api/checkup/dismiss");await loadCheckup();}catch(error){toast(error.message,true);}return;}
    var setup=event.target.closest("[data-setup]");if(setup){setupAction(setup.dataset.setup,setup);return;}
    var sample=event.target.closest("[data-sample]");if(sample){var sampleOld=sample.textContent;try{var previous=state.status.setup.required.daemon.health.last_run;sample.disabled=true;sample.textContent=t("dash.digest.running");await post("/api/setup/sample");await post("/api/setup/digest");toast(t("dash.digest.sample_started"));await loadStatus();void pollDigest(previous,true);}catch(error){showDigestError(error);}finally{if(sample.isConnected){sample.disabled=false;sample.textContent=sampleOld;}}return;}
    var retryStatus=event.target.closest("[data-retry-status]");if(retryStatus){state.statusError=null;state.status=null;loadingView();loadStatus().catch(function(error){state.statusError=error.message;render();toast(error.message,true);});return;}
    var retryCards=event.target.closest("[data-retry-cards]");if(retryCards){loadingView();loadCards();return;}
    var refreshGraph=event.target.closest("[data-refresh-graph]");if(refreshGraph){loadGraph(true);return;}
    var retryMemory=event.target.closest("[data-retry-memory]");if(retryMemory){state.memoryError=null;state.memoryLoaded=false;loadingView();loadMemory();return;}
    var other=event.target.closest("[data-other]");if(other){var pair=other.parentElement.dataset.pair;document.querySelector('[data-other-form="'+pair+'"]')?.classList.remove("hidden");return;}
    var action=event.target.closest("[data-action]");if(action&&action.closest("[data-pair], [data-other-form]")){var holder=action.closest("[data-pair]")||action.closest("[data-other-form]");var pairId=holder.dataset.pair||holder.dataset.otherForm;var extra=action.dataset.action==="other"?holder.querySelector("input").value:undefined;try{action.disabled=true;action.textContent=t("dash.action.processing");var handled=await post("/api/cards/"+pairId,{action:action.dataset.action,extraText:extra});if(handled.ok!==true)throw new Error(t("dash.review.already_handled"));await loadStatus();state.tab="review";await loadCards();setChrome();if(!await maybeShowStarNag())toast(t("dash.review.handled"));}catch(error){toast(error.message,true);if(action.isConnected)action.disabled=false;}return;}
    var memory=event.target.closest("[data-memory]");if(memory){memory.querySelector("[data-detail]").classList.toggle("hidden");}
  });
  document.addEventListener("keydown",function(event){if(event.key!=="Enter"||event.defaultPrevented||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||state.tab!=="setup")return;var target=event.target;if(target&&target.closest("input,textarea,select,button,a,[contenteditable=true]"))return;var modal=document.getElementById("modal");var scope=modal.classList.contains("hidden")?app:modal;var primary=[].slice.call(scope.querySelectorAll(".btn.primary:not(:disabled)")).find(function(button){return button.offsetParent!==null;});if(!primary)return;event.preventDefault();primary.click();});
  document.addEventListener("change",function(event){var form=event.target.closest("#memory-search");if(form&&(event.target.name==="includeDead"||event.target.name==="scope")){if(form.requestSubmit)form.requestSubmit();else form.dispatchEvent(new Event("submit",{cancelable:true,bubbles:true}));return;}if(event.target.name==="continuity-memory"){state.continuity.choice=event.target.value;saveContinuity();setupView();return;}if(event.target.name==="checkup-path"){var custom=document.getElementById("checkup-custom");if(custom)custom.value="";void loadCheckupPreflight(event.target.value,[]);return;}if(event.target.matches("[data-checkup-dir]")){var excluded=[].slice.call(document.querySelectorAll("[data-checkup-dir]")).filter(function(input){return !input.checked;}).map(function(input){return input.value;});void loadCheckupPreflight(state.checkupPath,excluded);}});
  document.addEventListener("input",function(event){if(event.target.id!=="continuity-custom")return;state.continuity.custom=event.target.value;if(event.target.value.trim())state.continuity.choice="custom";saveContinuity();var button=document.querySelector("[data-continuity-copy]");if(button)button.disabled=!continuityClaim();});
  document.addEventListener("submit",async function(event){
    if(event.target.id==="memory-search"){event.preventDefault();var data=new FormData(event.target);state.memoryQuery=String(data.get("q")||"");state.memoryScope=String(data.get("scope")||"");state.includeDead=data.get("includeDead")!==null;await loadMemory();}
  });
  window.addEventListener("hashchange",function(){var tab=location.hash.slice(1);if(TABS.includes(tab)&&state.tab!==tab){state.tab=tab;render();}});
  localizeChrome();
  void loadScan();
  loadStatus().catch(function(error){state.statusError=error.message;render();toast(error.message,true);});
}());
</script>
</body>
</html>`;
