// Server-rendered HTML. Restrained, text-first. Red = intervention required, amber = unresolved warning; every colour has text.
import { html, raw } from "npm:hono@4.6.14/html";
import type { HtmlEscapedString } from "npm:hono@4.6.14/utils/html";
import type { Row } from "./db.ts";
import { ACTIVITIES, addDays, attention, daysBetween, type Evaluation, handlingOf, isPresales, latest, LOST_REASONS, n, outcomeStatus, outcomeShort, parseJSON, type Related, REVIEW_KINDS, reviewStates, s, SEVERITY_LABEL, type Signal, STAGE_LABEL, STALLED_DAYS, RENEWAL_WINDOW_DAYS, CHECKIN_DAYS, CALIBRATION_MIN_AGREEMENT, CALIBRATION_SOURCE } from "./rules.ts";

export type H = HtmlEscapedString | Promise<HtmlEscapedString>;
export interface Ctx { me: Row | null; users: Row[]; today: string; path: string; msg: { err?: string; saved?: boolean } }
export interface AccEval { a: Row; rel: Related; ev: Evaluation }

export const CSS = `
:root{--ink:#24352f;--muted:#7b847e;--line:#e5e8e1;--green:#245b43;--paper:#f7f8f3;--amber:#a36c29;--red:#b14e43}
*{box-sizing:border-box}body{margin:0;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--paper);color:var(--ink);font-size:13px;line-height:1.5}
button,input,select,textarea{font:inherit}h1,h2,h3,p{margin:0}h1{font-size:28px;line-height:1.25;font-weight:550;letter-spacing:-.8px}h2{font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px}h3{font-size:15px;font-weight:550}
a{color:inherit}.muted{color:var(--muted)}.small{font-size:12px}.nowrap{white-space:nowrap}.sub{font-size:11px;color:var(--muted);margin-top:3px}small.sub{display:block}
.red{color:var(--red)}.amber{color:var(--amber)}.green{color:var(--green)}
input,textarea,select{border:1px solid var(--line);border-radius:7px;background:#fff;padding:8px 11px;color:var(--ink);min-width:0;font-size:12px;max-width:100%}textarea{resize:vertical;min-height:90px;width:100%}input::placeholder,textarea::placeholder{color:#9a9f9a}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #5d9274;outline-offset:2px}
button,a.btn{border:1px solid #dfe5da;background:#fff;color:var(--ink);border-radius:7px;padding:8px 13px;font-size:11px;font-weight:550;display:inline-flex;align-items:center;justify-content:center;gap:7px;white-space:nowrap;cursor:pointer;text-decoration:none;line-height:1.2}
button:hover,a.btn:hover{background:#f2f5ef}button.primary,a.btn.primary{background:var(--green);color:#fff;border-color:var(--green)}button.primary:hover,a.btn.primary:hover{background:#194b35}button[disabled]{opacity:.5;cursor:default}
button.text,a.text{border:0;background:none;padding:0;color:#678452;font-size:11px;font-weight:550}button.text:hover,a.text:hover{text-decoration:underline;background:none}
.shell{display:flex;min-height:100vh}.sidebar{width:215px;position:fixed;inset:0 auto 0 0;background:#f1f3ed;border-right:1px solid #dfe4da;padding:28px 16px 0;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:10px;font-size:15px;letter-spacing:-.3px;font-weight:650;padding:0 10px;margin-bottom:34px;color:var(--ink);text-decoration:none}.brand-mark{display:flex;background:var(--green);color:#fff;width:30px;height:30px;align-items:center;justify-content:center;border-radius:8px;font-size:13px}
.nav{display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:7px;font-size:13px;margin:2px 0;color:#687368;text-decoration:none}.nav.on{color:var(--green);background:#e1e8dc;font-weight:600}.nav:hover{background:#e7ece3}.nav-count{margin-left:auto;font-size:10px;opacity:.7}
.sidebar-bottom{margin-top:auto;border-top:1px solid #dce2d6;padding:18px 4px 22px}.identity{display:flex;align-items:center;gap:9px}.identity small{display:block;font-size:9px;letter-spacing:.8px;color:#909888;text-transform:uppercase}.identity select{padding:0;border:0;background:transparent;font-size:12px;max-width:130px;font-weight:550}
.avatar{display:inline-flex;flex-shrink:0;align-items:center;justify-content:center;background:#e2e7d9;color:#657554;width:30px;height:30px;border-radius:50%;font-size:11px;font-weight:600}.avatar.tiny{width:22px;height:22px;font-size:8px}
.shell main{margin-left:215px;flex:1;min-width:0}.topbar{height:60px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 36px;background:#fafbf7;font-size:12px;color:#8e958b}.topbar b{color:var(--ink);font-weight:550}
.content{max-width:1300px;margin:auto;padding:34px 36px 40px}.page-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px;flex-wrap:wrap}.page-heading .tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.segmented{display:flex;background:#e9ede3;padding:3px;border-radius:7px;gap:2px}.segmented a{padding:6px 12px;font-size:11px;border-radius:5px;color:#7b8774;text-decoration:none}.segmented a.on{background:#fff;box-shadow:0 1px 3px #263d1a0b;color:#344c34;font-weight:550}
.summary-strip{display:grid;grid-template-columns:1fr 1fr 1.2fr;padding:22px 0 26px;border-top:1px solid var(--line);margin-bottom:4px}.summary-strip>div{display:flex;align-items:center;gap:16px;padding:0 22px;border-right:1px solid var(--line)}.summary-strip>div:first-child{padding-left:0}.summary-strip>div:last-child{border-right:0}
.summary-num{font-size:34px;font-weight:450;letter-spacing:-1.5px;line-height:1}.summary-num.warm{color:#a68048}.summary-num.hot{color:var(--red)}.denominator{font-size:18px;color:#a3ad9e}.summary-strip span.lbl{font-size:11px}.summary-strip small{display:block;font-size:10px;color:#92998d;margin-top:4px}
.grid2{display:grid;grid-template-columns:1.25fr 1fr;gap:20px;margin-bottom:24px;align-items:start}.stack{display:grid;gap:20px}
.panel{background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:20px}.section-header{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:56px;padding:15px 20px;border-bottom:1px solid #edf0e9}.section-header .acts{display:flex;gap:8px;align-items:center}
.count{font-size:10px;line-height:19px;min-width:20px;text-align:center;border-radius:5px;background:#f0f3eb;color:#8a9680;font-weight:450;padding:0 5px}.card-body{padding:20px;font-size:12px}.card-body>p{line-height:1.7}
.attention-row{display:flex;gap:13px;padding:18px 20px;border-bottom:1px solid #f0f2ec;align-items:flex-start}.attention-row:last-child{border-bottom:0}.signal-icon{width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:8px;flex-shrink:0;font-weight:700;font-size:14px}
.signal-icon.amber{color:#a17b38;background:#fbf5e7}.signal-icon.red{color:#b16053;background:#fcf0ec}.signal-icon.green{color:#4c7953;background:#eef5e9}.signal-icon.neutral{color:#77856f;background:#f0f3eb}
.attention-body{flex:1;min-width:0}.attention-title{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.attention-title a{font-size:12px;font-weight:600;text-decoration:none}.attention-title a:hover{text-decoration:underline}.attention-body p{font-size:12px;color:#5f6b5c;line-height:1.6;margin:5px 0}.attention-meta{display:flex;gap:12px;font-size:10px;color:#a1aa99}
.task-row{display:flex;align-items:flex-start;gap:12px;padding:15px 20px;border-bottom:1px solid #eff1eb}.task-row:last-child{border-bottom:0}.task-row>div{flex:1;min-width:0}.task-title{font-size:12px;font-weight:500;line-height:1.5}.task-row small{display:block;font-size:10px;color:#9aa38f;margin-top:4px}.task-date{font-size:10px;white-space:nowrap;margin-top:3px;color:#8d9882;min-width:84px}.late{color:#b16d4b!important}
.task-check{border:1px solid #dce3d5;border-radius:5px;width:17px;height:17px;padding:0;flex-shrink:0;color:transparent;margin-top:2px;background:#fff;font-size:11px;line-height:1}.task-check:hover{color:#49734b;background:#eff5e8}
.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;text-align:left}th{font-size:10px;color:#98a18f;font-weight:500;padding:11px 20px;background:#fcfdf9;border-bottom:1px solid #edf0e8;white-space:nowrap}td{padding:15px 20px;border-bottom:1px solid #edf0e8;font-size:12px;vertical-align:top}tr:last-child td{border-bottom:0}tbody tr.row-link:hover{background:#fafcf6}
.account-cell{display:flex;align-items:center;gap:10px}.account-cell a{font-weight:550;font-size:12px;text-decoration:none;white-space:nowrap}.account-cell a:hover{text-decoration:underline}.account-cell small{display:block;color:#9aa38f;font-size:10px;margin-top:2px}
.company-icon{width:32px;height:32px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;border:1px solid #dde5d3;background:#edf1e5;color:#829269;flex-shrink:0}.company-icon.c1{background:#f4eee3;border-color:#ece2d2;color:#ab9368}.company-icon.c2{background:#edf0f5;border-color:#dee4ed;color:#8091ab}.company-icon.c3{background:#f2edf3;border-color:#e8dfe8;color:#9d82a0}.company-icon.large{width:52px;height:52px;font-size:17px;border-radius:11px}
.owner-cell{display:inline-flex;gap:7px;align-items:center;color:#7a876f}
.badge{display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:5px;font-size:10px;white-space:nowrap;font-weight:500}.badge .dot{width:4px;height:4px;background:currentColor;border-radius:50%}.badge.amber{color:#a17b38;background:#fbf5e7}.badge.red{color:#b16053;background:#fcf0ec}.badge.green{color:#4c7953;background:#eef5e9}.badge.neutral{color:#77856f;background:#f0f3eb}
.empty{padding:30px 20px;text-align:center;color:#a0ac96;font-size:12px}
.back{display:inline-flex;align-items:center;gap:7px;color:#8a977e;font-size:11px;margin-bottom:20px;text-decoration:none}.account-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:22px;flex-wrap:wrap}.account-heading-title{display:flex;align-items:center;gap:16px}.account-heading .sub{font-size:12px}.button-group{display:flex;gap:8px;flex-wrap:wrap}
.stage-track{display:flex;margin-bottom:18px;border:1px solid var(--line);border-radius:8px;background:#fff;overflow:auto}.stage-step{display:flex;align-items:center;gap:9px;flex:1;white-space:nowrap;font-size:11px;padding:12px 15px;color:#a0a995}.stage-step>span{display:inline-flex;align-items:center;justify-content:center;border:1px solid #e2e7db;width:19px;height:19px;border-radius:50%;font-size:9px}.stage-step.current{background:#e9efdf;color:#567442;font-weight:550}.stage-step.current>span{background:#69864e;color:#fff;border-color:#69864e}.stage-step.past{color:#7e926e}.stage-step.past>span{color:#69864e;border-color:#b9c9ad}
.account-banner{display:flex;align-items:center;justify-content:space-between;gap:15px;border:1px solid #e4e8dc;background:#f0f3e8;padding:13px 17px;border-radius:8px;font-size:12px;color:#5a665a;margin-bottom:22px}.account-banner.red{background:#fcf0ec;border-color:#f1d6cd;color:#8f4a3f}.account-banner.amber{background:#fbf5e7;border-color:#eadfc5;color:#7d5e2a}.account-banner>div{display:flex;gap:10px;align-items:center;min-width:0}
.tabs{display:flex;gap:26px;border-bottom:1px solid var(--line);margin-bottom:22px}.tabs a{padding:0 0 12px;font-size:12px;color:#8c9881;text-decoration:none;border-bottom:2px solid transparent;margin-bottom:-1px}.tabs a.on{color:#3f6542;border-color:#52754b;font-weight:550}
.facts{display:grid;grid-template-columns:1fr 1fr;gap:16px 20px;margin:0}.facts.single{grid-template-columns:1fr}.facts dt{font-size:10px;color:#97a08d;margin-bottom:3px}.facts dd{margin:0;font-size:12px;overflow-wrap:anywhere}.kv{display:grid;grid-template-columns:1fr 1fr;gap:16px 20px;margin:0}.kv dt{font-size:10px;color:#97a08d;margin-bottom:3px}.kv dd{margin:0;font-size:12px}
.context-problem{font-size:14px;line-height:1.7;margin-bottom:18px}.risk-item{padding:15px 20px;border-bottom:1px solid #edf0e8;display:flex;flex-direction:column;gap:10px;align-items:flex-start}.risk-item:last-child{border-bottom:0}.risk-item>div{width:100%}.risk-item p{font-size:12px;color:#4f5b4c}.risk-item small{font-size:10px;color:#9eaa91}
.timeline{padding:6px 20px}.timeline-item{display:flex;gap:12px;padding:14px 0;border-bottom:1px solid #f0f2ec}.timeline-item:last-child{border-bottom:0}.timeline-dot{width:24px;height:24px;flex-shrink:0;border-radius:50%;background:#f0f4e9;color:#97a38a;display:flex;align-items:center;justify-content:center;font-size:10px}.timeline-item small{font-size:10px;color:#a1ab95}.timeline-item p{font-size:12px;line-height:1.65;margin-top:3px;color:#4f5b4c;white-space:pre-wrap}
ul.check{list-style:none;padding:0;margin:0}ul.check li{display:flex;gap:9px;padding:6px 0;font-size:12px;align-items:flex-start}ul.check li::before{content:"";width:15px;height:15px;border:1px solid #cfd7c8;border-radius:4px;flex-shrink:0;margin-top:2px;background:#fff}ul.check li.ok{color:#8a9680}ul.check li.ok::before{background:#e3eddb;border-color:#b9c9ad}ul.check li .sub{display:block}
.error{padding:12px 15px;background:#fff0eb;border:1px solid #f1d6cd;border-radius:7px;color:#a25746;font-size:12px;margin-bottom:18px;line-height:1.6}.ferr{color:var(--red);font-size:11px;margin-top:4px}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:12px 20px;color:#fff;background:#31533c;box-shadow:0 8px 30px #163d2322;border-radius:9px;font-size:12px;z-index:70;animation:fade 4s forwards}@keyframes fade{0%,70%{opacity:1}100%{opacity:0;visibility:hidden}}
dialog.modal{border:1px solid #e4e9dc;border-radius:13px;box-shadow:0 20px 80px #12281733;padding:0;width:560px;max-width:calc(100vw - 40px);color:var(--ink)}dialog.modal::backdrop{background:#1f302744;backdrop-filter:blur(3px)}
.modal-header{padding:20px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line)}.modal-header h2{font-size:18px;letter-spacing:-.4px;font-weight:550}.modal-body{padding:22px 24px;max-height:70vh;overflow:auto}.modal-footer{padding:15px 24px;display:flex;justify-content:flex-end;gap:9px;border-top:1px solid var(--line);background:#fbfcf8}
.field{display:flex;flex-direction:column;gap:6px;margin-bottom:15px}.field>span{font-size:11px;font-weight:500;color:#6b7e5d}.field input,.field select,.field textarea{width:100%}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.form-grid.three{grid-template-columns:1fr 1fr 1fr}.checkbox-label{display:flex;gap:9px;align-items:center;font-size:12px;color:#5b6b4f;margin-bottom:15px}.checkbox-label input{width:auto;accent-color:var(--green)}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}.row .field{flex:1;min-width:140px;margin-bottom:0}
details.drawer{margin:10px 0}details.drawer>summary{list-style:none;cursor:pointer;color:#678452;font-size:11px;font-weight:550}details.drawer>summary::-webkit-details-marker{display:none}details.drawer[open]>:not(summary){margin-top:10px}
details summary{cursor:pointer;color:#678452;font-size:11px;font-weight:550}
.readiness{background:#f7f8f2;border:1px solid #e6ebdf;border-radius:7px;padding:14px;margin-bottom:16px}.readiness h3{font-size:12px;margin-bottom:8px}
blockquote{margin:0 0 12px;padding-left:12px;border-left:2px solid #cfd7c8;color:#4f5b4c;font-size:12px;line-height:1.65}pre.wrap{white-space:pre-wrap;font:inherit;margin:0}
.pub{max-width:780px;margin:0 auto;padding:40px 24px 80px}.pub h1{margin-bottom:12px}.pub h2{margin:28px 0 10px}.pub p{margin-bottom:10px}.pub table{background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.login{max-width:380px;margin:120px auto;background:#fff;border:1px solid var(--line);border-radius:13px;padding:32px}
@media(max-width:1000px){.grid2{grid-template-columns:1fr}}@media(max-width:850px){.sidebar{width:64px;padding:20px 8px}.brand span.t,.nav span.t,.sidebar-bottom label,.nav-count{display:none}.nav{justify-content:center}.shell main{margin-left:64px}.content{padding:22px 16px}.topbar{padding:0 16px}.summary-strip{grid-template-columns:1fr}.summary-strip>div{border-right:0;padding:8px 0}}
`;
export const sev = (x: Signal["severity"]) => x === "warning" ? "amber" : "red";
export const sevWord = (x: Signal["severity"]) => html`<span class="${sev(x)}">${SEVERITY_LABEL[x]}</span>`;
export const sevLabel = (x: Signal["severity"]) => html`<span class="lbl ${sev(x)}">${SEVERITY_LABEL[x]}</span>`;
// timestamps render as Pacific dates; date-only strings pass through
export const fmt = (d: unknown) => { const v = s(d); if (!v) return "—"; return v.length > 10 && v.includes("T") ? new Date(v).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }) : v.slice(0, 10); };
export const dueWord = (due: string, today: string) => { const k = daysBetween(today, due); return k < 0 ? html`<span class="red">${-k}d overdue</span>` : k === 0 ? html`<b>today</b>` : html`in ${k}d`; };
export const opt = (vals: readonly string[], sel?: string, label?: Record<string, string>) => vals.map((v) => html`<option value="${v}" ${v === sel ? "selected" : ""}>${label?.[v] ?? v}</option>`);
export const userOpt = (users: Row[], sel?: unknown, blank = "—") => html`<option value="">${blank}</option>${users.map((u) => html`<option value="${u.id}" ${s(u.id) === s(sel) ? "selected" : ""}>${u.name}</option>`)}`;
export const stageOf = (a: Row) => STAGE_LABEL[s(a.delivery_status || a.sales_stage)];
export const link = (a: Row, tab?: string) => html`<a href="/accounts/${a.id}${tab ? "?tab=" + tab : ""}">${a.name}</a>`;
export const nextDated = (rel: Related) => rel.tasks.filter((t) => t.status === "open" && t.due_date).sort((p, q) => s(p.due_date).localeCompare(s(q.due_date)))[0] ?? null;

