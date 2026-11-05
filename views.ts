// Server-rendered HTML. Restrained, text-first. Red = intervention required, amber = unresolved warning; every colour has text.
import { html, raw } from "npm:hono@4.6.14/html";
import type { HtmlEscapedString } from "npm:hono@4.6.14/utils/html";
import type { Row } from "./db.ts";
import { ACTIVITIES, addDays, attention, daysBetween, type Evaluation, handlingOf, isPresales, latest, LOST_REASONS, n, outcomeStatus, parseJSON, type Related, REVIEW_KINDS, reviewStates, s, SEVERITY_LABEL, type Signal, STAGE_LABEL, STALLED_DAYS, RENEWAL_WINDOW_DAYS, CHECKIN_DAYS, CALIBRATION_MIN_AGREEMENT, CALIBRATION_SOURCE } from "./rules.ts";

export type H = HtmlEscapedString | Promise<HtmlEscapedString>;
interface Ctx { me: Row | null; users: Row[]; today: string; path: string; msg: { err?: string; saved?: boolean } }
export interface AccEval { a: Row; rel: Related; ev: Evaluation }

export const CSS = `
body{font:15px/1.45 -apple-system,"Helvetica Neue",Arial,sans-serif;color:#111;max-width:1100px;margin:0 auto;padding:0 24px 80px;background:#fff}
h1,h2,h3{font-family:Georgia,"Times New Roman",serif;font-weight:normal}h1{font-size:26px;margin:20px 0 4px}h2{font-size:19px;margin:28px 0 8px;border-bottom:1px solid #111;padding-bottom:4px}h3{font-size:16px;margin:16px 0 6px}
nav{display:flex;gap:22px;border-bottom:1px solid #111;padding:12px 0;font-size:14px;align-items:baseline}nav a{color:#111;text-decoration:none}nav a.on{text-decoration:underline}nav .sp{flex:1}
table{border-collapse:collapse;width:100%;font-size:14px}th{text-align:left;font-weight:normal;color:#555;border-bottom:1px solid #111;padding:6px 8px 4px;font-size:11px;text-transform:uppercase;letter-spacing:.05em}td{border-bottom:1px solid #ddd;padding:7px 8px;vertical-align:top}tr.click:hover{background:#f6f6f6}
a{color:#111}.muted{color:#666}.small{font-size:13px}.nowrap{white-space:nowrap}
.red{color:#b00020}.amber{color:#9a6700}.green{color:#1a7f37}.lbl{font-size:11px;text-transform:uppercase;letter-spacing:.05em;border:1px solid #999;padding:0 5px;white-space:nowrap;color:#333}.lbl.red{border-color:#b00020}.lbl.amber{border-color:#9a6700}.lbl.green{border-color:#1a7f37}
button{font:inherit;font-size:13px;background:#fff;border:1px solid #111;padding:3px 10px;cursor:pointer;border-radius:0}button.primary{background:#0b57d0;border-color:#0b57d0;color:#fff}button.link{border:0;padding:0;text-decoration:underline;color:#444}
input,select,textarea{font:inherit;font-size:14px;border:1px solid #999;padding:4px 6px;border-radius:0;background:#fff;max-width:100%}textarea{width:100%}input[type=date]{width:150px}
.field{display:block;margin:8px 0}.field>span{display:block;font-size:12px;color:#555;margin-bottom:2px}.row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}.row .field{flex:1;min-width:140px}.ferr{color:#b00020;font-size:13px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:28px}@media(max-width:820px){.grid{grid-template-columns:1fr}}
details summary{cursor:pointer;color:#444;font-size:13px;margin:6px 0}details.drawer{border:1px solid #ddd;padding:0 12px;margin:10px 0}details.drawer[open]{background:#fafafa}details.drawer summary{padding:8px 0}
.banner{border-left:3px solid #0b57d0;padding:8px 12px;margin:12px 0;background:#f4f7fd}.banner.red{border-color:#b00020;background:#fdf4f4}.banner.amber{border-color:#9a6700;background:#fdf9f0}
.flash{padding:8px 12px;margin:12px 0;border:1px solid}.flash.err{border-color:#b00020;color:#b00020}.flash.ok{border-color:#1a7f37;color:#1a7f37}
.tabs{display:flex;gap:18px;border-bottom:1px solid #111;margin:14px 0}.tabs a{padding:6px 0;text-decoration:none;color:#444}.tabs a.on{color:#111;border-bottom:2px solid #111}
ul.check{list-style:none;padding:0;margin:6px 0}ul.check li{padding:2px 0}ul.check li::before{content:"\\2610  "}ul.check li.ok::before{content:"\\2611  "}ul.check li.ok{color:#777}
.metric{display:inline-block;border:1px solid #111;padding:6px 12px;margin:10px 0}.metric b{font:22px Georgia,serif}
.hd{display:flex;gap:16px;align-items:baseline;flex-wrap:wrap}.kv dt{color:#555;font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin-top:8px}.kv dd{margin:0}
blockquote{margin:4px 0;padding-left:10px;border-left:2px solid #999;color:#333}pre.wrap{white-space:pre-wrap;font:inherit;margin:0}
`;
const sev = (x: Signal["severity"]) => x === "warning" ? "amber" : "red";
const sevLabel = (x: Signal["severity"]) => html`<span class="lbl ${sev(x)}">${SEVERITY_LABEL[x]}</span>`;
// timestamps render as Pacific dates; date-only strings pass through
const fmt = (d: unknown) => { const v = s(d); if (!v) return "—"; return v.length > 10 && v.includes("T") ? new Date(v).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }) : v.slice(0, 10); };
const dueWord = (due: string, today: string) => { const k = daysBetween(today, due); return k < 0 ? html`<span class="red">${-k}d overdue</span>` : k === 0 ? html`<b>today</b>` : html`in ${k}d`; };
const opt = (vals: readonly string[], sel?: string, label?: Record<string, string>) => vals.map((v) => html`<option value="${v}" ${v === sel ? "selected" : ""}>${label?.[v] ?? v}</option>`);
const userOpt = (users: Row[], sel?: unknown, blank = "—") => html`<option value="">${blank}</option>${users.map((u) => html`<option value="${u.id}" ${s(u.id) === s(sel) ? "selected" : ""}>${u.name}</option>`)}`;
const stageOf = (a: Row) => STAGE_LABEL[s(a.delivery_status || a.sales_stage)];
const link = (a: Row, tab?: string) => html`<a href="/accounts/${a.id}${tab ? "?tab=" + tab : ""}">${a.name}</a>`;
const nextDated = (rel: Related) => rel.tasks.filter((t) => t.status === "open" && t.due_date).sort((p, q) => s(p.due_date).localeCompare(s(q.due_date)))[0] ?? null;

