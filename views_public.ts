// Public self-serve grading pages (no nav, no passcode). Split from views.ts to stay under Val Town's 80k-per-file limit.
import { html, raw } from "npm:hono@4.6.14/html";
import type { H } from "./views.ts";
import { CSS } from "./views.ts";
import { CALIBRATION_MIN_AGREEMENT, CHECKIN_DAYS, RENEWAL_WINDOW_DAYS, STALLED_DAYS } from "./rules.ts";

// ---- public self-serve grading pages (no nav, no passcode) ----
function publicLayout(title: string, body: H): H {
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${raw(CSS)}</style></head><body style="max-width:760px"><p class="small muted" style="margin-top:18px">Evalhouse · self-serve grading</p>${body}</body></html>`;
}
export function gradeStart(d: Record<string, string>, errs: Record<string, string> = {}): H {
  const e = (k: string) => errs[k] ? html`<div class="ferr">${errs[k]}</div>` : "";
  return publicLayout("Grade your agent", html`<h1>Grade 20 of your agent's outputs</h1>
  <p>Paste outputs your AI agent produced, mark each one good or bad and say why. You get back a draft rubric of what you seem to care about and the share you rated unacceptable. Takes about 20 minutes.</p>
  <p class="small"><b>Do not paste customer data or production logs.</b> Use synthetic, redacted or your own test examples. Real traces are graded later, in a session under your data restrictions.</p>
  <form method="post" action="/grade/examples">
  <div class="row"><label class="field"><span>Company *</span><input name="company" value="${d.company ?? ""}">${e("company")}</label><label class="field"><span>Your name and email *</span><input name="contact" value="${d.contact ?? ""}">${e("contact")}</label></div>
  <label class="field"><span>What does the agent do? (one sentence) *</span><input name="agent" value="${d.agent ?? ""}" style="width:100%">${e("agent")}</label>
  <label class="field"><span>Outputs, separated by a blank line (5-20) *</span><textarea name="examples" rows="14">${d.examples ?? ""}</textarea>${e("examples")}</label>
  <p><button class="primary">Next: grade them</button></p></form>`);
}
export function gradeExamples(d: Record<string, string>, ex: string[], prev: { grade: string; why: string }[] = [], err?: string): H {
  return publicLayout("Grade your agent", html`<h1>Grade each output</h1>${err ? html`<div class="flash err">${err}</div>` : ""}
  <p class="small muted">${d.company} · ${ex.length} outputs. For every bad one, say in a few words what is wrong; the same words for the same problem.</p>
  <form method="post" action="/grade/submit"><input type="hidden" name="company" value="${d.company}"><input type="hidden" name="contact" value="${d.contact}"><input type="hidden" name="agent" value="${d.agent}"><input type="hidden" name="n" value="${ex.length}">
  ${ex.map((t, i) => html`<div style="border-top:1px solid #ddd;padding:10px 0"><input type="hidden" name="e${i}" value="${t}"><pre class="wrap small">${t}</pre>
  <div class="row small"><label><input type="radio" name="g${i}" value="good" ${prev[i]?.grade === "good" ? "checked" : ""}> good</label><label><input type="radio" name="g${i}" value="bad" ${prev[i]?.grade === "bad" ? "checked" : ""}> bad</label><label class="field" style="flex:1"><span>why (if bad)</span><input name="w${i}" value="${prev[i]?.why ?? ""}" style="width:100%"></label></div></div>`)}
  <p><button class="primary">Get my draft rubric</button></p></form>`);
}
export function gradeResult(d: Record<string, string>, n: number, bad: number, cats: { label: string; count: number }[]): H {
  const rate = Math.round((bad / n) * 1000) / 10;
  return publicLayout("Your draft rubric", html`<h1>${d.company}: draft rubric</h1>
  <p><b>${bad} of ${n}</b> outputs rated unacceptable (${rate}%) on the examples you pasted. This is a starting point, not a measurement: it was graded on samples you chose, not on production traffic.</p>
  <h2>What you seem to care about</h2>${cats.length ? html`<ol>${cats.map((c) => html`<li>${c.label} <span class="muted small">(${c.count} of ${bad})</span></li>`)}</ol>` : html`<p class="muted">Nothing was marked bad, so there is no rubric yet. Try harder examples.</p>`}
  <h2>What we'd need to measure it for real</h2><ol class="small"><li>Which outputs we may look at: a redacted sample, or production traces under your data restrictions (retention, external processing, training use).</li><li>Two hours of the person who graded these, on a real sample, so a grader can be fitted to their judgment and checked on held-out examples.</li><li>The number you would call success, and by when.</li></ol>
  <p class="small muted">We saved this as a discovery lead for ${d.company}; someone will follow up with ${d.contact}. Nothing you pasted is used for anything else.</p>`);
}


export function howAlertsWork(): H {
  return html`<h1>How alerts work</h1>
  <p>Alerts are computed from records every time a page loads; nothing is stored as a "health score". Each alert names its rule, the person responsible, and one action. Thresholds are demo assumptions.</p>
  <table><tr><th>Rule</th><th>Condition</th><th>Severity · action</th></tr>
  <tr><td>Data conflict</td><td>Specified customer restriction explicitly contradicts the proposed data handling (external processing, training use, retention)</td><td>Critical · request data review; blocks approval and delivery gates. A proposed change is labelled "Proposed change requires review"; a conflict with the accepted agreement is "Current agreement needs review". The app records requirements and decisions; it does not certify compliance.</td></tr>
  <tr><td>Review open / reopened</td><td>A review task is open; reopened when the bound proposal or requirement revision changes materially</td><td>High if reopened, warning if pending · decide</td></tr>
  <tr><td>Approval stale</td><td>The last decision was for an earlier revision</td><td>High · request review</td></tr>
  <tr><td>Overdue commitment</td><td>Incomplete committed task due before today</td><td>High · owner completes it</td></tr>
  <tr><td>Handoff pending</td><td>Agreement confirmed, technical owner has not accepted</td><td>High · accept handoff</td></tr>
  <tr><td>Delivery intervention</td><td>Open blocker and an overdue committed milestone</td><td>High · request delivery-plan review</td></tr>
  <tr><td>Renewal intervention</td><td>Renewal decision deadline (renewal date minus the notice period, if any) within ${RENEWAL_WINDOW_DAYS} days or past, and the latest comparable result misses target or is missing</td><td>High · request success review</td></tr>
  <tr><td>Customer late</td><td>An action marked "waiting on customer" is past its date</td><td>High · log meeting. Customer-side items never count as our commitments.</td></tr>
  <tr><td>Waiting on customer</td><td>An action marked "waiting on customer" is pending</td><td>Warning · shown instead of "stalled" while the date has not passed</td></tr>
  <tr><td>Below target</td><td>Active account whose latest comparable result misses the target, regardless of renewal date</td><td>Warning · record outcome / plan remediation</td></tr>
  <tr><td>Check-in overdue</td><td>Post-sale account with no customer meeting for ${CHECKIN_DAYS} days (or none ever)</td><td>Warning · log meeting</td></tr>
  <tr><td>Grader uncalibrated</td><td>The baseline in use comes from a grading session with held-out agreement under ${CALIBRATION_MIN_AGREEMENT}%, or hand grading with no grader fitted</td><td>Warning · review calibration. The grader produces numbers; a person applies them as the baseline.</td></tr>
  <tr><td>Baseline not production</td><td>The baseline in use came from pasted self-serve samples</td><td>Warning · re-grade on a real sample in discovery</td></tr>
  <tr><td>Unowned action</td><td>Open action or milestone with no owner (blank owner is recorded, not reassigned)</td><td>Warning · assign</td></tr>
  <tr><td>Expansion unowned</td><td>Expansion noted but no open action mentioning it</td><td>Warning · add action</td></tr>
  <tr><td>Stalled prospect</td><td>Open presales account with no customer contact for ${STALLED_DAYS} days (created date if never contacted)</td><td>Warning · log meeting</td></tr>
  <tr><td>Missing next step</td><td>Open account with no incomplete dated action</td><td>Warning · add action</td></tr>
  <tr><td>Clarification</td><td>Restrictions unknown, custom wording, or undeclared handling</td><td>Warning · record restrictions / declare handling</td></tr>
  <tr><td>Nonblocking gaps</td><td>Budget unknown, baseline missing</td><td>Warning · edit</td></tr></table>
  <h2>What stays human</h2><p>Confirming a customer agreement (with evidence), deciding a review, accepting a handoff, assessing relationship health (with a reason), recording a measurement, and ending an engagement. Automatic warnings cannot be hidden by choosing "Healthy". Nothing sends external messages.</p>
  <h2>Dedup and reopen</h2><p>One automation task per (account, rule, subject). Repeated requests reopen the same task. Resolving the source resolves the alert; recurrence reopens it. Reviews close through their decision, not a checkbox.</p><p class="small"><a href="/admin">Admin: reset shared data</a> (separate admin passcode).</p>`;
}
export function adminPage(): H { return html`<h1>Admin</h1><h2>Reset shared data</h2><form method="post" action="/admin/reseed" class="row small"><label class="field"><span>Admin passcode (not the team passcode)</span><input type="password" name="passcode"></label><button>Reset to the seed scenario</button></form><p class="small muted">Deletes every record and reloads the five seeded accounts for everyone. Needs the separate admin passcode set in <code>CCC_ADMIN_PASSCODE</code>.</p>`; }