// Server-side rejections redirect with ?err=; this restores what was typed into the same form (fresh hidden version from the server), so a failed save is recoverable.
export const KEEP_INPUT_JS = `(function(){var K='ccc2form';document.addEventListener('submit',function(e){var f=e.target;if(!f||f.method.toLowerCase()!=='post')return;var o={};new FormData(f).forEach(function(v,k){if(typeof v!=='string'||k==='version'||k==='passcode')return;o[k]=(o[k]!==undefined?o[k]+'\\u0000':'')+v});try{sessionStorage.setItem(K,JSON.stringify({a:f.getAttribute('action'),o:o}))}catch(_){}});
var q=new URLSearchParams(location.search);if(!q.get('err')){try{sessionStorage.removeItem(K)}catch(_){}return}var st=null;try{st=JSON.parse(sessionStorage.getItem(K)||'null')}catch(_){}if(!st)return;
document.querySelectorAll('form').forEach(function(f){if(f.getAttribute('action')!==st.a)return;Object.keys(st.o).forEach(function(k){var vals=st.o[k].split('\\u0000');f.querySelectorAll('[name="'+k+'"]').forEach(function(el){if(el.type==='hidden')return;if(el.type==='checkbox'||el.type==='radio'){el.checked=vals.indexOf(el.value)>=0}else{el.value=vals[0]}})});var d=f.closest('details');while(d){d.open=true;d=d.parentElement?d.parentElement.closest('details'):null}f.scrollIntoView({block:'center'})});try{sessionStorage.removeItem(K)}catch(_){}})();`;
export function layout(title: string, body: H, x: Ctx, opts: { counts?: { attention?: number } } = {}): H {
  const nav = (href: string, label: string, count?: number) => html`<a href="${href}" class="nav ${x.path === href || (href !== "/" && x.path.startsWith(href) && !(href === "/accounts" && x.path === "/accounts/new")) ? "on" : ""}"><span class="t">${label}</span>${count ? html`<span class="nav-count">${count}</span>` : ""}</a>`;
  const me = x.me;
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} · Command Center</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${raw(CSS)}</style></head><body><div class="shell">
<aside class="sidebar"><a href="/" class="brand"><span class="brand-mark">C</span><span class="t">Command Center</span></a>
${nav("/", "My work", opts.counts?.attention)}${nav("/accounts", "Accounts")}${nav("/accounts/new", "Add account")}
<div class="sidebar-bottom"><form method="post" action="/me" class="identity"><input type="hidden" name="next" value="${x.path}"><span class="avatar">${me ? initials(s(me.name)) : "?"}</span><label><small>Acting as</small><select name="me" onchange="this.form.submit()"><option value="">Pick a role</option>${x.users.map((u) => html`<option value="${u.id}" ${me && me.id === u.id ? "selected" : ""}>${u.name}</option>`)}</select></label></form></div></aside>
<main><div class="topbar"><span><b>${title}</b></span><span>Today ${fmtLong(x.today)}</span></div><div class="content">
${x.msg.err ? html`<div class="error">${x.msg.err}</div>` : ""}
${body}
</div></main></div>${x.msg.saved ? html`<div class="toast">Changes saved</div>` : ""}
<script>${raw(KEEP_INPUT_JS)}
(function(){var q=new URLSearchParams(location.search);var m=q.get('open')||(q.get('err')&&sessionStorage.getItem('ccc2_modal'));if(m){var d=document.getElementById(m);if(d&&d.showModal){d.showModal()}}document.querySelectorAll('dialog.modal form').forEach(function(f){f.addEventListener('submit',function(){try{sessionStorage.setItem('ccc2_modal',f.closest('dialog').id)}catch(_){}})});if(!q.get('err')){try{sessionStorage.removeItem('ccc2_modal')}catch(_){}}})();
</script></body></html>`;
}
export const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
export const fmtLong = (d: string | null | undefined) => { if (!d) return "—"; const [y, m, dd] = String(d).slice(0, 10).split("-").map(Number); if (!y || !m || !dd) return String(d); return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); };
export const iconClass = (name: string) => "company-icon c" + (name.length % 4);
export function modal(id: string, title: string, body: H, footer: H): H {
  return html`<dialog class="modal" id="${id}"><div class="modal-header"><h2>${title}</h2><button type="button" class="text" onclick="this.closest('dialog').close()">Close</button></div><div class="modal-body">${body}</div><div class="modal-footer"><button type="button" onclick="this.closest('dialog').close()">Cancel</button>${footer}</div></dialog>`;
}
export const openBtn = (id: string, label: string, primary = false) => html`<button type="button" class="${primary ? "primary" : ""}" onclick="document.getElementById('${id}').showModal()">${label}</button>`;

export const notFound = (): H => html`<h1>Not found</h1><p><a href="/">Back to My work</a></p>`;
export function loginPage(err?: string, next = "/"): H {
  return html`<!doctype html><html><head><meta charset="utf-8"><title>Command Center</title><style>${raw(CSS)}</style></head><body><div class="login"><div class="brand" style="margin-bottom:22px;padding:0"><span class="brand-mark">C</span><span>Command Center</span></div>
  <form method="post" action="/login"><input type="hidden" name="next" value="${next}"><label class="field"><span>Team passcode</span><input name="passcode" type="password" autofocus></label>${err ? html`<p class="ferr">${err}</p>` : ""}<button class="primary" style="width:100%">Enter</button></form></div></body></html>`;
}

// Action button for a signal: one specific next step.

export function actionHref(sg: Signal, a: Row): string {
  const id = s(a.id);
  switch (sg.actionType) {
    case "decide_review": return `/reviews/${sg.subjectId}`;
    case "assign_reviewer": case "assign_technical_owner": return `/accounts/${id}?tab=overview#owners`;
    case "request_review": case "request_delivery_review": case "request_success_review": return `/accounts/${id}?tab=scope#reviews`;
    case "complete_task": return `/accounts/${id}?tab=${sg.reason.includes("milestone") ? "delivery" : "overview"}#add-action`;
    case "accept_handoff": return `/accounts/${id}/handoff`;
    case "log_meeting": return `/accounts/${id}?tab=overview#log`;
    case "add_action": return `/accounts/${id}?tab=overview#add-action`;
    case "record_requirements": return `/accounts/${id}?tab=scope#requirements`;
    case "declare_handling": case "revise_proposal": return `/accounts/${id}?tab=scope#proposal`;
    case "resolve_blocker": return `/accounts/${id}?tab=delivery#blockers`;
    case "record_outcome": return `/accounts/${id}?tab=delivery#outcome`;
    case "record_calibration": return `/accounts/${id}?tab=scope#calibration`;
    default: return `/accounts/${id}`;
  }
}
export function actionFor(sg: Signal, a: Row): H {
  const id = s(a.id);
  switch (sg.actionType) {
    case "decide_review": return html`<a class="btn" href="/reviews/${sg.subjectId}">Review</a>`;
    case "assign_reviewer": case "assign_technical_owner": return html`<a class="btn" href="/accounts/${id}?tab=overview#owners">Assign technical owner</a>`;
    case "request_review": return html`<a class="btn" href="/accounts/${id}?tab=scope#reviews">Request review</a>`;
    case "complete_task": return html`<a class="btn" href="/accounts/${id}?tab=${sg.reason.includes("milestone") ? "delivery" : "overview"}#actions">Open commitment</a>`;
    case "open_account": return html`<a class="btn" href="/accounts/${id}">Open account</a>`;
    case "record_calibration": return html`<a class="btn" href="/accounts/${id}?tab=scope#calibration">Review calibration</a>`;
    case "accept_handoff": return html`<a class="btn" href="/accounts/${id}/handoff">Accept handoff</a>`;
    case "log_meeting": return html`<a class="btn" href="/accounts/${id}?tab=overview#log">Log meeting</a>`;
    case "add_action": return html`<a class="btn" href="/accounts/${id}?tab=overview#add-action">Add action</a>`;
    case "request_delivery_review": return html`<a class="btn" href="/accounts/${id}?tab=scope#reviews">Request delivery-plan review</a>`;
    case "request_success_review": return html`<a class="btn" href="/accounts/${id}?tab=scope#reviews">Request success review</a>`;
    case "record_requirements": return html`<a class="btn" href="/accounts/${id}?tab=scope#requirements">Record data restrictions</a>`;
    case "declare_handling": return html`<a class="btn" href="/accounts/${id}?tab=scope#proposal">Declare handling</a>`;
    case "resolve_blocker": return html`<a class="btn" href="/accounts/${id}?tab=delivery#blockers">Resolve blocker</a>`;
    case "record_outcome": return html`<a class="btn" href="/accounts/${id}?tab=delivery#outcome">Record outcome</a>`;
    case "revise_proposal": return html`<a class="btn" href="/accounts/${id}?tab=scope#proposal">Revise proposal</a>`;
    case "edit_account": return html`<a class="btn" href="/accounts/${id}?tab=overview#edit">Edit account</a>`;
    default: return html`<a class="btn" href="/accounts/${id}">Open</a>`;
  }
}
export const nameOf = (x: Ctx, id: unknown) => x.users.find((u) => s(u.id) === s(id))?.name ?? "—";