// Server-side rejections redirect with ?err=; this restores what was typed into the same form (fresh hidden version from the server), so a failed save is recoverable.
const KEEP_INPUT_JS = `(function(){var K='ccc2form';document.addEventListener('submit',function(e){var f=e.target;if(!f||f.method.toLowerCase()!=='post')return;var o={};new FormData(f).forEach(function(v,k){if(typeof v!=='string'||k==='version'||k==='passcode')return;o[k]=(o[k]!==undefined?o[k]+'\\u0000':'')+v});try{sessionStorage.setItem(K,JSON.stringify({a:f.getAttribute('action'),o:o}))}catch(_){}});
var q=new URLSearchParams(location.search);if(!q.get('err')){try{sessionStorage.removeItem(K)}catch(_){}return}var st=null;try{st=JSON.parse(sessionStorage.getItem(K)||'null')}catch(_){}if(!st)return;
document.querySelectorAll('form').forEach(function(f){if(f.getAttribute('action')!==st.a)return;Object.keys(st.o).forEach(function(k){var vals=st.o[k].split('\\u0000');f.querySelectorAll('[name="'+k+'"]').forEach(function(el){if(el.type==='hidden')return;if(el.type==='checkbox'||el.type==='radio'){el.checked=vals.indexOf(el.value)>=0}else{el.value=vals[0]}})});var d=f.closest('details');while(d){d.open=true;d=d.parentElement?d.parentElement.closest('details'):null}f.scrollIntoView({block:'center'})});try{sessionStorage.removeItem(K)}catch(_){}})();`;
export function layout(title: string, body: H, x: Ctx): H {
  const nav = (href: string, label: string) => html`<a href="${href}" class="${x.path === href || (href !== "/" && x.path.startsWith(href)) ? "on" : ""}">${label}</a>`;
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} · Command Center</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${raw(CSS)}</style></head><body>
<nav>${nav("/", "My work")}${nav("/accounts", "Accounts")}<span class="sp"></span>
<form method="post" action="/me" class="small"><input type="hidden" name="next" value="${x.path}">you are <select name="me" onchange="this.form.submit()">${x.users.map((u) => html`<option value="${u.id}" ${x.me && x.me.id === u.id ? "selected" : ""}>${u.name}</option>`)}</select> <span class="muted">(demo identity)</span></form>
<a href="/accounts/new" class="small">Add account</a></nav>
${x.msg.err ? html`<div class="flash err">${x.msg.err}</div>` : ""}${x.msg.saved ? html`<div class="flash ok">Saved.</div>` : ""}
${body}
<script>${raw(KEEP_INPUT_JS)}</script></body></html>`;
}
export const notFound = (): H => html`<h1>Not found</h1><p><a href="/">Back to My work</a></p>`;
export function loginPage(err?: string, next = "/"): H {
  return html`<!doctype html><html><head><meta charset="utf-8"><title>Command Center</title><style>${raw(CSS)}</style></head><body style="max-width:420px;padding-top:80px"><h1>Customer Command Center</h1>
  <form method="post" action="/login"><input type="hidden" name="next" value="${next}"><label class="field"><span>Team passcode</span><input name="passcode" type="password" autofocus></label>${err ? html`<p class="ferr">${err}</p>` : ""}<button class="primary">Enter</button></form>
  <p class="small muted">Shared passcode plus a teammate selector. The selector is a demo identity for assignment, not individual authentication.</p></body></html>`;
}

// Action button for a signal: one specific next step.
function actionFor(sg: Signal, a: Row): H {
  const id = s(a.id);
  switch (sg.actionType) {
    case "decide_review": return html`<a href="/reviews/${sg.subjectId}">Review</a>`;
    case "assign_reviewer": case "assign_technical_owner": return html`<a href="/accounts/${id}?tab=overview#owners">Assign technical owner</a>`;
    case "request_review": return html`<a href="/accounts/${id}?tab=scope#reviews">Request review</a>`;
    case "complete_task": return html`<a href="/accounts/${id}?tab=${sg.reason.includes("milestone") ? "delivery" : "overview"}#actions">Open commitment</a>`;
    case "open_account": return html`<a href="/accounts/${id}">Open account</a>`;
    case "record_calibration": return html`<a href="/accounts/${id}?tab=scope#calibration">Review calibration</a>`;
    case "accept_handoff": return html`<a href="/accounts/${id}/handoff">Accept handoff</a>`;
    case "log_meeting": return html`<a href="/accounts/${id}?tab=overview#log">Log meeting</a>`;
    case "add_action": return html`<a href="/accounts/${id}?tab=overview#add-action">Add action</a>`;
    case "request_delivery_review": return html`<a href="/accounts/${id}?tab=scope#reviews">Request delivery-plan review</a>`;
    case "request_success_review": return html`<a href="/accounts/${id}?tab=scope#reviews">Request success review</a>`;
    case "record_requirements": return html`<a href="/accounts/${id}?tab=scope#requirements">Record data restrictions</a>`;
    case "declare_handling": return html`<a href="/accounts/${id}?tab=scope#proposal">Declare handling</a>`;
    case "resolve_blocker": return html`<a href="/accounts/${id}?tab=delivery#blockers">Resolve blocker</a>`;
    case "record_outcome": return html`<a href="/accounts/${id}?tab=delivery#outcome">Record outcome</a>`;
    case "revise_proposal": return html`<a href="/accounts/${id}?tab=scope#proposal">Revise proposal</a>`;
    case "edit_account": return html`<a href="/accounts/${id}?tab=overview#edit">Edit account</a>`;
    default: return html`<a href="/accounts/${id}">Open</a>`;
  }
}
const nameOf = (x: Ctx, id: unknown) => x.users.find((u) => s(u.id) === s(id))?.name ?? "—";

// ---------------------------------------------------------------- My work
export function myWork(evals: AccEval[], x: Ctx, owner: string, view: string, query: string): H {
  const mine = (e: AccEval) => owner === "all" || s(e.a.owner_id) === owner || s(e.a.technical_owner_id) === owner;
  const qmatch = (e: AccEval) => !query || s(e.a.name).toLowerCase().includes(query.toLowerCase());
  const visible = evals.filter(mine).filter(qmatch);
  const committed = visible.flatMap((e) => e.rel.tasks.filter((t) => t.status === "open" && t.committed && !t.customer_side && (owner === "all" || s(t.owner_id) === owner || s(e.a.owner_id) === owner)));
  const overdueN = committed.filter((t) => t.due_date && s(t.due_date) < x.today).length;
  const attentionRows = visible.filter((e) => e.ev.signals.length).sort((p, q) => { const o = { critical: 0, high: 1, warning: 2 }; return o[p.ev.signals[0].severity] - o[q.ev.signals[0].severity] || s(p.a.created_at).localeCompare(s(q.a.created_at)); });
  const myTasks = evals.flatMap((e) => e.rel.tasks.filter((t) => t.status === "open" && (owner === "all" || s(t.owner_id) === owner)).map((t) => ({ e, t })))
    .sort((p, q) => (s(p.t.due_date) || "9999").localeCompare(s(q.t.due_date) || "9999"));
  const pipeline = visible.filter((e) => isPresales(e.a) || e.a.sales_stage === "lost"), customers = visible.filter((e) => e.a.sales_stage === "won");
  const list = view === "customers" ? customers : pipeline;
  const url = (p: Record<string, string>) => "/?" + new URLSearchParams({ owner, view, q: query, ...p }).toString();
  return html`<form method="get" class="hd" style="margin-top:16px"><h1 style="margin:0">My work</h1>
    <label class="small">owner <select name="owner" onchange="this.form.submit()"><option value="all" ${owner === "all" ? "selected" : ""}>All team</option>${x.users.map((u) => html`<option value="${u.id}" ${owner === s(u.id) ? "selected" : ""}>${u.name}</option>`)}</select></label>
    <input type="hidden" name="view" value="${view}"><input name="q" value="${query}" placeholder="search accounts" size="18"> <button>Search</button> <a href="/accounts/new" class="small">Add account</a></form>
  <div class="metric"><span class="small muted">Open commitments overdue</span> <a href="${url({ view: "commitments" })}" style="text-decoration:none"><b class="${overdueN ? "red" : ""}">${committed.length ? `${overdueN} / ${committed.length}` : "—"}</b></a> <span class="small muted">committed work due before today / all incomplete committed work · <a href="/how-alerts-work">how alerts work</a></span></div>

  <h2>Needs attention</h2>
  ${attentionRows.length ? html`<table><tr><th>Account</th><th>Strongest reason</th><th>Others</th><th>Responsible</th><th>Action</th></tr>
  ${attentionRows.map((e) => { const at = attention(e.ev)!; return html`<tr><td>${link(e.a)}<div class="small muted">${stageOf(e.a)}</div></td><td>${sevLabel(at.top.severity)} ${at.top.reason}${at.top.detail ? html`<div class="small muted">${at.top.detail}</div>` : ""}</td><td class="small">${at.others ? html`+${at.others} <span class="muted">(${e.ev.signals.slice(1, 3).map((g) => g.reason).join("; ")}${at.others > 2 ? "…" : ""})</span>` : "—"}</td><td class="small">${nameOf(x, at.top.ownerId)}</td><td class="small">${actionFor(at.top, e.a)}</td></tr>`; })}</table>` : html`<p class="muted">No automatic issues for this owner.</p>`}

  <h2>${owner === "all" ? "All open actions" : "My actions"}</h2>
  ${myTasks.length ? html`<table><tr><th>Due</th><th>Account</th><th>Task</th><th>Type</th><th></th></tr>
  ${myTasks.map(({ e, t }) => html`<tr><td class="nowrap">${fmt(t.due_date)} ${t.due_date ? html`<span class="small">${dueWord(s(t.due_date), x.today)}</span>` : html`<span class="small muted">no date</span>`}</td><td>${link(e.a)}${s(e.a.owner_id) !== owner && owner !== "all" ? html`<div class="small muted">owner ${e.a.owner_name}</div>` : ""}</td><td>${t.title}${t.committed ? html` <span class="lbl">committed</span>` : ""}${t.required ? html` <span class="lbl">required</span>` : ""}</td><td class="small muted">${t.type}${owner === "all" ? html` · ${t.owner_name ?? "—"}` : ""}</td>
    <td>${t.type === "review" ? html`<a href="/reviews/${t.subject_id}">Decide</a>` : t.type === "handoff" ? html`<a href="/accounts/${e.a.id}/handoff">Accept</a>` : html`<form method="post" action="/tasks/${t.id}/done" style="display:inline"><input type="hidden" name="version" value="${t.version}"><input type="hidden" name="return" value="/"><button>Done</button></form>`}</td></tr>`)}</table>` : html`<p class="muted">Nothing assigned.</p>`}

  <h2><a href="${url({ view: "pipeline" })}" style="text-decoration:${view !== "customers" ? "underline" : "none"}">My pipeline</a> <span class="muted">/</span> <a href="${url({ view: "customers" })}" style="text-decoration:${view === "customers" ? "underline" : "none"}">My customers</a></h2>
  ${list.length ? html`<table><tr><th>Account</th><th>Stage</th><th>Next action</th><th>Top risk</th></tr>
  ${list.map((e) => { const nd = nextDated(e.rel); return html`<tr><td>${link(e.a)}<div class="small muted">${e.a.owner_name}${e.a.technical_owner_name ? html` · ${e.a.technical_owner_name}` : ""}</div></td><td>${stageOf(e.a)}</td><td class="small">${nd ? html`${fmt(nd.due_date)} ${nd.title}` : html`<span class="amber">none dated</span>`}</td><td class="small">${e.ev.signals[0] ? html`${sevLabel(e.ev.signals[0].severity)} ${e.ev.signals[0].reason}` : html`<span class="muted">—</span>`}</td></tr>`; })}</table>` : html`<p class="muted">${view === "customers" ? "No won accounts for this owner." : "No presales accounts for this owner."}</p>`}`;
}

// ---------------------------------------------------------------- Accounts
export function accountsPage(evals: AccEval[], x: Ctx, f: { owner: string; phase: string; stage: string; attention: string; q: string }): H {
  let rows = evals;
  if (f.owner && f.owner !== "all") rows = rows.filter((e) => s(e.a.owner_id) === f.owner || s(e.a.technical_owner_id) === f.owner);
  if (f.phase === "presales") rows = rows.filter((e) => isPresales(e.a)); if (f.phase === "post") rows = rows.filter((e) => e.a.sales_stage === "won"); if (f.phase === "closed") rows = rows.filter((e) => e.a.sales_stage === "lost" || e.a.delivery_status === "ended");
  if (f.stage) rows = rows.filter((e) => s(e.a.delivery_status || e.a.sales_stage) === f.stage);
  if (f.attention) rows = rows.filter((e) => e.ev.signals.length > 0);
  if (f.q) rows = rows.filter((e) => s(e.a.name).toLowerCase().includes(f.q.toLowerCase()));
  const any = Object.values(f).some(Boolean);
  return html`<h1>Accounts</h1>
  <form method="get" class="row small"><label class="field"><span>Search</span><input name="q" value="${f.q}"></label><label class="field"><span>Owner</span><select name="owner"><option value="all" ${f.owner === "all" ? "selected" : ""}>All team</option>${userOpt(x.users, f.owner, "Anyone")}</select></label>
    <label class="field"><span>Phase</span><select name="phase">${opt(["", "presales", "post", "closed"], f.phase, { "": "All", presales: "Presales", post: "Post-sales", closed: "Lost / ended" })}</select></label>
    <label class="field"><span>Stage</span><select name="stage"><option value="">Any</option>${opt(["discovery", "proposal", "negotiation", "onboarding_pending", "delivery", "active", "lost", "ended"], f.stage, STAGE_LABEL)}</select></label>
    <label class="field"><span>&nbsp;</span><label><input type="checkbox" name="attention" value="1" ${f.attention ? "checked" : ""}> needs attention</label></label><button>Filter</button>${any ? html` <a href="/accounts" class="small">Clear filters</a>` : ""}</form>
  ${rows.length ? html`<table><tr><th>Account</th><th>Owner</th><th>Stage</th><th>Next action</th><th>Attention</th></tr>
  ${rows.map((e) => { const nd = nextDated(e.rel), top = e.ev.signals[0]; return html`<tr class="click"><td>${link(e.a)}<div class="small muted">${e.a.contact ?? ""}</div></td><td class="small">${e.a.owner_name}${e.a.technical_owner_name ? html`<div class="muted">tech: ${e.a.technical_owner_name}</div>` : ""}</td><td>${stageOf(e.a)}</td><td class="small">${nd ? html`${fmt(nd.due_date)} ${nd.title}` : html`<span class="amber">none dated</span>`}</td><td class="small">${top ? html`${sevLabel(top.severity)} ${top.reason}${e.ev.signals.length > 1 ? html` <span class="muted">+${e.ev.signals.length - 1}</span>` : ""}` : html`<span class="muted">—</span>`}</td></tr>`; })}</table>`
  : html`<p class="muted">${any ? "No accounts match these filters." : "No accounts yet."} ${any ? html`<a href="/accounts">Clear filters</a>` : html`<a href="/accounts/new">Add the first one</a>`}.</p>`}`;
}
export function newAccountForm(x: Ctx, d: Record<string, string>, errs: Record<string, string> = {}): H {
  return html`<h1>Add account</h1><form method="post" action="/accounts" style="max-width:620px">
  <label class="field"><span>Account name *</span><input name="name" value="${d.name ?? ""}" required autofocus>${errs.name ? html`<div class="ferr">${errs.name}</div>` : ""}</label>
  <label class="field"><span>Account owner *</span><select name="owner_id">${userOpt(x.users, d.owner_id ?? x.me?.id)}</select>${errs.owner_id ? html`<div class="ferr">${errs.owner_id}</div>` : ""}</label>
  <label class="field"><span>Customer contact (optional)</span><input name="contact" value="${d.contact ?? ""}" style="width:100%"></label>
  <label class="field"><span>Problem in one sentence (optional)</span><input name="problem" value="${d.problem ?? ""}" style="width:100%"></label>
  <details class="drawer" ${d.existing ? "open" : ""}><summary>Existing customer (backfill a signed engagement instead of starting in Discovery)</summary>
  <label class="field"><span><input type="checkbox" name="existing" value="1" ${d.existing ? "checked" : ""}> This customer already has a signed engagement</span></label>
  <label class="field"><span>Agreed scope, in the contract's words *</span><textarea name="ex_deliverables" rows="3">${d.ex_deliverables ?? ""}</textarea>${errs.ex_deliverables ? html`<div class="ferr">${errs.ex_deliverables}</div>` : ""}</label>
  <div class="row small"><label class="field" style="flex:2"><span>Price / payment terms *</span><input name="ex_price_terms" value="${d.ex_price_terms ?? ""}"></label><label class="field"><span>Contract reference *</span><input name="ex_evidence" value="${d.ex_evidence ?? ""}" placeholder="order form / DocuSign, date"></label></div>${errs.ex_price_terms ? html`<div class="ferr">${errs.ex_price_terms}</div>` : ""}${errs.ex_evidence ? html`<div class="ferr">${errs.ex_evidence}</div>` : ""}
  <div class="row small"><label class="field" style="flex:2"><span>Success metric *</span><input name="ex_success_metric" value="${d.ex_success_metric ?? ""}"></label><label class="field"><span>Target *</span><input name="ex_success_target" value="${d.ex_success_target ?? ""}" size="6"></label><label class="field"><span>Unit</span><input name="ex_success_unit" value="${d.ex_success_unit ?? ""}" size="4"></label><label class="field"><span>Direction</span><select name="ex_success_direction"><option value="higher" ${d.ex_success_direction !== "lower" ? "selected" : ""}>higher</option><option value="lower" ${d.ex_success_direction === "lower" ? "selected" : ""}>lower</option></select></label></div>${errs.ex_success_metric ? html`<div class="ferr">${errs.ex_success_metric}</div>` : ""}
  <div class="row small"><label class="field"><span>Technical owner *</span><select name="ex_technical_owner_id">${userOpt(x.users.filter((u) => u.role !== "sales"), d.ex_technical_owner_id)}</select></label><label class="field"><span>Status</span><select name="ex_status"><option value="active" ${d.ex_status !== "delivery" ? "selected" : ""}>Active</option><option value="delivery" ${d.ex_status === "delivery" ? "selected" : ""}>Delivery</option></select></label><label class="field"><span>Started *</span><input type="date" name="ex_started" value="${d.ex_started ?? ""}"></label><label class="field"><span>Renewal date</span><input type="date" name="ex_renewal_date" value="${d.ex_renewal_date ?? ""}"></label><label class="field"><span>Notice (days)</span><input name="ex_notice_days" value="${d.ex_notice_days ?? ""}" size="4"></label></div>${errs.ex_technical_owner_id ? html`<div class="ferr">${errs.ex_technical_owner_id}</div>` : ""}${errs.ex_started ? html`<div class="ferr">${errs.ex_started}</div>` : ""}${errs.ex_renewal_date ? html`<div class="ferr">${errs.ex_renewal_date}</div>` : ""}${errs.ex_notice_days ? html`<div class="ferr">${errs.ex_notice_days}</div>` : ""}
  <p class="small muted">Creates rev 1 and an agreement snapshot marked "backfilled". No handoff is generated; data restrictions still need recording.</p></details>
  <p><button class="primary">Save</button> <a href="/accounts" class="small">Cancel</a> <span class="small muted">New prospects start in Discovery. Missing qualification details become prompts later.</span></p></form>`;
}

// ---------------------------------------------------------------- Account detail
export function accountDetail(a: Row, rel: Related, ev: Evaluation, x: Ctx, tab: string, acts: Row[], panel: string): H {
  const id = s(a.id), t = x.today, v = Number(a.version);
  const open = a.sales_stage !== "lost" && a.delivery_status !== "ended";
  const top = ev.signals[0];
  const bannerCls = top?.severity === "critical" || top?.severity === "high" ? "red" : top ? "amber" : "";
  const stageForm = html`<details class="drawer" ${panel === "stage" ? "open" : ""}><summary><b>${stageOf(a)}</b> ${ev.readiness.to ? html`→ ${ev.readiness.toLabel}: ${ev.readiness.ready ? html`<span class="green">ready</span>` : html`${ev.readiness.items.filter((i) => !i.ok).length} missing`}` : ""}</summary>
    ${ev.readiness.to ? html`<ul class="check">${ev.readiness.items.map((i) => html`<li class="${i.ok ? "ok" : ""}">${i.anchor ? html`<a href="/accounts/${id}?tab=${i.anchor === "approvals" ? "scope" : i.anchor}#${i.anchor}">${i.label}</a>` : i.label}${!i.ok && i.hint ? html` <span class="small muted">— ${i.hint}</span>` : ""}</li>`)}</ul>
      ${ev.readiness.via === "advance" ? html`<form method="post" action="/accounts/${id}/stage"><input type="hidden" name="version" value="${v}"><input type="hidden" name="to" value="${ev.readiness.to}"><button class="primary" ${ev.readiness.ready ? "" : "disabled"}>Advance to ${ev.readiness.toLabel}</button> <span class="small muted">Server re-checks the list; filling the last field never moves the deal by itself.</span></form>` : ev.readiness.via === "confirm_agreement" ? html`<p class="small">Won is recorded by <a href="/accounts/${id}?tab=scope#confirm">Confirm agreement</a>, which needs acceptance evidence.</p>` : html`<p class="small">Ending is recorded on the <a href="/accounts/${id}?tab=delivery#end">Delivery &amp; success</a> tab with a reason.</p>`}` : ""}
    ${isPresales(a) ? html`<div class="row small" style="margin:10px 0"><form method="post" action="/accounts/${id}/stage" class="row"><input type="hidden" name="version" value="${v}"><label class="field"><span>Move backward to</span><select name="to">${opt(["discovery", "proposal", "negotiation"].filter((st) => st !== a.sales_stage && ["discovery", "proposal", "negotiation"].indexOf(st) < ["discovery", "proposal", "negotiation"].indexOf(s(a.sales_stage))), undefined, STAGE_LABEL)}</select></label><label class="field" style="flex:2"><span>Reason</span><input name="reason"></label><button>Move back</button></form>
      <form method="post" action="/accounts/${id}/stage" class="row"><input type="hidden" name="version" value="${v}"><input type="hidden" name="to" value="lost"><label class="field"><span>Mark lost — reason</span><select name="reason">${opt(LOST_REASONS)}</select></label><button>Mark lost</button></form></div>` : ""}</details>`;
  const tabs = ["overview", "scope", "delivery"], tabLabel: Record<string, string> = { overview: "Overview", scope: "Scope & approvals", delivery: "Delivery & success" };
  return html`<div class="hd"><h1>${a.name}</h1><span class="small">owner <b>${a.owner_name}</b> · technical owner <b>${a.technical_owner_name ?? html`<span class="amber">unassigned</span>`}</b></span><span class="sp" style="flex:1"></span>
    <a href="/accounts/${id}?tab=overview#log" class="small"><b>Log meeting</b></a> <a href="/accounts/${id}?tab=overview#add-action" class="small">Add action</a>${a.current_agreement_id ? html` <a href="/accounts/${id}/handoff" class="small">Handoff</a>` : ""}</div>
  ${stageForm}
  <div class="banner ${bannerCls}">${ev.nextStep}${top && !ev.nextStep.startsWith(top.reason) ? html` <span class="small muted">· ${top.reason}</span>` : ""}</div>
  <div class="tabs">${tabs.map((tb) => html`<a href="/accounts/${id}?tab=${tb}" class="${tab === tb ? "on" : ""}">${tabLabel[tb]}</a>`)}</div>
  ${tab === "scope" ? scopeTab(a, rel, ev, x) : tab === "delivery" ? deliveryTab(a, rel, ev, x) : overviewTab(a, rel, ev, x, acts)}
  ${open ? "" : html`<p class="small muted">This account is closed (${stageOf(a)}: ${a.lost_reason ?? a.end_reason ?? "no reason"}). Records stay readable.</p>`}`;
}

function overviewTab(a: Row, rel: Related, ev: Evaluation, x: Ctx, acts: Row[]): H {
  const id = s(a.id), t = x.today, v = Number(a.version);
  const openTasks = rel.tasks.filter((k) => k.status === "open");
  return html`<div class="grid"><div>
  <h2 id="edit">Customer</h2>
  ${a.problem ? html`<blockquote>${a.problem}</blockquote>` : html`<p class="amber small">No problem statement yet — needed before Proposal.</p>`}
  <dl class="kv"><dt>Contact</dt><dd>${a.contact ?? html`<span class="muted">unknown</span>`}</dd><dt>Buyer</dt><dd>${a.buyer_status === "named" ? a.buyer : a.buyer_status === "unknown" ? html`<span class="amber">explicitly unknown</span>` : html`<span class="muted">not assessed</span>`}</dd><dt>Budget</dt><dd>${a.budget ?? html`<span class="muted">unknown</span>`}</dd><dt>Last customer contact</dt><dd>${a.last_customer_contact_at ? html`${fmt(a.last_customer_contact_at)} <span class="muted small">(${daysBetween(s(a.last_customer_contact_at), t)}d ago)</span>` : html`<span class="muted">never</span>`}</dd></dl>
  <details class="drawer"><summary>Edit customer details</summary><form method="post" action="/accounts/${id}/edit/overview"><input type="hidden" name="version" value="${v}">
    <label class="field"><span>Problem, in the customer's words</span><textarea name="problem" rows="3">${a.problem ?? ""}</textarea></label>
    <div class="row"><label class="field"><span>Contact</span><input name="contact" value="${a.contact ?? ""}"></label><label class="field"><span>Buyer status</span><select name="buyer_status">${opt(["not_assessed", "unknown", "named"], s(a.buyer_status), { not_assessed: "not assessed", unknown: "explicitly unknown", named: "named" })}</select></label><label class="field"><span>Buyer</span><input name="buyer" value="${a.buyer ?? ""}"></label></div>
    <label class="field"><span>Budget (blank = unknown)</span><input name="budget" value="${a.budget ?? ""}"></label><button class="primary">Save</button> <a href="/accounts/${id}" class="small">Cancel</a></form></details>
  <details class="drawer" id="owners"><summary>Owners</summary><form method="post" action="/accounts/${id}/edit/owners" class="row"><input type="hidden" name="version" value="${v}"><label class="field"><span>Account owner</span><select name="owner_id">${userOpt(x.users, a.owner_id)}</select></label><label class="field"><span>Technical owner</span><select name="technical_owner_id">${userOpt(x.users, a.technical_owner_id, "unassigned")}</select></label><button class="primary">Save</button></form></details>

  <h2>Relationship health <span class="small muted">(manual)</span></h2>
  <p>${{ unknown: html`<span class="muted">Unknown</span>`, healthy: html`<span class="green">Healthy</span>`, watch: html`<span class="amber">Watch</span>`, at_risk: html`<span class="red">At risk</span>` }[s(a.health)] ?? "Unknown"}${a.health_reason ? html` — ${a.health_reason}` : ""}${a.health_reviewed_at ? html` <span class="small muted">(reviewed ${fmt(a.health_reviewed_at)} )</span>` : ""}</p>
  ${ev.signals.length ? html`<p class="small muted">Automatic warnings below stay visible regardless of this assessment.</p>` : ""}
  <details class="drawer"><summary>Assess health</summary><form method="post" action="/accounts/${id}/edit/health" class="row"><input type="hidden" name="version" value="${v}"><label class="field"><span>Health</span><select name="health">${opt(["unknown", "healthy", "watch", "at_risk"], s(a.health), { unknown: "Unknown", healthy: "Healthy", watch: "Watch", at_risk: "At risk" })}</select></label><label class="field" style="flex:3"><span>Reason</span><input name="health_reason" value="${a.health_reason ?? ""}"></label><button class="primary">Save</button></form></details>

  <h2>Current risks <span class="small muted">(automatic)</span></h2>
  ${ev.signals.length ? html`<table>${ev.signals.map((g) => html`<tr><td class="nowrap">${sevLabel(g.severity)}</td><td>${g.reason}${g.detail ? html`<div class="small muted">${g.detail}</div>` : ""}</td><td class="small">${nameOf(x, g.ownerId)}</td><td class="small">${actionFor(g, a)}</td></tr>`)}</table>` : html`<p class="muted">No automatic issues.</p>`}
  </div><div>
  <h2 id="log">Log meeting</h2>
  <form method="post" action="/accounts/${id}/meetings"><div class="row"><label class="field"><span>Date</span><input type="date" name="date" value="${t}"></label><label class="field" style="flex:3"><span>Summary</span><input name="summary" required style="width:100%" placeholder="who, what was said, numbers"></label></div>
    <div class="row small"><label class="field" style="flex:2"><span>Next action (optional)</span><input name="action_title" style="width:100%"></label><label class="field"><span>Owner</span><select name="action_owner">${userOpt(x.users, a.owner_id)}</select></label><label class="field"><span>Due</span><input type="date" name="action_due"></label><label class="field"><span>&nbsp;</span><label><input type="checkbox" name="action_customer_side" value="1"> waiting on customer</label></label></div>
    <button class="primary">Save meeting${""} and action</button></form>
  <h2 id="add-action">Next actions</h2>
  ${openTasks.length ? html`<table>${openTasks.map((k) => html`<tr><td class="nowrap">${fmt(k.due_date)}<div class="small">${k.due_date ? dueWord(s(k.due_date), t) : html`<span class="muted">no date</span>`}</div></td><td>${k.title}${k.committed ? html` <span class="lbl">committed</span>` : ""}<div class="small muted">${k.type} · ${k.owner_name ?? "unassigned"}</div>
    ${["action", "milestone", "measurement"].includes(s(k.type)) ? html`<details><summary>edit</summary><form method="post" action="/tasks/${k.id}/edit" class="row small"><input type="hidden" name="version" value="${k.version}"><label class="field" style="flex:2"><span>Title</span><input name="title" value="${k.title}"></label><label class="field"><span>Owner</span><select name="owner_id">${userOpt(x.users, k.owner_id)}</select></label><label class="field"><span>Due</span><input type="date" name="due_date" value="${k.due_date ?? ""}"></label><label class="field"><span>&nbsp;</span><label><input type="checkbox" name="committed" value="1" ${k.committed ? "checked" : ""}> customer commitment</label>${k.type === "milestone" ? html` <label><input type="checkbox" name="required" value="1" ${k.required ? "checked" : ""}> required</label>` : ""}</label><button>Save</button></form></details>` : ""}</td>
    <td>${k.type === "review" ? html`<a href="/reviews/${k.subject_id}">Decide</a>` : k.type === "handoff" ? html`<a href="/accounts/${id}/handoff">Accept</a>` : html`<form method="post" action="/tasks/${k.id}/done"><input type="hidden" name="version" value="${k.version}"><input type="hidden" name="return" value="/accounts/${id}"><button>Done</button></form>`}</td></tr>`)}</table>` : html`<p class="amber small">No open actions. Every open account should have a dated next step.</p>`}
  <form method="post" action="/accounts/${id}/tasks" class="row small"><input type="hidden" name="type" value="action"><label class="field" style="flex:3"><span>Add action</span><input name="title" required style="width:100%"></label><label class="field"><span>Owner</span><select name="owner_id">${userOpt(x.users, a.owner_id)}</select></label><label class="field"><span>Due</span><input type="date" name="due_date"></label><label class="field"><span>&nbsp;</span><label><input type="checkbox" name="committed" value="1"> our commitment</label> <label><input type="checkbox" name="customer_side" value="1"> waiting on customer</label></label><button>Add</button></form>
  <p class="small muted">A customer commitment requires a due date and counts toward the overdue metric.</p>
  ${rel.tasks.some((k) => k.status !== "open") ? html`<details><summary>${rel.tasks.filter((k) => k.status !== "open").length} completed</summary><ul class="small muted">${rel.tasks.filter((k) => k.status !== "open").map((k) => html`<li>${fmt(k.done_at)} ${k.title}</li>`)}</ul></details>` : ""}

  <h2>Activity</h2>
  <table class="small">${rel.meetings.map((m) => html`<tr><td class="nowrap">${fmt(m.occurred_at)}</td><td><span class="lbl">meeting</span> ${m.summary} <span class="muted">— ${m.author_name ?? ""}</span></td></tr>`)}</table>
  <details><summary>History (${acts.length})</summary><ul class="small muted">${acts.map((e) => { const p = parseJSON<Record<string, unknown>>(e.payload, {}); return html`<li>${fmt(e.at)} <span class="lbl">${s(e.event_type).replace(/_/g, " ")}</span> ${Object.entries(p).filter(([, val]) => val != null && val !== "").map(([k, val]) => `${k}: ${Array.isArray(val) ? val.join(", ") : String(val)}`).join(" · ")}${e.actor_name ? html` — ${e.actor_name}` : ""}</li>`; })}</ul></details>
  </div></div>`;
}

function scopeTab(a: Row, rel: Related, ev: Evaluation, x: Ctx): H {
  const id = s(a.id), t = x.today, v = Number(a.version);
  const p = latest(rel.proposals), req = latest(rel.requirements);
  const h = handlingOf(p);
  const agreement = rel.agreements.find((g) => g.id === a.current_agreement_id) ?? null;
  const agP = agreement ? rel.proposals.find((q) => q.id === agreement.proposal_id) : null;
  const states = reviewStates(a, rel);
  const stateCls: Record<string, string> = { satisfied: "green", open: "amber", missing: "amber", conditional: "amber", stale: "red", blocked: "red" };
  const propBlock = (pp: Row, title: string) => html`<h3>${title}</h3><dl class="kv small"><dt>Deliverables</dt><dd><pre class="wrap">${pp.deliverables ?? "—"}</pre></dd><dt>Exclusions</dt><dd>${pp.exclusions ?? "—"}</dd><dt>Price / payment</dt><dd>${pp.price_terms ?? "—"}</dd><dt>Dates</dt><dd>${pp.dates ?? "—"}</dd><dt>Customer responsibilities</dt><dd>${pp.customer_responsibilities ?? "—"}</dd>
    <dt>Success criterion</dt><dd>${pp.success_metric ?? "—"} ${pp.success_target != null ? html`→ ${pp.success_target}${pp.success_unit ?? ""} (${pp.success_direction} is better; basis: ${pp.success_basis ?? "unspecified"})` : html`<span class="amber">no target</span>`}</dd>
    <dt>Proposed data handling</dt><dd>${handlingText(handlingOf(pp))}</dd></dl>`;
  return html`<div class="grid"><div>
  <h2 id="proposal">Proposed scope &amp; terms ${p ? html`<span class="small muted">rev ${p.revision}${p.shared_at ? `, shared ${fmt(p.shared_at)}` : ", not shared"}${agP && agP.id === p.id ? " — this revision is the accepted agreement" : agreement ? " — proposed change, not yet accepted" : ""}</span>` : ""}</h2>
  ${p ? propBlock(p, "") : html`<p class="muted">No proposal yet.</p>`}
  ${p?.change_note ? html`<p class="small muted">Change note: ${p.change_note}</p>` : ""}
  <details class="drawer"><summary>${p ? "Edit (creates revision " + (Number(p.revision) + 1) + ")" : "Draft proposal"}</summary>
    <form method="post" action="/accounts/${id}/proposals">
    <label class="field"><span>Deliverables *</span><textarea name="deliverables" rows="3">${p?.deliverables ?? ""}</textarea></label>
    <div class="row"><label class="field"><span>Exclusions</span><input name="exclusions" value="${p?.exclusions ?? ""}"></label><label class="field"><span>Price / payment terms</span><input name="price_terms" value="${p?.price_terms ?? ""}"></label><label class="field"><span>Dates</span><input name="dates" value="${p?.dates ?? ""}"></label></div>
    <label class="field"><span>Customer responsibilities</span><input name="customer_responsibilities" value="${p?.customer_responsibilities ?? ""}" style="width:100%"></label>
    <div class="row"><label class="field" style="flex:2"><span>Success metric *</span><input name="success_metric" value="${p?.success_metric ?? ""}"></label><label class="field"><span>Target</span><input name="success_target" value="${p?.success_target ?? ""}" size="6"></label><label class="field"><span>Unit</span><input name="success_unit" value="${p?.success_unit ?? ""}" size="4"></label><label class="field"><span>Direction</span><select name="success_direction">${opt(["higher", "lower"], s(p?.success_direction) || "higher", { higher: "higher is better", lower: "lower is better" })}</select></label><label class="field" style="flex:2"><span>Evaluation basis</span><input name="success_basis" value="${p?.success_basis ?? ""}" placeholder="dataset / version / method"></label></div>
    <h3>Proposed data handling <span class="small muted">(technical owner fills this)</span></h3>
    <div class="row small"><label class="field" style="flex:2"><span>Activities</span>${ACTIVITIES.map((ac) => html`<label><input type="checkbox" name="h_activities[]" value="${ac}" ${(h.activities ?? []).includes(ac) ? "checked" : ""}> ${ac}</label> `)}</label>
      <label class="field" style="flex:2"><span>External processors (comma-separated; blank = none)</span><input name="h_processors" value="${(h.external_processors ?? []).join(", ")}"></label>
      <label class="field"><span>External processing</span><select name="h_external">${opt(["", "no", "yes"], h.external_processing ?? "", { "": "undeclared", no: "no", yes: "yes" })}</select></label>
      <label class="field"><span>Retention</span><select name="h_retention">${opt(["", "none", "custom"], h.retention ?? "", { "": "undeclared", none: "none", custom: "custom" })}</select></label><label class="field"><span>Retention note</span><input name="h_retention_note" value="${h.retention_note ?? ""}"></label>
      <label class="field"><span>Training use</span><select name="h_training">${opt(["", "no", "yes"], h.training_use ?? "", { "": "undeclared", no: "no", yes: "yes" })}</select></label></div>
    <div class="row small"><label class="field" style="flex:2"><span>Change note</span><input name="change_note" placeholder="why this revision"></label><label class="field"><span>&nbsp;</span><label><input type="checkbox" name="shared" value="1"> shared with customer on</label></label><label class="field"><span>&nbsp;</span><input type="date" name="shared_at" value="${t}"></label></div>
    <label class="field small"><span>Waive technical validation — reason (only allowed when no unresolved data restriction)</span><input name="validation_waived_reason" value="${p?.validation_waived_reason ?? ""}" style="width:100%"></label>
    <button class="primary">Save as revision ${p ? Number(p.revision) + 1 : 1}</button> <span class="small muted">Material changes reopen the applicable reviews.</span></form></details>
  ${rel.proposals.length > 1 ? html`<details><summary>Earlier revisions (${rel.proposals.length - 1})</summary>${rel.proposals.slice(1).map((pp) => propBlock(pp, `Rev ${pp.revision} — ${fmt(pp.created_at)}${pp.change_note ? ` — ${pp.change_note}` : ""}`))}</details>` : ""}

  <h2>Accepted agreement</h2>
  ${agreement && agP ? html`<p class="small">Rev ${agP.revision}, accepted ${fmt(agreement.accepted_at)}, recorded by ${agreement.accepted_by_name}. Evidence (as recorded, not independently verified): <i>${agreement.acceptance_evidence}</i>.${agreement.supersedes_id ? html` Supersedes an earlier agreement.` : ""} <a href="/accounts/${id}/handoff">Handoff</a></p>
    ${agP.id !== p?.id ? html`<p class="small amber">The current proposal (rev ${p?.revision}) is a proposed change; the accepted agreement (rev ${agP.revision}) remains operative until an amendment is accepted.</p>` : ""}
    <details><summary>Agreement contents</summary>${propBlock(agP, "")}</details>` : html`<p class="muted">None yet.</p>`}
  ${a.sales_stage === "negotiation" || (agreement && p && p.id !== agP?.id) ? html`<details class="drawer" id="confirm"><summary><b>${agreement ? "Accept amendment" : "Confirm agreement"}</b> (rev ${p?.revision})</summary>
    <form method="post" action="/accounts/${id}/agreements"><input type="hidden" name="version" value="${v}"><div class="row"><label class="field" style="flex:3"><span>Acceptance evidence — note or document link *</span><input name="evidence" required style="width:100%" placeholder="e.g. order form link, signed PDF name, email subject"></label><label class="field"><span>Accepted on</span><input type="date" name="accepted_at" value="${t}"></label></div>
    <button class="primary">${agreement ? "Accept amendment" : "Confirm agreement"}</button> <span class="small muted">Snapshots rev ${p?.revision}${agreement ? ", keeps the earlier agreement, reopens handoff acceptance" : ", marks Won, creates the handoff and its acceptance task"}. A typed note is recorded as a claim.</span></form></details>` : ""}
  </div><div>
  ${calibrationBlock(a, rel, x)}
  <h2 id="requirements">Customer data restrictions ${req ? html`<span class="small muted">rev ${req.revision}</span>` : ""}</h2>
  ${req ? html`<p><b>${{ unknown: "Unknown", none_stated: "None stated", specified: "Specified" }[s(req.restriction_status)]}</b>${req.restriction_status === "unknown" ? html` <span class="amber small">— unknown is not permission</span>` : ""}</p>
    ${req.restriction_status === "specified" ? html`<blockquote class="small">${req.wording}</blockquote><dl class="kv small"><dt>Covered activities</dt><dd>${parseJSON<string[]>(req.activities, []).join(", ") || "—"}</dd><dt>External processing allowed</dt><dd>${req.external_processing}</dd><dt>Retention</dt><dd>${req.retention}${req.retention_note ? ` — ${req.retention_note}` : ""}</dd><dt>Training use allowed</dt><dd>${req.training_use}</dd><dt>Evidence</dt><dd>${req.evidence_note ?? "—"}</dd></dl>` : req.evidence_note ? html`<p class="small muted">${req.evidence_note}</p>` : ""}` : html`<p class="amber small">Not recorded. Unknown is not permission.</p>`}
  ${ev.conflicts.length ? html`<div class="banner red"><b>Proposed change requires review.</b> ${ev.conflicts.join("; ")}.</div>` : ""}
  ${ev.agreementConflicts.length ? html`<div class="banner red"><b>Current agreement needs review.</b> ${ev.agreementConflicts.join("; ")}.</div>` : ""}
  <details class="drawer"><summary>${req ? "Update (creates revision " + (Number(req.revision) + 1) + ")" : "Record data restrictions"}</summary>
    <form method="post" action="/accounts/${id}/requirements">
    <label class="field"><span>Data restrictions</span><select name="restriction_status" onchange="document.getElementById('reqx').style.display=this.value==='specified'?'block':'none'">${opt(["unknown", "none_stated", "specified"], s(req?.restriction_status) || "unknown", { unknown: "unknown", none_stated: "none stated", specified: "specified" })}</select></label>
    <div id="reqx" style="display:${req?.restriction_status === "specified" ? "block" : "none"}">
      <label class="field"><span>Exact customer wording *</span><textarea name="wording" rows="3">${req?.wording ?? ""}</textarea></label>
      <div class="row small"><label class="field" style="flex:2"><span>Covered activities</span>${ACTIVITIES.map((ac) => html`<label><input type="checkbox" name="activities[]" value="${ac}" ${parseJSON<string[]>(req?.activities, []).includes(ac) ? "checked" : ""}> ${ac}</label> `)}</label>
        <label class="field"><span>External processing allowed</span><select name="external_processing">${opt(["unknown", "yes", "no"], s(req?.external_processing) || "unknown")}</select></label>
        <label class="field"><span>Retention requirement</span><select name="retention">${opt(["unknown", "none", "custom"], s(req?.retention) || "unknown")}</select></label><label class="field"><span>Retention note</span><input name="retention_note" value="${req?.retention_note ?? ""}"></label>
        <label class="field"><span>Training use allowed</span><select name="training_use">${opt(["unknown", "yes", "no"], s(req?.training_use) || "unknown")}</select></label></div></div>
    <label class="field small"><span>Evidence / clarification note</span><input name="evidence_note" value="${req?.evidence_note ?? ""}" style="width:100%"></label>
    <button class="primary">Save</button> <span class="small muted">Specified restrictions request a data review of the current proposal.</span></form></details>

  <h2 id="reviews">Technical reviews</h2>
  ${states.length ? html`<ul class="small">${states.map((st) => html`<li><span class="${stateCls[st.state]}">■</span> ${st.why}${st.review ? html` · <a href="/reviews/${st.review.id}">open</a>` : ""}</li>`)}</ul>` : html`<p class="muted small">No review is required yet (a proposal must exist).</p>`}
  ${rel.reviews.filter((r) => !states.some((st) => st.review?.id === r.id)).length ? html`<details><summary>Other reviews</summary><ul class="small">${rel.reviews.filter((r) => !states.some((st) => st.review?.id === r.id)).map((r) => html`<li>${REVIEW_KINDS[s(r.kind)]} — ${r.status} · ${r.reviewer_name ?? "no reviewer"} · <a href="/reviews/${r.id}">open</a></li>`)}</ul></details>` : ""}
  <details class="drawer" id="request-review"><summary>Request a review</summary><form method="post" action="/accounts/${id}/reviews" class="row small"><label class="field"><span>Kind</span><select name="kind">${opt(Object.keys(REVIEW_KINDS), "technical_validation", REVIEW_KINDS)}</select></label><label class="field"><span>Reviewer</span><select name="reviewer_id">${userOpt(x.users, a.technical_owner_id, "technical owner / unassigned")}</select></label><label class="field" style="flex:3"><span>Question</span><input name="question" style="width:100%"></label><button class="primary">Request</button></form>
    <p class="small muted">One task per review; repeating a request reopens the same task. Without a reviewer, an assignment task goes to the account owner.</p></details>

  <h2 id="approvals">Stage readiness</h2>
  <ul class="check">${ev.readiness.items.map((i) => html`<li class="${i.ok ? "ok" : ""}">${i.label}${!i.ok && i.hint ? html` <span class="small muted">— ${i.hint}</span>` : ""}</li>`)}</ul>
  </div></div>`;
}
function handlingText(h: ReturnType<typeof handlingOf>): H {
  if (!h.external_processing && !h.retention && !(h.external_processors ?? []).length) return html`<span class="amber">undeclared</span>`;
  return html`activities: ${(h.activities ?? []).join(", ") || "—"}; external processing: ${h.external_processing ?? "undeclared"}${(h.external_processors ?? []).length ? ` (${h.external_processors!.join(", ")})` : ""}; retention: ${h.retention ?? "undeclared"}${h.retention_note ? ` — ${h.retention_note}` : ""}; training use: ${h.training_use ?? "undeclared"}`;
}

function deliveryTab(a: Row, rel: Related, ev: Evaluation, x: Ctx): H {
  const id = s(a.id), t = x.today, v = Number(a.version);
  if (!a.current_agreement_id) return html`<p class="muted" style="margin:30px 0">Delivery &amp; success becomes relevant once an agreement is confirmed. Nothing to fill in before the sale.</p>`;
  const h = rel.handoffs.find((k) => k.agreement_id === a.current_agreement_id);
  const ms = rel.tasks.filter((k) => k.type === "milestone"), open = rel.blockers.filter((b) => !b.resolved_at), o = rel.outcome, os = outcomeStatus(o);
  const osCls: Record<string, string> = { met: "green", below: "red", not_comparable: "amber", not_measured: "amber", none: "amber" };
  const checkin = rel.tasks.filter((k) => k.status === "open" && k.due_date && /review|check-?in|briefing|QBR/i.test(s(k.title))).sort((p, q) => s(p.due_date).localeCompare(s(q.due_date)))[0];
  return html`<div class="grid"><div>
  <h2>Handoff</h2><p class="small">${h ? (h.accepted_at ? html`Accepted ${fmt(h.accepted_at)} by ${h.accepted_by_name}${h.stale_reason ? html` — <span class="amber">acceptance reopened: ${h.stale_reason}</span>` : ""}` : html`<span class="red">Awaiting acceptance</span> by ${a.technical_owner_name ?? html`<span class="amber">unassigned technical owner</span>`}${h.stale_reason ? html` — ${h.stale_reason}` : ""}`) : "—"} · <a href="/accounts/${id}/handoff">Open handoff</a></p>
  <h2>Committed milestones</h2>
  ${ms.length ? html`<table>${ms.map((k) => html`<tr class="${k.status !== "open" ? "muted" : ""}"><td class="nowrap">${k.status === "open" ? "☐" : "☑"} ${fmt(k.due_date)}${k.status === "open" && k.due_date ? html`<div class="small">${dueWord(s(k.due_date), t)}</div>` : ""}</td><td>${k.title}<div class="small muted">${k.owner_name ?? "unassigned"}${k.required ? " · required" : ""}${k.committed ? " · committed" : ""}</div></td><td>${k.status === "open" ? html`<form method="post" action="/tasks/${k.id}/done"><input type="hidden" name="version" value="${k.version}"><input type="hidden" name="return" value="/accounts/${id}?tab=delivery"><button>Done</button></form>` : ""}</td></tr>`)}</table>` : html`<p class="amber small">No milestones yet; the first one needs an owner and date before Delivery.</p>`}
  <form method="post" action="/accounts/${id}/tasks" class="row small"><input type="hidden" name="type" value="milestone"><label class="field" style="flex:3"><span>Add milestone (committed by default)</span><input name="title" required style="width:100%"></label><label class="field"><span>Owner</span><select name="owner_id">${userOpt(x.users, a.technical_owner_id ?? a.owner_id)}</select></label><label class="field"><span>Due *</span><input type="date" name="due_date" required></label><label class="field"><span>&nbsp;</span><label><input type="checkbox" name="required" value="1" checked> required for Active</label></label><button>Add</button></form>
  <h2 id="blockers">Blockers</h2>
  ${rel.blockers.length ? html`<table>${rel.blockers.map((b) => html`<tr class="${b.resolved_at ? "muted" : ""}"><td class="nowrap">${b.resolved_at ? html`resolved ${fmt(b.resolved_at)}` : html`<span class="red">open ${daysBetween(s(b.opened_at), t)}d</span>`}</td><td>${b.description}<div class="small muted">${b.owner_name ?? ""}${b.resolution ? ` · ${b.resolution}` : ""}</div></td><td>${b.resolved_at ? "" : html`<details><summary>resolve</summary><form method="post" action="/blockers/${b.id}/resolve" class="row small"><label class="field" style="flex:2"><span>How</span><input name="resolution"></label><button>Resolve</button></form></details>`}</td></tr>`)}</table>` : html`<p class="muted small">None.</p>`}
  <form method="post" action="/accounts/${id}/blockers" class="row small"><label class="field" style="flex:3"><span>Add blocker</span><input name="description" required style="width:100%"></label><label class="field"><span>Owner</span><select name="owner_id">${userOpt(x.users, a.technical_owner_id ?? a.owner_id)}</select></label><button>Add</button></form>
  </div><div>
  <h2 id="outcome">Measured success</h2>
  ${o ? html`<p><b>${o.metric}</b> — <span class="${osCls[os.status]}">${{ met: "target met", below: "below target", not_comparable: "not comparable", not_measured: "not yet measured", none: "none" }[os.status]}</span><br><span class="small">${os.why}</span></p>
    <dl class="kv small"><dt>Baseline</dt><dd>${o.baseline ?? html`<span class="muted">unknown</span>`}${o.unit ?? ""}${o.baseline_basis ? html` <span class="muted">on ${o.baseline_basis}</span>` : ""}</dd><dt>Target</dt><dd>${o.target ?? html`<span class="muted">unknown</span>`}${o.unit ?? ""} (${o.direction} is better)</dd><dt>Latest</dt><dd>${o.latest ?? html`<span class="muted">not measured</span>`}${o.latest != null ? html`${o.unit ?? ""} <span class="muted">on ${o.latest_basis ?? "?"}, ${fmt(o.measured_at)}</span>` : ""}</dd></dl>
    <p class="small muted">Task completion is not customer success; only this measurement is.</p>
    ${(rel.measurements ?? []).length ? html`<details><summary>Measurement history (${(rel.measurements ?? []).length})</summary><table><tr><th>Measured</th><th>Value</th><th>Basis</th><th>By</th></tr>${(rel.measurements ?? []).map((m) => html`<tr><td class="nowrap">${m.measured_at}</td><td>${m.value}${o?.unit ?? ""}</td><td>${m.basis ?? "—"}${o?.baseline_basis && m.basis !== o.baseline_basis ? html` <span class="amber">(differs from baseline basis)</span>` : ""}</td><td>${m.recorded_by_name ?? "—"}</td></tr>`)}</table></details>` : ""}` : html`<p class="muted">No success metric recorded.</p>`}
  <details class="drawer"><summary>Record outcome</summary><form method="post" action="/accounts/${id}/outcome"><input type="hidden" name="version" value="${o?.version ?? ""}">
    <div class="row small"><label class="field" style="flex:2"><span>Metric</span><input name="metric" value="${o?.metric ?? ""}"></label><label class="field"><span>Unit</span><input name="unit" value="${o?.unit ?? ""}" size="4"></label><label class="field"><span>Direction</span><select name="direction">${opt(["higher", "lower"], s(o?.direction) || "higher")}</select></label></div>
    <div class="row small"><label class="field"><span>Baseline (blank = unknown)</span><input name="baseline" value="${o?.baseline ?? ""}"></label><label class="field" style="flex:2"><span>Baseline basis</span><input name="baseline_basis" value="${o?.baseline_basis ?? ""}"></label><label class="field"><span>Target</span><input name="target" value="${o?.target ?? ""}"></label></div>
    <div class="row small"><label class="field"><span>Latest (blank = not measured)</span><input name="latest" value="${o?.latest ?? ""}"></label><label class="field" style="flex:2"><span>Latest basis</span><input name="latest_basis" value="${o?.latest_basis ?? o?.baseline_basis ?? ""}"></label><label class="field"><span>Measured on</span><input type="date" name="measured_at" value="${s(o?.measured_at) || t}"></label></div>
    <label class="field small"><span>If not measured: reason (then add a dated measurement task below)</span><input name="not_measured_reason" value="${o?.not_measured_reason ?? ""}" style="width:100%"></label>
    <button class="primary">Save</button> <span class="small muted">A different basis is not shown as comparable improvement.</span></form></details>
  <form method="post" action="/accounts/${id}/tasks" class="row small"><input type="hidden" name="type" value="measurement"><input type="hidden" name="committed" value="1"><label class="field" style="flex:3"><span>Add measurement task</span><input name="title" style="width:100%" value="Measure ${o?.metric ?? "success metric"}"></label><label class="field"><span>Owner</span><select name="owner_id">${userOpt(x.users, a.technical_owner_id ?? a.owner_id)}</select></label><label class="field"><span>Due *</span><input type="date" name="due_date" required></label><button>Add</button></form>
  <h2>Check-ins, renewal, expansion</h2>
  <p class="small">Next check-in: ${checkin ? html`${fmt(checkin.due_date)} — ${checkin.title}` : html`<span class="amber">none scheduled</span>`}<br>Renewal: ${a.renewal_date ? html`${a.renewal_date} (${dueWord(s(a.renewal_date), t)})${a.renewal_notice_days ? html` · notice ${a.renewal_notice_days}d before, i.e. decide by ${addDays(s(a.renewal_date), -Number(a.renewal_notice_days))}` : ""}` : html`<span class="muted">no date</span>`}<br>Expansion: ${a.expansion_note ?? html`<span class="muted">none noted</span>`}</p>
  <details class="drawer"><summary>Edit renewal / expansion</summary><form method="post" action="/accounts/${id}/edit/renewal" class="row small"><input type="hidden" name="version" value="${v}"><label class="field"><span>Renewal date</span><input type="date" name="renewal_date" value="${a.renewal_date ?? ""}"></label><label class="field"><span>Notice period (days before)</span><input name="renewal_notice_days" value="${a.renewal_notice_days ?? ""}" size="4"></label><label class="field" style="flex:3"><span>Expansion next step</span><input name="expansion_note" value="${a.expansion_note ?? ""}" style="width:100%"></label><button class="primary">Save</button></form></details>
  ${a.delivery_status !== "ended" ? html`<details class="drawer" id="end"><summary>End engagement</summary><form method="post" action="/accounts/${id}/end" class="row small"><label class="field" style="flex:3"><span>Outcome / reason *</span><input name="reason" required style="width:100%"></label><label class="field"><span>End date</span><input type="date" name="ended_at" value="${t}"></label><button>End</button></form></details>` : ""}
  </div></div>`;
}

// ---------------------------------------------------------------- Review decision panel
export function reviewPanel(rv: Row, a: Row, rel: Related, ev: Evaluation, x: Ctx): H {
  const hist = parseJSON<Row[]>(rv.history, []);
  const histBlock = hist.length ? html`<h3>Earlier decisions on this review (kept, not overwritten)</h3><ul class="small">${hist.map((h) => html`<li><b>${h.status}</b> ${fmt(h.decided_at)} by ${rel.users.find((u) => u.id === h.reviewer_id)?.name ?? "—"} on proposal rev ${rel.proposals.find((pp) => pp.id === h.proposal_id)?.revision ?? "?"}: ${h.decision_note ?? ""}${parseJSON<{ text: string; done: boolean }[]>(h.conditions, []).length ? html` <span class="muted">conditions: ${parseJSON<{ text: string; done: boolean }[]>(h.conditions, []).map((cd) => (cd.done ? "☑ " : "☐ ") + cd.text).join("; ")}</span>` : ""} <span class="muted">— reopened for: ${h.reopened_for}</span></li>`)}</ul>` : html``;
  const p = rel.proposals.find((q) => q.id === rv.proposal_id) ?? latest(rel.proposals), req = rel.requirements.find((q) => q.id === rv.requirements_id) ?? latest(rel.requirements);
  const prior = rel.reviews.filter((r) => r.kind === rv.kind && r.id !== rv.id && r.decided_at).sort((m, k) => s(k.decided_at).localeCompare(s(m.decided_at)))[0];
  const priorP = prior ? rel.proposals.find((q) => q.id === prior.proposal_id) : null;
  const diff = priorP && p ? ["deliverables", "exclusions", "price_terms", "success_metric", "success_target", "success_basis"].filter((k) => s(priorP[k]) !== s(p[k])) : [];
  const hDiff = priorP && p && JSON.stringify(handlingOf(priorP)) !== JSON.stringify(handlingOf(p));
  const conds = parseJSON<{ text: string; done: boolean }[]>(rv.conditions, []);
  return html`<h1>${REVIEW_KINDS[s(rv.kind)]} · ${link(a, "scope")}</h1>
  <p class="small">Status <b>${rv.status}</b> · reviewer ${rv.reviewer_name ?? html`<span class="amber">unassigned</span>`} · requested ${fmt(rv.requested_at)}${rv.reopened_reason ? html` · <span class="red">reopened: ${rv.reopened_reason}</span>` : ""}</p>
  <div class="grid"><div>
  <h2>Question</h2><p>${rv.question || html`<span class="muted">none written</span>`}</p>
  <h2>Proposal under review ${p ? html`<span class="small muted">rev ${p.revision}</span>` : ""}</h2>
  ${p ? html`<pre class="wrap small">${p.deliverables}</pre><p class="small">Terms: ${p.price_terms ?? "—"} · Success: ${p.success_metric} → ${p.success_target}${p.success_unit ?? ""} on ${p.success_basis ?? "?"}</p><p class="small">Handling: ${handlingText(handlingOf(p))}</p>` : html`<p class="muted">No proposal.</p>`}
  ${histBlock}
  ${prior ? html`<h3>Since the prior decision (rev ${priorP?.revision}, ${prior.status} ${fmt(prior.decided_at)})</h3>${diff.length || hDiff ? html`<ul class="small">${diff.map((k) => html`<li><b>${k}</b>: <span class="muted">${s(priorP![k]) || "—"}</span> → ${s(p![k]) || "—"}</li>`)}${hDiff ? html`<li><b>data handling</b>: <span class="muted">${handlingText(handlingOf(priorP))}</span> → ${handlingText(handlingOf(p))}</li>` : ""}</ul>` : html`<p class="small muted">No material change in the proposal; the requirements or a re-request triggered this.</p>`}` : ""}
  <h2>Customer data restrictions ${req ? html`<span class="small muted">rev ${req.revision}</span>` : ""}</h2>
  ${req ? html`<p class="small"><b>${req.restriction_status}</b>${req.wording ? html`<blockquote>${req.wording}</blockquote>` : ""}${req.restriction_status === "specified" ? html`external processing: ${req.external_processing}; retention: ${req.retention}${req.retention_note ? ` (${req.retention_note})` : ""}; training: ${req.training_use}` : ""}</p>` : html`<p class="amber small">Not recorded — unknown is not permission.</p>`}
  ${ev.conflicts.length ? html`<div class="banner red">Explicit mismatch: ${ev.conflicts.join("; ")}</div>` : ""}
  </div><div>
  <h2>Decision</h2>
  ${rv.status === "open" ? html`<form method="post" action="/reviews/${rv.id}/decide"><input type="hidden" name="version" value="${rv.version}">
    <label class="field"><span>Outcome</span><select name="status"><option value="">—</option>${opt(["approved", "conditional", "blocked"], undefined, { approved: "Approved", conditional: "Approved with conditions", blocked: "Blocked" })}</select></label>
    <label class="field"><span>Conditions (one per line; required for conditional)</span><textarea name="conditions" rows="3"></textarea></label>
    <label class="field"><span>Short explanation *</span><textarea name="decision_note" rows="3" required></textarea></label>
    <button class="primary">Record decision</button> <span class="small muted">Conditional approval does not satisfy a gate until every condition is checked off.</span></form>`
  : html`<p>${rv.status} on ${fmt(rv.decided_at)}: ${rv.decision_note}</p>
    ${conds.length ? html`<form method="post" action="/reviews/${rv.id}/conditions"><ul class="check" style="list-style:none">${conds.map((cd, i) => html`<li style="padding:2px 0"><label><input type="checkbox" name="done[]" value="${i}" ${cd.done ? "checked" : ""}> ${cd.text}</label></li>`)}</ul><button>Update conditions</button> <span class="small muted">reviewer only</span></form>` : ""}
    <p class="small muted">A new proposal revision or requirement revision reopens this review automatically.</p>`}
  </div></div>`;
}

// ---------------------------------------------------------------- Handoff (rendered by reference)
export function handoffPage(a: Row, rel: Related, ev: Evaluation, x: Ctx): H {
  const g = rel.agreements.find((k) => k.id === a.current_agreement_id);
  if (!g) return html`<h1>Handoff · ${link(a)}</h1><p class="muted">No accepted agreement yet.</p>`;
  const p = rel.proposals.find((k) => k.id === g.proposal_id)!, req = rel.requirements.find((k) => k.id === g.requirements_id);
  const h = rel.handoffs.find((k) => k.agreement_id === g.id);
  const ms = rel.tasks.filter((k) => k.type === "milestone");
  return html`<h1>Handoff · ${link(a)}</h1><p class="small muted">Rendered from the accepted agreement (rev ${p.revision}, accepted ${fmt(g.accepted_at)}; evidence as recorded: <i>${g.acceptance_evidence}</i>) and current records. There is no second editable copy.</p>
  <div class="grid"><div>
  <h2>Agreement</h2><dl class="kv small"><dt>Deliverables</dt><dd><pre class="wrap">${p.deliverables}</pre></dd><dt>Exclusions</dt><dd>${p.exclusions ?? "—"}</dd><dt>Price / payment</dt><dd>${p.price_terms ?? "—"}</dd><dt>Dates</dt><dd>${p.dates ?? "—"}</dd><dt>Customer responsibilities</dt><dd>${p.customer_responsibilities ?? "—"}</dd><dt>Success criterion</dt><dd>${p.success_metric} → ${p.success_target}${p.success_unit ?? ""} (${p.success_direction} is better; basis ${p.success_basis ?? "unspecified"})</dd><dt>Data handling as agreed</dt><dd>${handlingText(handlingOf(p))}</dd><dt>Customer restrictions at acceptance</dt><dd>${req ? html`${req.restriction_status}${req.wording ? html` — <i>${req.wording}</i>` : ""}` : "not recorded"}</dd></dl>
  ${changedBeforeAcceptance(p, rel)}
  <h2>People</h2><p class="small">Customer contact: ${a.contact ?? "—"} · Buyer: ${a.buyer ?? "—"} · Account owner: ${a.owner_name} · Technical owner: ${a.technical_owner_name ?? html`<span class="red">unassigned</span>`}</p>
  </div><div>
  <h2>Milestones</h2>${ms.length ? html`<ul class="small">${ms.map((k) => html`<li>${k.status === "open" ? "☐" : "☑"} ${fmt(k.due_date)} ${k.title} <span class="muted">(${k.owner_name ?? "unassigned"})</span></li>`)}</ul>` : html`<p class="amber small">None yet.</p>`}
  ${h?.stale_reason ? html`<p class="small amber">Amendment accepted: review whether these milestones need adjustment; nothing was changed automatically.</p>` : ""}
  <h2>Unresolved risks</h2>${ev.signals.length ? html`<ul class="small">${ev.signals.map((sg) => html`<li>${sevLabel(sg.severity)} ${sg.reason}</li>`)}</ul>` : html`<p class="muted small">None flagged.</p>`}
  ${rel.blockers.filter((b) => !b.resolved_at).length ? html`<ul class="small">${rel.blockers.filter((b) => !b.resolved_at).map((b) => html`<li>Blocker: ${b.description}</li>`)}</ul>` : ""}
  <h2>Acceptance</h2>
  ${!h ? html`<p class="small muted">Backfilled existing engagement: no handoff packet was generated or accepted in this system.</p>` : h?.accepted_at && !h.stale_reason ? html`<p>Accepted ${fmt(h.accepted_at)} by ${h.accepted_by_name}.${h.acceptance_note ? html` <blockquote>${h.acceptance_note}</blockquote>` : ""}</p>` : html`<form method="post" action="/handoffs/${h?.id}/accept"><label class="field"><span>Note (what you are worried about, what you need)</span><input name="note" style="width:100%"></label><button class="primary" ${s(x.me?.id) === s(a.technical_owner_id) ? "" : "disabled"}>I accept this engagement as technical owner</button> ${s(x.me?.id) === s(a.technical_owner_id) ? "" : html`<span class="small muted">only ${a.technical_owner_name ?? "the technical owner"} can accept; switch identity top-right if that is you</span>`}</form>`}
  </div></div>`;
}

// What the customer heard earlier but is not in the accepted text. Delivery should assume they may still expect it.
function changedBeforeAcceptance(p: Row, rel: Related): H {
  const earlier = rel.proposals.filter((k) => Number(k.revision) < Number(p.revision)).sort((x, y) => Number(x.revision) - Number(y.revision));
  if (!earlier.length) return html``;
  const first = earlier[0];
  const FIELDS: [string, string][] = [["deliverables", "Deliverables"], ["exclusions", "Exclusions"], ["price_terms", "Price / payment"], ["dates", "Dates"], ["customer_responsibilities", "Customer responsibilities"], ["success_metric", "Success metric"], ["success_target", "Target"]];
  const diffs = FIELDS.filter(([k]) => s(first[k]) !== s(p[k]));
  const notes = rel.proposals.filter((k) => Number(k.revision) > 1 && Number(k.revision) <= Number(p.revision) && k.change_note).sort((x, y) => Number(x.revision) - Number(y.revision));
  return html`<h2>Changed before acceptance</h2><p class="small muted">Rev 1 → accepted rev ${p.revision}. The customer may still expect what was discussed earlier; confirm before delivering against it.</p>
  ${notes.length ? html`<ul class="small">${notes.map((k) => html`<li>Rev ${k.revision}: ${k.change_note}</li>`)}</ul>` : ""}
  ${diffs.length ? html`<dl class="kv small">${diffs.map(([k, label]) => html`<dt>${label}</dt><dd><span class="muted">was:</span> <pre class="wrap" style="display:inline">${s(first[k]) || "—"}</pre><br><span class="muted">now:</span> <pre class="wrap" style="display:inline">${s(p[k]) || "—"}</pre></dd>`)}</dl>` : html`<p class="small muted">No field differs from rev 1.</p>`}`;
}

// Calibration: the expert grading session that defines "good" and produces the baseline. Shown pre- and post-sale.
function calibrationBlock(a: Row, rel: Related, x: Ctx): H {
  const id = s(a.id), ks = rel.calibrations ?? [];
  const o = rel.outcome;
  return html`<h2 id="calibration">Grading calibration</h2>
  <p class="small muted">An expert grades a sample of the agent's outputs; a grader is fitted to their judgment and checked on held-out examples. The agreement rate says how far the grader can be trusted; the baseline becomes the success measurement only when someone applies it.</p>
  ${ks.length ? html`<table><tr><th>When</th><th>Source</th><th>n</th><th>Agreement</th><th>Baseline</th><th>Failure categories</th><th></th></tr>${ks.map((k) => { const cats = parseJSON<{ label: string; count: number | null }[]>(k.failure_categories, []); const agr = k.agreement == null ? html`<span class="muted">no grader fitted</span>` : html`<span class="${Number(k.agreement) < CALIBRATION_MIN_AGREEMENT ? "amber" : "green"}">${k.agreement}%</span>`; return html`<tr><td class="nowrap">${fmt(k.created_at)}</td><td>${CALIBRATION_SOURCE[s(k.source)] ?? k.source}${k.source === "self_serve_samples" ? html` <span class="amber">(not production)</span>` : ""}<div class="small muted">${k.grader_version ?? ""}${k.expert ? html` · graded by ${k.expert}` : ""}</div></td><td>${k.n_examples}</td><td>${agr}</td><td>${k.baseline != null ? html`${k.baseline}${k.unit ?? ""} <span class="small muted">${k.metric ?? ""}</span>` : "—"}</td><td class="small">${cats.length ? cats.map((c) => `${c.label}${c.count != null ? ` ×${c.count}` : ""}`).join("; ") : "—"}${k.notes ? html`<div class="muted">${k.notes}</div>` : ""}</td><td class="small nowrap">${k.applied ? html`<span class="lbl">baseline in use</span>` : ""}</td></tr>`; })}</table>` : html`<p class="muted small">No grading session recorded. Prospects who used the self-serve page appear here with "pasted samples".</p>`}
  <details class="drawer"><summary>Record a grading session</summary><form method="post" action="/accounts/${id}/calibrations">
    <div class="row small"><label class="field"><span>Examples came from</span><select name="source"><option value="production_sample">production sample (under recorded restrictions)</option><option value="redacted_sample">redacted sample</option><option value="self_serve_samples">pasted samples (self-serve)</option></select></label><label class="field"><span>Examples graded</span><input name="n_examples" size="5"></label><label class="field"><span>Held-out agreement % (blank = no grader fitted)</span><input name="agreement" size="5"></label><label class="field" style="flex:2"><span>Grader version</span><input name="grader_version" placeholder="e.g. metagrader v1 (Trajectory)"></label></div>
    <div class="row small"><label class="field" style="flex:2"><span>Metric</span><input name="metric" value="${o?.metric ?? ""}" placeholder="e.g. Outputs rated unacceptable"></label><label class="field"><span>Baseline</span><input name="baseline" size="6"></label><label class="field"><span>Unit</span><input name="unit" value="${o?.unit ?? "%"}" size="4"></label><label class="field"><span>Direction</span><select name="direction"><option value="lower" ${o?.direction !== "higher" ? "selected" : ""}>lower is better</option><option value="higher" ${o?.direction === "higher" ? "selected" : ""}>higher is better</option></select></label><label class="field" style="flex:2"><span>Expert who graded</span><input name="expert"></label></div>
    <label class="field small"><span>Failure categories, one per line (optionally "label ×count")</span><textarea name="failure_categories" rows="3"></textarea></label>
    <label class="field small"><span>Notes (what was contested, what the sample excluded)</span><input name="notes" style="width:100%"></label>
    <label class="small"><input type="checkbox" name="apply" value="1"> Use this baseline as the success measurement for this account (replaces the current baseline; the basis records grader and sample)</label>
    <p><button class="primary">Save</button></p></form></details>`;
}

export { adminPage, gradeExamples, gradeResult, gradeStart, howAlertsWork } from "./views_public.ts";
export { attention, n };