// ---------------------------------------------------------------- My work
export const TODO: Record<string, string> = { decide_review: "Decide", assign_reviewer: "Assign", assign_technical_owner: "Assign owner", request_review: "Request review", complete_task: "Open", accept_handoff: "Accept handoff", log_meeting: "Log meeting", add_action: "Add action", request_delivery_review: "Review plan", request_success_review: "Review success", record_requirements: "Record restrictions", declare_handling: "Declare handling", revise_proposal: "Revise proposal", edit_account: "Edit", resolve_blocker: "Resolve", record_outcome: "Record result", open_account: "Open", record_calibration: "Open" };
export function myWork(evals: AccEval[], x: Ctx, owner: string, view: string, query: string): H {
  const mine = (e: AccEval) => owner === "all" || s(e.a.owner_id) === owner || s(e.a.technical_owner_id) === owner;
  const qmatch = (e: AccEval) => !query || s(e.a.name).toLowerCase().includes(query.toLowerCase());
  const visible = evals.filter(mine).filter(qmatch);
  const committed = visible.flatMap((e) => e.rel.tasks.filter((t) => t.status === "open" && t.committed && !t.customer_side && (owner === "all" || s(t.owner_id) === owner || s(e.a.owner_id) === owner)));
  const overdueN = committed.filter((t) => t.due_date && s(t.due_date) < x.today).length;
  const order = { critical: 0, high: 1, warning: 2 };
  const attentionRows = visible.filter((e) => e.ev.signals.length).sort((p, q) => order[p.ev.signals[0].severity] - order[q.ev.signals[0].severity] || s(p.a.created_at).localeCompare(s(q.a.created_at)));
  const myTasks = evals.flatMap((e) => e.rel.tasks.filter((t) => t.status === "open" && (owner === "all" || s(t.owner_id) === owner)).map((t) => ({ e, t }))).sort((p, q) => (s(p.t.due_date) || "9999").localeCompare(s(q.t.due_date) || "9999"));
  const pipeline = visible.filter((e) => isPresales(e.a)), customers = visible.filter((e) => e.a.sales_stage === "won");
  const inMotion = visible.filter((e) => e.a.sales_stage !== "lost" && e.a.delivery_status !== "ended").length;
  const taskBtn = (e: AccEval, t: Row) => t.type === "review" ? html`<a class="btn" href="/reviews/${t.subject_id}">Decide</a>` : t.type === "handoff" ? html`<a class="btn" href="/accounts/${e.a.id}/handoff">Accept</a>` : html`<form method="post" action="/tasks/${t.id}/done"><input type="hidden" name="version" value="${t.version}"><input type="hidden" name="return" value="${x.path}"><button class="task-check" title="Mark done">✓</button></form>`;
  const listPanel = (title: string, rows: AccEval[], empty: string) => html`<section class="panel"><div class="section-header"><h2>${title} <span class="count">${rows.length}</span></h2></div>
    ${rows.length ? html`<div class="table-wrap"><table><thead><tr><th>Account</th><th>Stage</th><th>Owner</th><th>Next step</th><th>Attention</th></tr></thead><tbody>
    ${rows.map((e) => { const nd = nextDated(e.rel), n = e.ev.signals.length, top = e.ev.signals[0]; return html`<tr class="row-link"><td>${accountCell(e.a)}</td><td>${stageBadge(e.a)}</td><td><span class="owner-cell"><span class="avatar tiny">${initials(s(e.a.owner_name))}</span>${e.a.owner_name}</span></td><td>${nd ? html`${nd.title}<small class="sub ${s(nd.due_date) < x.today ? "late" : ""}">${fmtLong(s(nd.due_date))}</small>` : html`<span class="muted">No next step</span>`}</td><td>${n ? html`<span class="badge ${top.severity === "warning" ? "amber" : "red"}"><span class="dot"></span>${n} ${n === 1 ? "signal" : "signals"}</span>` : html`<span class="badge green"><span class="dot"></span>On track</span>`}</td></tr>`; })}</tbody></table></div>` : html`<div class="empty">${empty}</div>`}</section>`;
  return html`<div class="page-heading"><h1>My work</h1>
    <form method="get" class="tools"><select name="owner" onchange="this.form.submit()"><option value="all" ${owner === "all" ? "selected" : ""}>All team</option>${x.users.map((u) => html`<option value="${u.id}" ${owner === s(u.id) ? "selected" : ""}>${u.name}</option>`)}</select><input name="q" value="${query}" placeholder="Search accounts" size="20"><button>Search</button></form></div>
  <div class="summary-strip">
    <div><span class="summary-num">${String(inMotion).padStart(2, "0")}</span><span class="lbl">Accounts in motion<small>${pipeline.length} in presales · ${customers.length} customers</small></span></div>
    <div><span class="summary-num ${attentionRows.length ? "warm" : ""}">${String(attentionRows.length).padStart(2, "0")}</span><span class="lbl">Need attention<small>Accounts with an open signal</small></span></div>
    <div><span class="summary-num ${overdueN ? "hot" : ""}">${overdueN}<span class="denominator"> / ${committed.length}</span></span><span class="lbl">Commitments overdue<small>Promises to customers past their date</small></span></div>
  </div>
  <div class="grid2">
    <section class="panel"><div class="section-header"><h2>Needs attention <span class="count">${attentionRows.length}</span></h2></div>
      ${attentionRows.length ? attentionRows.map((e) => { const at = attention(e.ev)!, sv = at.top.severity; return html`<div class="attention-row"><span class="signal-icon ${sv === "warning" ? "amber" : "red"}">!</span><div class="attention-body"><div class="attention-title"><a href="/accounts/${e.a.id}">${e.a.name}</a>${stageBadge(e.a)}</div><p>${at.top.reason}</p><div class="attention-meta"><span>${nameOf(x, at.top.ownerId)}</span>${at.others ? html`<span>+${at.others} more</span>` : ""}</div></div><a class="btn" href="${actionHref(at.top, e.a)}">${TODO[at.top.actionType] ?? "Open"}</a></div>`; }) : html`<div class="empty">Nothing needs attention.</div>`}
    </section>
    <section class="panel"><div class="section-header"><h2>${owner === "all" ? "Open actions" : "My actions"} <span class="count">${myTasks.length}</span></h2></div>
      ${myTasks.length ? myTasks.map(({ e, t }) => html`<div class="task-row">${taskBtn(e, t)}<div><div class="task-title">${t.title}${t.committed ? html` <span class="muted">· promised</span>` : ""}</div><small><a href="/accounts/${e.a.id}">${e.a.name}</a>${owner === "all" ? html` · ${t.owner_name ?? "unowned"}` : ""}</small></div><span class="task-date ${t.due_date && s(t.due_date) < x.today ? "late" : ""}">${t.due_date ? html`${fmtLong(s(t.due_date))} · ${dueWord(s(t.due_date), x.today)}` : "no date"}</span></div>`) : html`<div class="empty">Nothing assigned.</div>`}
    </section>
  </div>
  ${listPanel("Pipeline", pipeline, "No deals in progress.")}
  ${listPanel("Customers", customers, "No signed customers.")}`;
}
export const accountCell = (a: Row) => html`<div class="account-cell"><span class="${iconClass(s(a.name))}">${initials(s(a.name))}</span><div><a href="/accounts/${a.id}">${a.name}</a>${a.contact ? html`<small>${a.contact}</small>` : ""}</div></div>`;
export const stageBadge = (a: Row) => html`<span class="badge ${a.sales_stage === "won" && ["delivery", "active"].includes(s(a.delivery_status)) ? "green" : a.sales_stage === "lost" || a.delivery_status === "ended" ? "neutral" : "neutral"}"><span class="dot"></span>${stageOf(a)}</span>`;

// ---------------------------------------------------------------- Accounts
export function accountsPage(evals: AccEval[], x: Ctx, f: { owner: string; phase: string; stage: string; attention: string; q: string }): H {
  let rows = evals;
  if (f.owner && f.owner !== "all") rows = rows.filter((e) => s(e.a.owner_id) === f.owner || s(e.a.technical_owner_id) === f.owner);
  if (f.phase === "presales") rows = rows.filter((e) => isPresales(e.a)); if (f.phase === "post") rows = rows.filter((e) => e.a.sales_stage === "won"); if (f.phase === "closed") rows = rows.filter((e) => e.a.sales_stage === "lost" || e.a.delivery_status === "ended");
  if (f.stage) rows = rows.filter((e) => s(e.a.delivery_status || e.a.sales_stage) === f.stage);
  if (f.attention) rows = rows.filter((e) => e.ev.signals.length > 0);
  if (f.q) rows = rows.filter((e) => s(e.a.name).toLowerCase().includes(f.q.toLowerCase()));
  const any = Object.values(f).some((val) => val && val !== "all");
  return html`<div class="page-heading"><h1>Accounts</h1><a href="/accounts/new" class="btn primary">Add account</a></div>
  <section class="panel"><div class="section-header"><h2>All accounts <span class="count">${rows.length}</span></h2>
    <form method="get" class="tools"><input name="q" value="${f.q}" placeholder="Search accounts" size="18"><select name="owner" onchange="this.form.submit()"><option value="all" ${f.owner === "all" ? "selected" : ""}>Any owner</option>${userOpt(x.users, f.owner, "Any owner")}</select><select name="phase" onchange="this.form.submit()">${opt(["", "presales", "post", "closed"], f.phase, { "": "All phases", presales: "Presales", post: "Post-sales", closed: "Lost / ended" })}</select><select name="stage" onchange="this.form.submit()"><option value="">All stages</option>${opt(["discovery", "proposal", "negotiation", "onboarding_pending", "delivery", "active", "lost", "ended"], f.stage, STAGE_LABEL)}</select><label class="checkbox-label" style="margin:0"><input type="checkbox" name="attention" value="1" ${f.attention ? "checked" : ""} onchange="this.form.submit()">Needs attention</label>${any ? html`<a href="/accounts" class="text">Clear</a>` : ""}</form></div>
  ${rows.length ? html`<div class="table-wrap"><table><thead><tr><th>Account</th><th>Stage</th><th>Owner</th><th>Next step</th><th>Attention</th></tr></thead><tbody>
  ${rows.map((e) => { const nd = nextDated(e.rel), n = e.ev.signals.length, top = e.ev.signals[0]; return html`<tr class="row-link"><td>${accountCell(e.a)}</td><td>${stageBadge(e.a)}</td><td><span class="owner-cell"><span class="avatar tiny">${initials(s(e.a.owner_name))}</span>${e.a.owner_name}</span><small class="sub">Technical: ${e.a.technical_owner_name ?? html`<span class="amber">unassigned</span>`}</small></td><td>${nd ? html`${nd.title}<small class="sub ${s(nd.due_date) < x.today ? "late" : ""}">${fmtLong(s(nd.due_date))}</small>` : html`<span class="muted">No next step</span>`}</td><td>${n ? html`<span class="badge ${top.severity === "warning" ? "amber" : "red"}"><span class="dot"></span>${n} ${n === 1 ? "signal" : "signals"}</span>` : html`<span class="badge green"><span class="dot"></span>On track</span>`}</td></tr>`; })}</tbody></table></div>`
  : html`<div class="empty">${any ? "No accounts match these filters." : "No accounts yet."}</div>`}</section>`;
}
export function newAccountForm(x: Ctx, d: Record<string, string>, errs: Record<string, string> = {}): H {
  const err = (k: string) => errs[k] ? html`<div class="ferr">${errs[k]}</div>` : "";
  return html`<a href="/accounts" class="back">← Accounts</a><div class="page-heading"><h1>Add account</h1></div>
  <form method="post" action="/accounts" style="max-width:720px"><section class="panel"><div class="section-header"><h2>New account</h2></div><div class="card-body">
  <div class="form-grid"><label class="field"><span>Account name *</span><input name="name" value="${d.name ?? ""}" required autofocus>${err("name")}</label><label class="field"><span>Account owner *</span><select name="owner_id">${userOpt(x.users, d.owner_id ?? x.me?.id)}</select>${err("owner_id")}</label></div>
  <label class="field"><span>Customer contact</span><input name="contact" value="${d.contact ?? ""}"></label>
  <label class="field"><span>Problem in one sentence</span><input name="problem" value="${d.problem ?? ""}"></label>
  <label class="checkbox-label"><input type="checkbox" name="existing" value="1" ${d.existing ? "checked" : ""} onchange="document.getElementById('existing').style.display=this.checked?'block':'none'">Existing customer — already signed, skip presales</label>
  <div id="existing" style="display:${d.existing ? "block" : "none"}">
    <label class="field"><span>Agreed scope, in the contract's words *</span><textarea name="ex_deliverables">${d.ex_deliverables ?? ""}</textarea>${err("ex_deliverables")}</label>
    <div class="form-grid"><label class="field"><span>Price / payment terms *</span><input name="ex_price_terms" value="${d.ex_price_terms ?? ""}">${err("ex_price_terms")}</label><label class="field"><span>Contract reference *</span><input name="ex_evidence" value="${d.ex_evidence ?? ""}" placeholder="order form / DocuSign, date">${err("ex_evidence")}</label></div>
    <label class="field"><span>Success metric *</span><input name="ex_success_metric" value="${d.ex_success_metric ?? ""}">${err("ex_success_metric")}</label>
    <div class="form-grid three"><label class="field"><span>Target *</span><input name="ex_success_target" value="${d.ex_success_target ?? ""}"></label><label class="field"><span>Unit</span><input name="ex_success_unit" value="${d.ex_success_unit ?? ""}"></label><label class="field"><span>Direction</span><select name="ex_success_direction"><option value="higher" ${d.ex_success_direction !== "lower" ? "selected" : ""}>higher is better</option><option value="lower" ${d.ex_success_direction === "lower" ? "selected" : ""}>lower is better</option></select></label></div>
    <div class="form-grid"><label class="field"><span>Technical owner *</span><select name="ex_technical_owner_id">${userOpt(x.users.filter((u) => u.role !== "sales"), d.ex_technical_owner_id)}</select>${err("ex_technical_owner_id")}</label><label class="field"><span>Status</span><select name="ex_status"><option value="active" ${d.ex_status !== "delivery" ? "selected" : ""}>Active</option><option value="delivery" ${d.ex_status === "delivery" ? "selected" : ""}>Delivery</option></select></label></div>
    <div class="form-grid three"><label class="field"><span>Started *</span><input type="date" name="ex_started" value="${d.ex_started ?? ""}">${err("ex_started")}</label><label class="field"><span>Renewal date</span><input type="date" name="ex_renewal_date" value="${d.ex_renewal_date ?? ""}">${err("ex_renewal_date")}</label><label class="field"><span>Notice period (days)</span><input name="ex_notice_days" value="${d.ex_notice_days ?? ""}">${err("ex_notice_days")}</label></div></div>
  </div><div class="modal-footer"><a href="/accounts" class="btn">Cancel</a><button class="primary">Save</button></div></section></form>`;
}

// ---------------------------------------------------------------- Account detail
export { adminPage, gradeExamples, gradeResult, gradeStart, howAlertsWork } from "./views_public.ts";
