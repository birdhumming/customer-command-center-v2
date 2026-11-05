// Customer Command Center v2. One Deno process: Hono routes + server-rendered HTML. Rules live in rules.ts.
import { Hono } from "npm:hono@4.6.14";
import type { Context } from "npm:hono@4.6.14";
import { deleteCookie, getCookie, setCookie } from "npm:hono@4.6.14/cookie";
import { type Arg, db as getDB, nowISO, type Row, type Stmt, uuid } from "./db.ts";
import { seed } from "./seed.ts";
import { activity, loadAccount, loadAccounts, loadRelated, todayISO, users as loadUsers } from "./data.ts";
import { conflicts, evaluateAccount, handlingOf, isPresales, latest, readinessFor, REVIEW_KINDS, s, STAGE_LABEL, type Related } from "./rules.ts";
import * as V from "./views.ts";

const d = await getDB();
await seed(d);
const PASSCODE = Deno.env.get("CCC_PASSCODE") ?? "evalhouse";
const AUTH = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ccc2:" + PASSCODE)))).map((b) => b.toString(16).padStart(2, "0")).join("");
const app = new Hono();

type Body = Record<string, string | File | (string | File)[]>;
const str = (f: Body, k: string) => { const v = f[k]; return typeof v === "string" ? v.trim() : ""; };
const nul = (f: Body, k: string): Arg => str(f, k) || null;
const num = (f: Body, k: string): number | null => { const v = str(f, k).replace(/[$,%\s]/g, ""); if (!v) return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const arr = (f: Body, k: string): string[] => { const v = f[k + "[]"] ?? f[k]; if (v == null) return []; return (Array.isArray(v) ? v : [v]).map((x) => typeof x === "string" ? x.trim() : "").filter(Boolean); };
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));
const safeNext = (v: string | undefined) => v && v.startsWith("/") && !v.startsWith("//") ? v : "/";
const q = (c: Context, k: string) => c.req.query(k) ?? "";

// ---- session: shared passcode + seeded teammate identity (demo identity, not authentication) ----
app.get("/healthz", (c) => c.text("ok"));
app.get("/login", (c) => c.html(V.loginPage(undefined, safeNext(c.req.query("next")))));
app.post("/login", async (c) => {
  const f = await c.req.parseBody() as Body, next = safeNext(str(f, "next"));
  if (str(f, "passcode") !== PASSCODE) return c.html(V.loginPage("Wrong passcode.", next), 401);
  setCookie(c, "ccc2_auth", AUTH, { path: "/", maxAge: 60 * 60 * 24 * 30, httpOnly: true, sameSite: "Lax" });
  return c.redirect(next);
});
app.use("*", async (c, next) => {
  if (["/login", "/healthz"].includes(c.req.path)) return next();
  if (getCookie(c, "ccc2_auth") !== AUTH) {
    if (c.req.method !== "GET") return c.text("unauthorized", 401);
    return c.redirect("/login?next=" + encodeURIComponent(c.req.path + (new URL(c.req.url).search || "")));
  }
  await next();
});
app.post("/me", async (c) => {
  const f = await c.req.parseBody() as Body;
  const ok = str(f, "me") && await d.get("SELECT id FROM cc2_users WHERE id=?", [str(f, "me")]);
  if (ok) setCookie(c, "ccc2_me", str(f, "me"), { path: "/", maxAge: 60 * 60 * 24 * 365 }); else deleteCookie(c, "ccc2_me", { path: "/" });
  return c.redirect(safeNext(str(f, "next")) || "/");
});

interface Ctx { me: Row | null; users: Row[]; today: string; path: string; msg: { err?: string; saved?: boolean } }
async function ctx(c: Context): Promise<Ctx> {
  const us = await loadUsers(d);
  const meId = getCookie(c, "ccc2_me");
  return { me: us.find((u) => u.id === meId) ?? us[0] ?? null, users: us, today: todayISO(), path: c.req.path, msg: { err: c.req.query("err") || undefined, saved: c.req.query("saved") === "1" } };
}
const page = (c: Context, x: Ctx, title: string, body: V.H, status = 200) => c.html(V.layout(title, body, x), status as 200);
const back = (c: Context, path: string, err?: string, saved = false) => c.redirect(`${path}${err ? "?err=" + encodeURIComponent(err) : saved ? "?saved=1" : ""}`);
const accPath = (id: string, tab?: string, anchor?: string) => `/accounts/${id}${tab ? "?tab=" + tab : ""}${anchor ? "#" + anchor : ""}`;
const act = (account_id: string, actor_id: string | null, event_type: string, payload: Record<string, unknown> = {}): Stmt => ({ sql: "INSERT INTO cc2_activity(id,account_id,actor_id,event_type,at,payload) VALUES (?,?,?,?,?,?)", args: [uuid(), account_id, actor_id, event_type, nowISO(), JSON.stringify(payload)] });
const touch = (id: string): Stmt => ({ sql: "UPDATE cc2_accounts SET version=version+1, updated_at=? WHERE id=?", args: [nowISO(), id] });
async function loadEval(id: string, us?: Row[]) {
  const a = await loadAccount(d, id); if (!a) return null;
  const rel = await loadRelated(d, id, us);
  return { a, rel, ev: evaluateAccount(a, rel, todayISO()) };
}
// Optimistic concurrency: the form carries the version it was rendered from.
const versionMismatch = (row: Row | undefined, f: Body) => { const v = num(f, "version"); return row && v != null && Number(row.version) !== v; };

// Automation tasks are unique per (account, rule, subject). Re-requests reopen the same row.
async function ensureTask(account_id: string, key: string, subject_id: string, fields: { title: string; type: string; owner_id: string | null; due_date: string | null; required?: number; committed?: number; created_by: string | null }): Promise<Stmt[]> {
  const ex = await d.get("SELECT id, status FROM cc2_tasks WHERE account_id=? AND automation_key=? AND subject_id=?", [account_id, key, subject_id]);
  if (ex) return [{ sql: "UPDATE cc2_tasks SET status='open', done_at=NULL, title=?, owner_id=COALESCE(?, owner_id), due_date=COALESCE(?, due_date), updated_at=?, version=version+1 WHERE id=?", args: [fields.title, fields.owner_id, fields.due_date, nowISO(), s(ex.id)] }];
  return [{ sql: "INSERT INTO cc2_tasks(id,account_id,title,type,owner_id,due_date,status,committed,required,automation_key,subject_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,'open',?,?,?,?,?,?,?)",
    args: [uuid(), account_id, fields.title, fields.type, fields.owner_id, fields.due_date, fields.committed ?? 0, fields.required ?? 1, key, subject_id, fields.created_by, nowISO(), nowISO()] }];
}
const closeTask = (key: string, subject_id: string): Stmt => ({ sql: "UPDATE cc2_tasks SET status='done', done_at=?, updated_at=? WHERE automation_key=? AND subject_id=? AND status='open'", args: [nowISO(), nowISO(), key, subject_id] });

// Request (or reopen) a review bound to the current proposal + requirement revisions.
async function requestReview(a: Row, rel: Related, kind: string, question: string, reviewerId: string | null, byId: string | null, reopenedReason: string | null, today: string): Promise<Stmt[]> {
  const p = latest(rel.proposals), req = latest(rel.requirements);
  const existing = rel.reviews.find((r) => r.kind === kind);
  const st: Stmt[] = [];
  const reviewer = reviewerId ?? (existing ? s(existing.reviewer_id) || null : null) ?? (s(a.technical_owner_id) || null);
  let reviewId: string;
  if (existing && existing.status === "open") {
    reviewId = s(existing.id);
    st.push({ sql: "UPDATE cc2_reviews SET proposal_id=?, requirements_id=?, reopened_reason=COALESCE(?, reopened_reason), question=COALESCE(NULLIF(?, ''), question), reviewer_id=COALESCE(?, reviewer_id), version=version+1 WHERE id=?", args: [s(p?.id) || null, s(req?.id) || null, reopenedReason, question, reviewer, reviewId] });
  } else if (existing) {
    reviewId = s(existing.id);
    st.push({ sql: "UPDATE cc2_reviews SET status='open', proposal_id=?, requirements_id=?, reopened_reason=?, question=COALESCE(NULLIF(?, ''), question), reviewer_id=COALESCE(?, reviewer_id), decided_at=NULL, version=version+1 WHERE id=?", args: [s(p?.id) || null, s(req?.id) || null, reopenedReason ?? "re-requested", question, reviewer, reviewId] });
  } else {
    reviewId = uuid();
    st.push({ sql: "INSERT INTO cc2_reviews(id,account_id,kind,question,proposal_id,requirements_id,reviewer_id,status,requested_by,requested_at) VALUES (?,?,?,?,?,?,?,'open',?,?)", args: [reviewId, s(a.id), kind, question, s(p?.id) || null, s(req?.id) || null, reviewer, byId, nowISO()] });
  }
  const title = `${REVIEW_KINDS[kind]}: ${a.name}${reopenedReason ? ` — ${reopenedReason}` : ""}`;
  if (reviewer) st.push(...await ensureTask(s(a.id), "review", reviewId, { title, type: "review", owner_id: reviewer, due_date: addDaysISO(today, 3), created_by: byId }));
  else st.push(...await ensureTask(s(a.id), "assign_reviewer", kind, { title: `Assign a technical reviewer for ${REVIEW_KINDS[kind].toLowerCase()}: ${a.name}`, type: "action", owner_id: s(a.owner_id), due_date: addDaysISO(today, 2), created_by: byId }));
  st.push(act(s(a.id), byId, existing ? "review_reopened" : "review_requested", { kind, reason: reopenedReason, reviewer }));
  return st;
}
const addDaysISO = (date: string, n: number) => { const x = new Date(date + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// ---- pages ----
app.get("/", async (c) => {
  const x = await ctx(c);
  const ownerFilter = q(c, "owner") || s(x.me?.id);
  const accounts = await loadAccounts(d);
  const evals = [];
  for (const a of accounts) { const rel = await loadRelated(d, s(a.id), x.users); evals.push({ a, rel, ev: evaluateAccount(a, rel, x.today) }); }
  return page(c, x, "My work", V.myWork(evals, x, ownerFilter, q(c, "view") || "pipeline", q(c, "q")));
});
app.get("/how-alerts-work", async (c) => { const x = await ctx(c); return page(c, x, "How alerts work", V.howAlertsWork()); });
app.get("/accounts", async (c) => {
  const x = await ctx(c);
  const accounts = await loadAccounts(d);
  const evals = [];
  for (const a of accounts) { const rel = await loadRelated(d, s(a.id), x.users); evals.push({ a, rel, ev: evaluateAccount(a, rel, x.today) }); }
  return page(c, x, "Accounts", V.accountsPage(evals, x, { owner: q(c, "owner"), phase: q(c, "phase"), stage: q(c, "stage"), attention: q(c, "attention"), q: q(c, "q") }));
});
app.get("/accounts/new", async (c) => { const x = await ctx(c); return page(c, x, "Add account", V.newAccountForm(x, {})); });
app.post("/accounts", async (c) => {
  const x = await ctx(c), f = await c.req.parseBody() as Body;
  const draft = { name: str(f, "name"), owner_id: str(f, "owner_id"), contact: str(f, "contact"), problem: str(f, "problem") };
  if (!draft.name) return page(c, x, "Add account", V.newAccountForm(x, draft, { name: "Account name is required." }), 400);
  if (!draft.owner_id || !x.users.some((u) => u.id === draft.owner_id)) return page(c, x, "Add account", V.newAccountForm(x, draft, { owner_id: "Pick an account owner." }), 400);
  const id = uuid();
  await d.tx([
    { sql: "INSERT INTO cc2_accounts(id,name,owner_id,contact,problem,sales_stage,created_at,updated_at) VALUES (?,?,?,?,?,'discovery',?,?)", args: [id, draft.name, draft.owner_id, draft.contact || null, draft.problem || null, nowISO(), nowISO()] },
    act(id, s(x.me?.id) || null, "account_created", { name: draft.name }),
  ]);
  return back(c, accPath(id), undefined, true);
});
app.get("/accounts/:id", async (c) => {
  const x = await ctx(c), id = c.req.param("id");
  const r = await loadEval(id, x.users); if (!r) return page(c, x, "Not found", V.notFound(), 404);
  return page(c, x, s(r.a.name), V.accountDetail(r.a, r.rel, r.ev, x, q(c, "tab") || "overview", await activity(d, id), q(c, "panel")));
});

// Small explicit edits with optimistic versioning.
const ACCOUNT_FIELDS: Record<string, string[]> = {
  overview: ["contact", "buyer", "buyer_status", "problem", "budget"],
  owners: ["owner_id", "technical_owner_id"],
  health: ["health", "health_reason"],
  renewal: ["renewal_date", "expansion_note"],
};
app.post("/accounts/:id/edit/:section", async (c) => {
  const x = await ctx(c), id = c.req.param("id"), section = c.req.param("section"), f = await c.req.parseBody() as Body;
  const a = await loadAccount(d, id); if (!a) return c.notFound();
  const fields = ACCOUNT_FIELDS[section]; if (!fields) return c.notFound();
  if (versionMismatch(a, f)) return back(c, accPath(id, "overview"), "Someone else changed this account since you opened it. Reload and retry; your text was not saved.");
  const vals: Record<string, Arg> = {};
  for (const k of fields) vals[k] = nul(f, k);
  if (section === "overview") { if (!["not_assessed", "unknown", "named"].includes(s(vals.buyer_status))) vals.buyer_status = "not_assessed"; if (vals.buyer_status === "named" && !vals.buyer) return back(c, accPath(id), "Buyer status is 'named' but no buyer name given."); }
  if (section === "owners") { if (!vals.owner_id || !x.users.some((u) => u.id === vals.owner_id)) return back(c, accPath(id), "Account owner is required."); if (vals.technical_owner_id && !x.users.some((u) => u.id === vals.technical_owner_id)) vals.technical_owner_id = null; }
  if (section === "renewal" && vals.renewal_date && !isDate(s(vals.renewal_date))) return back(c, accPath(id, "delivery"), "Renewal date must be YYYY-MM-DD.");
  if (section === "health") { if (!["unknown", "healthy", "watch", "at_risk"].includes(s(vals.health))) return back(c, accPath(id), "Pick a health value."); if (vals.health !== "unknown" && !vals.health_reason) return back(c, accPath(id), "A health assessment needs a reason."); vals.health_reviewed_at = nowISO(); }
  const keys = Object.keys(vals);
  const st: Stmt[] = [{ sql: `UPDATE cc2_accounts SET ${keys.map((k) => k + "=?").join(",")}, version=version+1, updated_at=? WHERE id=?`, args: [...keys.map((k) => vals[k]), nowISO(), id] }, act(id, s(x.me?.id) || null, section === "health" ? "health_assessed" : "account_edited", { section, ...vals })];
  // a new technical owner inherits open reviews that have no reviewer
  if (section === "owners" && vals.technical_owner_id) st.push({ sql: "UPDATE cc2_reviews SET reviewer_id=? WHERE account_id=? AND status='open' AND reviewer_id IS NULL", args: [vals.technical_owner_id, id] }, { sql: "UPDATE cc2_tasks SET owner_id=? WHERE account_id=? AND automation_key='review' AND status='open' AND owner_id IS NULL", args: [vals.technical_owner_id, id] });
  await d.tx(st);
  return back(c, accPath(id, section === "renewal" ? "delivery" : "overview"), undefined, true);
});

// Log meeting + optional action in one transaction. Updates last customer contact.
app.post("/accounts/:id/meetings", async (c) => {
  const x = await ctx(c), id = c.req.param("id"), f = await c.req.parseBody() as Body;
  const a = await loadAccount(d, id); if (!a) return c.notFound();
  const date = isDate(str(f, "date")) ? str(f, "date") : x.today;
  if (!str(f, "summary")) return back(c, accPath(id, "overview", "log"), "A meeting needs a one-line summary.");
  const st: Stmt[] = [
    { sql: "INSERT INTO cc2_meetings(id,account_id,occurred_at,summary,author_id,created_at) VALUES (?,?,?,?,?,?)", args: [uuid(), id, date + "T12:00:00.000Z", str(f, "summary"), s(x.me?.id) || null, nowISO()] },
    { sql: "UPDATE cc2_accounts SET last_customer_contact_at=MAX(COALESCE(last_customer_contact_at,''), ?), updated_at=? WHERE id=?", args: [date + "T12:00:00.000Z", nowISO(), id] },
    act(id, s(x.me?.id) || null, "meeting_logged", { date }),
  ];
  if (str(f, "action_title")) {
    const due = isDate(str(f, "action_due")) ? str(f, "action_due") : null;
    if (!due) return back(c, accPath(id, "overview", "log"), "The follow-up action needs a due date.");
    st.push({ sql: "INSERT INTO cc2_tasks(id,account_id,title,type,owner_id,due_date,status,committed,created_by,created_at,updated_at) VALUES (?,?,?,'action',?,?,'open',0,?,?,?)", args: [uuid(), id, str(f, "action_title"), nul(f, "action_owner") ?? s(a.owner_id), due, s(x.me?.id) || null, nowISO(), nowISO()] });
  }
  await d.tx(st);
  return back(c, accPath(id, "overview"), undefined, true);
});

// Tasks: actions, milestones, measurement tasks. Committed requires a due date.
app.post("/accounts/:id/tasks", async (c) => {
  const x = await ctx(c), id = c.req.param("id"), f = await c.req.parseBody() as Body;
  const a = await loadAccount(d, id); if (!a) return c.notFound();
  const type = ["action", "milestone", "measurement"].includes(str(f, "type")) ? str(f, "type") : "action";
  const tab = type === "action" ? "overview" : "delivery";
  if (!str(f, "title")) return back(c, accPath(id, tab, "add-action"), "An action needs a title.");
  const due = str(f, "due_date"); if (due && !isDate(due)) return back(c, accPath(id, tab, "add-action"), "Due date must be YYYY-MM-DD.");
  const committed = type === "milestone" ? (str(f, "committed") === "0" ? 0 : 1) : (str(f, "committed") ? 1 : 0);
  if (committed && !due) return back(c, accPath(id, tab, "add-action"), "A customer commitment needs a due date.");
  const owner = str(f, "owner_id") && x.users.some((u) => u.id === str(f, "owner_id")) ? str(f, "owner_id") : s(a.owner_id);
  await d.tx([
    { sql: "INSERT INTO cc2_tasks(id,account_id,title,type,owner_id,due_date,status,committed,required,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,'open',?,?,?,?,?)", args: [uuid(), id, str(f, "title"), type, owner, due || null, committed, type === "milestone" ? (str(f, "required") === "0" ? 0 : 1) : 0, s(x.me?.id) || null, nowISO(), nowISO()] },
    act(id, s(x.me?.id) || null, "task_created", { type, title: str(f, "title"), committed }),
  ]);
  return back(c, accPath(id, tab), undefined, true);
});
app.post("/tasks/:id/done", async (c) => {
  const x = await ctx(c), id = c.req.param("id"), f = await c.req.parseBody() as Body;
  const t = await d.get("SELECT * FROM cc2_tasks WHERE id=?", [id]); if (!t) return c.notFound();
  const ret = str(f, "return") || accPath(s(t.account_id));
  if (t.type === "review") return back(c, `/reviews/${t.subject_id}`, "Reviews are resolved with a decision, not a checkbox.");
  if (t.type === "handoff") return back(c, `/accounts/${t.account_id}/handoff`, "Handoffs are accepted on the handoff page.");
  if (versionMismatch(t, f)) return back(c, ret, "This task changed since you loaded the page. Reload and retry.");
  await d.tx([{ sql: "UPDATE cc2_tasks SET status='done', done_at=?, updated_at=?, version=version+1 WHERE id=? AND status='open'", args: [nowISO(), nowISO(), id] }, act(s(t.account_id), s(x.me?.id) || null, "task_completed", { title: t.title, type: t.type })]);
  return back(c, ret, undefined, true);
});
app.post("/tasks/:id/edit", async (c) => {
  const x = await ctx(c), id = c.req.param("id"), f = await c.req.parseBody() as Body;
  const t = await d.get("SELECT * FROM cc2_tasks WHERE id=?", [id]); if (!t) return c.notFound();
  const ret = accPath(s(t.account_id), t.type === "action" ? "overview" : "delivery");
  if (versionMismatch(t, f)) return back(c, ret, "This task changed since you loaded the page. Reload and retry.");
  const due = str(f, "due_date"); if (due && !isDate(due)) return back(c, ret, "Due date must be YYYY-MM-DD.");
  const committed = str(f, "committed") ? 1 : 0; if (committed && !due) return back(c, ret, "A customer commitment needs a due date.");
  const title = str(f, "title") || s(t.title);
  const owner = str(f, "owner_id") && x.users.some((u) => u.id === str(f, "owner_id")) ? str(f, "owner_id") : s(t.owner_id) || null;
  await d.tx([{ sql: "UPDATE cc2_tasks SET title=?, owner_id=?, due_date=?, committed=?, required=?, updated_at=?, version=version+1 WHERE id=?", args: [title, owner, due || null, committed, t.type === "milestone" ? (str(f, "required") ? 1 : 0) : 0, nowISO(), id] }, act(s(t.account_id), s(x.me?.id) || null, "task_edited", { title })]);
  return back(c, ret, undefined, true);
});
app.post("/accounts/:id/blockers", async (c) => {
  const x = await ctx(c), id = c.req.param("id"), f = await c.req.parseBody() as Body;
  const a = await loadAccount(d, id); if (!a) return c.notFound();
  if (!str(f, "description")) return back(c, accPath(id, "delivery"), "A blocker needs a description.");
  await d.tx([{ sql: "INSERT INTO cc2_blockers(id,account_id,description,owner_id,opened_at) VALUES (?,?,?,?,?)", args: [uuid(), id, str(f, "description"), nul(f, "owner_id") ?? s(a.technical_owner_id || a.owner_id), nowISO()] }, act(id, s(x.me?.id) || null, "blocker_opened", { description: str(f, "description") })]);
  return back(c, accPath(id, "delivery"), undefined, true);
});
app.post("/blockers/:id/resolve", async (c) => {
  const x = await ctx(c), id = c.req.param("id"), f = await c.req.parseBody() as Body;
  const b = await d.get("SELECT * FROM cc2_blockers WHERE id=?", [id]); if (!b) return c.notFound();
  await d.tx([{ sql: "UPDATE cc2_blockers SET resolved_at=?, resolution=? WHERE id=? AND resolved_at IS NULL", args: [nowISO(), nul(f, "resolution"), id] }, act(s(b.account_id), s(x.me?.id) || null, "blocker_resolved", { description: b.description })]);
  return back(c, accPath(s(b.account_id), "delivery"), undefined, true);
});

// Proposal revisions are immutable; editing creates the next revision and reopens affected reviews.
const MATERIAL = ["deliverables", "exclusions", "price_terms", "dates", "customer_responsibilities", "success_metric", "success_unit", "success_direction", "success_target", "success_basis"];
app.post("/accounts/:id/proposals", async (c) => {
  const x = await ctx(c), id = c.req.param("id"), f = await c.req.parseBody() as Body;
  const r = await loadEval(id, x.users); if (!r) return c.notFound();
  const prev = latest(r.rel.proposals);
  const handling = { activities: arr(f, "h_activities"), external_processors: str(f, "h_processors") ? str(f, "h_processors").split(",").map((t) => t.trim()).filter(Boolean) : [], external_processing: str(f, "h_external") || undefined, retention: str(f, "h_retention") || undefined, retention_note: str(f, "h_retention_note") || undefined, training_use: str(f, "h_training") || undefined };
  if (handling.external_processors.length && handling.external_processing !== "yes") handling.external_processing = "yes";
  const vals: Record<string, Arg> = {};
  for (const k of MATERIAL) vals[k] = k === "success_target" ? num(f, k) : nul(f, k);
  if (!vals.deliverables) return back(c, accPath(id, "scope", "proposal"), "A proposal needs deliverables.");
  if (!vals.success_metric) return back(c, accPath(id, "scope", "proposal"), "A proposal needs a success criterion (metric and target).");
  const changedMaterial = prev ? MATERIAL.filter((k) => s(prev[k]) !== s(vals[k])) : MATERIAL;
  const handlingChanged = !prev || JSON.stringify(handlingOf(prev)) !== JSON.stringify(JSON.parse(JSON.stringify(handling)));
  const sharedAt = str(f, "shared") ? (isDate(str(f, "shared_at")) ? str(f, "shared_at") : x.today) : (prev && !changedMaterial.length && !handlingChanged ? s(prev.shared_at) || null : null);
  const waived = nul(f, "validation_waived_reason");
  if (prev && !changedMaterial.length && !handlingChanged && s(prev.shared_at) === s(sharedAt) && s(prev.validation_waived_reason) === s(waived)) return back(c, accPath(id, "scope"), "Nothing changed; no new revision created.");
  const rev = prev ? Number(prev.revision) + 1 : 1, pid = uuid();
  const st: Stmt[] = [
    { sql: `INSERT INTO cc2_proposals(id,account_id,revision,${MATERIAL.join(",")},handling,shared_at,validation_waived_reason,change_note,created_by,created_at) VALUES (?,?,?,${MATERIAL.map(() => "?").join(",")},?,?,?,?,?,?)`, args: [pid, id, rev, ...MATERIAL.map((k) => vals[k]), JSON.stringify(handling), sharedAt, waived, nul(f, "change_note"), s(x.me?.id) || null, nowISO()] },
    act(id, s(x.me?.id) || null, "proposal_revised", { revision: rev, changed: changedMaterial, handling_changed: handlingChanged, change_note: str(f, "change_note") }),
  ];
  // material change -> reopen applicable reviews, bound to the new revision
  const scopeChanged = changedMaterial.some((k) => ["deliverables", "exclusions", "success_metric", "success_basis"].includes(k));
  if (prev && (scopeChanged || handlingChanged)) {
    const rel2: Related = { ...r.rel, proposals: [{ id: pid, revision: rev } as Row, ...r.rel.proposals] };
    const reason = handlingChanged ? `data handling changed in rev ${rev}${handling.external_processors.length ? ` (${handling.external_processors.join(", ")})` : ""}` : `scope changed in rev ${rev}`;
    for (const kind of ["technical_validation", "data_handling"]) {
      const existing = r.rel.reviews.find((v) => v.kind === kind);
      if (!existing) continue;
      if (kind === "data_handling" && !handlingChanged && !scopeChanged) continue;
      st.push(...await requestReview(r.a, rel2, kind, "", null, s(x.me?.id) || null, reason, x.today));
    }
  }
  await d.tx(st);
  return back(c, accPath(id, "scope"), undefined, true);
});
app.post("/accounts/:id/requirements", async (c) => {
  const x = await ctx(c), id = c.req.param("id"), f = await c.req.parseBody() as Body;
  const r = await loadEval(id, x.users); if (!r) return c.notFound();
  const prev = latest(r.rel.requirements);
  const status = ["unknown", "none_stated", "specified"].includes(str(f, "restriction_status")) ? str(f, "restriction_status") : "unknown";
  const vals = status === "specified"
    ? { wording: nul(f, "wording"), activities: JSON.stringify(arr(f, "activities")), external_processing: str(f, "external_processing") || "unknown", retention: str(f, "retention") || "unknown", retention_note: nul(f, "retention_note"), training_use: str(f, "training_use") || "unknown", evidence_note: nul(f, "evidence_note") }
    : { wording: null, activities: "[]", external_processing: null, retention: null, retention_note: null, training_use: null, evidence_note: nul(f, "evidence_note") };
  if (status === "specified" && !vals.wording) return back(c, accPath(id, "scope", "requirements"), "Specified restrictions need the customer's exact wording.");
  if (prev && prev.restriction_status === status && ["wording", "activities", "external_processing", "retention", "retention_note", "training_use", "evidence_note"].every((k) => s(prev[k]) === s((vals as Record<string, Arg>)[k]))) return back(c, accPath(id, "scope"), "Nothing changed; no new revision created.");
  const rev = prev ? Number(prev.revision) + 1 : 1, rid = uuid();
  const st: Stmt[] = [
    { sql: "INSERT INTO cc2_requirements(id,account_id,revision,restriction_status,wording,activities,external_processing,retention,retention_note,training_use,evidence_note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", args: [rid, id, rev, status, vals.wording, vals.activities, vals.external_processing, vals.retention, vals.retention_note, vals.training_use, vals.evidence_note, s(x.me?.id) || null, nowISO()] },
    act(id, s(x.me?.id) || null, "requirements_revised", { revision: rev, status }),
  ];
  if (status === "specified" && r.rel.proposals.length) {
    const rel2: Related = { ...r.rel, requirements: [{ id: rid, revision: rev, restriction_status: status, ...vals } as Row, ...r.rel.requirements] };
    st.push(...await requestReview(r.a, rel2, "data_handling", `Customer restrictions revised (rev ${rev}). Does the proposed handling still comply?`, null, s(x.me?.id) || null, prev ? `customer restrictions changed in rev ${rev}` : null, x.today));
  }
  await d.tx(st);
  return back(c, accPath(id, "scope"), undefined, true);
});

// Reviews
app.post("/accounts/:id/reviews", async (c) => {
  const x = await ctx(c), id = c.req.param("id"), f = await c.req.parseBody() as Body;
  const r = await loadEval(id, x.users); if (!r) return c.notFound();
  const kind = Object.keys(REVIEW_KINDS).includes(str(f, "kind")) ? str(f, "kind") : "technical_validation";
  if (!r.rel.proposals.length && ["technical_validation", "data_handling"].includes(kind)) return back(c, accPath(id, "scope"), "Draft a proposal revision first; reviews bind to a revision.");
  const reviewer = str(f, "reviewer_id") && x.users.some((u) => u.id === str(f, "reviewer_id")) ? str(f, "reviewer_id") : null;
  await d.tx(await requestReview(r.a, r.rel, kind, str(f, "question"), reviewer, s(x.me?.id) || null, null, x.today));
  return back(c, accPath(id, "scope"), undefined, true);
});
app.get("/reviews/:id", async (c) => {
  const x = await ctx(c), id = c.req.param("id");
  const rv = await d.get("SELECT r.*, u.name AS reviewer_name FROM cc2_reviews r LEFT JOIN cc2_users u ON u.id=r.reviewer_id WHERE r.id=?", [id]); if (!rv) return page(c, x, "Not found", V.notFound(), 404);
  const r = await loadEval(s(rv.account_id), x.users); if (!r) return c.notFound();
  return page(c, x, "Review", V.reviewPanel(rv, r.a, r.rel, r.ev, x));
});
app.post("/reviews/:id/decide", async (c) => {
  const x = await ctx(c), id = c.req.param("id"), f = await c.req.parseBody() as Body;
  const rv = await d.get("SELECT * FROM cc2_reviews WHERE id=?", [id]); if (!rv) return c.notFound();
  if (versionMismatch(rv, f)) return back(c, `/reviews/${id}`, "This review changed since you opened it (another decision or a reopen). Reload and retry.");
  if (rv.status !== "open") return back(c, `/reviews/${id}`, "This review is not open.");
  const status = ["approved", "conditional", "blocked"].includes(str(f, "status")) ? str(f, "status") : "";
  if (!status) return back(c, `/reviews/${id}`, "Choose Approved, Approved with conditions, or Blocked.");
  if (!str(f, "decision_note")) return back(c, `/reviews/${id}`, "Add a short explanation.");
  const conds = str(f, "conditions").split("\n").map((t) => t.trim()).filter(Boolean).map((text) => ({ text, done: false }));
  if (status === "conditional" && !conds.length) return back(c, `/reviews/${id}`, "Conditional approval needs at least one condition.");
  const r = await loadEval(s(rv.account_id), x.users);
  const p = latest(r!.rel.proposals), req = latest(r!.rel.requirements);
  await d.tx([
    { sql: "UPDATE cc2_reviews SET status=?, conditions=?, decision_note=?, decided_at=?, proposal_id=?, requirements_id=?, reviewer_id=COALESCE(reviewer_id, ?), version=version+1 WHERE id=?", args: [status, JSON.stringify(conds), str(f, "decision_note"), nowISO(), s(p?.id) || null, s(req?.id) || null, s(x.me?.id) || null, id] },
    closeTask("review", id),
    act(s(rv.account_id), s(x.me?.id) || null, "review_decided", { kind: rv.kind, status, note: str(f, "decision_note") }),
  ]);
  return back(c, accPath(s(rv.account_id), "scope"), undefined, true);
});
app.post("/reviews/:id/conditions", async (c) => {
  const x = await ctx(c), id = c.req.param("id"), f = await c.req.parseBody() as Body;
  const rv = await d.get("SELECT * FROM cc2_reviews WHERE id=?", [id]); if (!rv) return c.notFound();
  if (s(rv.reviewer_id) && s(rv.reviewer_id) !== s(x.me?.id)) return back(c, `/reviews/${id}`, "Only the reviewer can check off conditions.");
  const conds = JSON.parse(s(rv.conditions) || "[]") as { text: string; done: boolean }[];
  const done = new Set(arr(f, "done").map(Number));
  conds.forEach((cd, i) => cd.done = done.has(i));
  await d.tx([{ sql: "UPDATE cc2_reviews SET conditions=?, version=version+1 WHERE id=?", args: [JSON.stringify(conds), id] }, act(s(rv.account_id), s(x.me?.id) || null, "conditions_updated", { done: conds.filter((cd) => cd.done).length, total: conds.length })]);
  return back(c, `/reviews/${id}`, undefined, true);
});

// Stage changes: forward one step only and server-validated; backward presales with a reason; lost with a reason.
app.post("/accounts/:id/stage", async (c) => {
  const x = await ctx(c), id = c.req.param("id"), f = await c.req.parseBody() as Body;
  const r = await loadEval(id, x.users); if (!r) return c.notFound();
  const { a, rel } = r;
  if (versionMismatch(a, f)) return back(c, accPath(id), "This account changed since you opened it. Reload and retry.");
  const to = str(f, "to"), reason = str(f, "reason"), by = s(x.me?.id) || null;
  const presales = ["discovery", "proposal", "negotiation"];
  if (to === "lost") {
    if (!isPresales(a)) return back(c, accPath(id), "Only presales accounts can be marked lost.");
    if (!reason) return back(c, accPath(id), "Lost needs a reason.");
    await d.tx([{ sql: "UPDATE cc2_accounts SET sales_stage='lost', lost_reason=?, version=version+1, updated_at=? WHERE id=?", args: [reason, nowISO(), id] }, act(id, by, "stage_changed", { from: a.sales_stage, to: "lost", reason })]);
    return back(c, accPath(id), undefined, true);
  }
  if (presales.includes(to) && presales.includes(s(a.sales_stage)) && presales.indexOf(to) < presales.indexOf(s(a.sales_stage))) {
    if (!reason) return back(c, accPath(id), "Moving backward needs a reason.");
    await d.tx([{ sql: "UPDATE cc2_accounts SET sales_stage=?, version=version+1, updated_at=? WHERE id=?", args: [to, nowISO(), id] }, act(id, by, "stage_changed", { from: a.sales_stage, to, reason })]);
    return back(c, accPath(id), undefined, true);
  }
  const ready = readinessFor(a, rel, x.today);
  if (to !== ready.to) return back(c, accPath(id), `From ${STAGE_LABEL[ready.from]} the only forward step is ${ready.toLabel ?? "none"}; stage skipping is rejected.`);
  if (ready.via !== "advance") return back(c, accPath(id), ready.via === "confirm_agreement" ? "Won is recorded through Confirm agreement, not a dropdown." : "Use End engagement.");
  const missing = ready.items.filter((i) => !i.ok);
  if (missing.length) return back(c, accPath(id), `Not ready for ${ready.toLabel}: ${missing.map((m) => m.label + (m.hint ? ` (${m.hint})` : "")).join("; ")}`);
  const st: Stmt[] = presales.includes(to)
    ? [{ sql: "UPDATE cc2_accounts SET sales_stage=?, version=version+1, updated_at=? WHERE id=?", args: [to, nowISO(), id] }]
    : [{ sql: "UPDATE cc2_accounts SET delivery_status=?, version=version+1, updated_at=? WHERE id=?", args: [to, nowISO(), id] }];
  st.push(act(id, by, "stage_changed", { from: ready.from, to }));
  await d.tx(st);
  return back(c, accPath(id), undefined, true);
});
app.post("/accounts/:id/end", async (c) => {
  const x = await ctx(c), id = c.req.param("id"), f = await c.req.parseBody() as Body;
  const a = await loadAccount(d, id); if (!a) return c.notFound();
  if (!a.delivery_status || a.delivery_status === "ended") return back(c, accPath(id), "Only won engagements can be ended.");
  if (!str(f, "reason")) return back(c, accPath(id, "delivery"), "Ending needs an outcome/reason.");
  const date = isDate(str(f, "ended_at")) ? str(f, "ended_at") : x.today;
  await d.tx([{ sql: "UPDATE cc2_accounts SET delivery_status='ended', end_reason=?, ended_at=?, version=version+1, updated_at=? WHERE id=?", args: [str(f, "reason"), date, nowISO(), id] }, act(id, s(x.me?.id) || null, "engagement_ended", { reason: str(f, "reason"), date })]);
  return back(c, accPath(id, "delivery"), undefined, true);
});

// Confirm agreement (or accept amendment): one transaction snapshots the proposal, marks won, creates handoff + acceptance task.
app.post("/accounts/:id/agreements", async (c) => {
  const x = await ctx(c), id = c.req.param("id"), f = await c.req.parseBody() as Body;
  const r = await loadEval(id, x.users); if (!r) return c.notFound();
  const { a, rel } = r, by = s(x.me?.id) || null;
  if (versionMismatch(a, f)) return back(c, accPath(id, "scope"), "This account changed since you opened it. Reload and retry.");
  const p = latest(rel.proposals), req = latest(rel.requirements);
  if (!p) return back(c, accPath(id, "scope"), "No proposal revision to accept.");
  if (!str(f, "evidence")) return back(c, accPath(id, "scope", "confirm"), "Acceptance needs a note or document link. A typed note is recorded as a claim, not verified acceptance.");
  const date = isDate(str(f, "accepted_at")) ? str(f, "accepted_at") : x.today;
  const amendment = !!a.current_agreement_id;
  if (!amendment && a.sales_stage !== "negotiation") return back(c, accPath(id, "scope"), "Agreements are confirmed from Negotiation.");
  if (rel.agreements.some((g) => g.proposal_id === p.id)) return back(c, accPath(id, "scope"), `Proposal rev ${p.revision} is already the accepted agreement.`);
  const ready = readinessFor({ ...a, sales_stage: "negotiation" }, rel, x.today);
  const missing = ready.items.filter((i) => !i.ok && !/Acceptance evidence/.test(i.label));
  if (missing.length) return back(c, accPath(id, "scope"), `Cannot confirm: ${missing.map((m) => m.label + (m.hint ? ` (${m.hint})` : "")).join("; ")}`);
  const gid = uuid(), hid = uuid();
  const st: Stmt[] = [
    { sql: "INSERT INTO cc2_agreements(id,account_id,proposal_id,requirements_id,accepted_by,accepted_at,acceptance_evidence,supersedes_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)", args: [gid, id, s(p.id), s(req?.id) || null, by, date + "T12:00:00.000Z", str(f, "evidence"), s(a.current_agreement_id) || null, nowISO()] },
    { sql: "UPDATE cc2_accounts SET current_agreement_id=?, sales_stage='won', delivery_status=COALESCE(delivery_status,'onboarding_pending'), version=version+1, updated_at=? WHERE id=?", args: [gid, nowISO(), id] },
    { sql: "INSERT INTO cc2_handoffs(id,account_id,agreement_id,created_at,stale_reason) VALUES (?,?,?,?,?)", args: [hid, id, gid, nowISO(), amendment ? `amendment accepted (rev ${p.revision}); milestones may need adjustment` : null] },
    ...await ensureTask(id, "handoff", hid, { title: `Accept handoff: ${a.name}${amendment ? ` (amendment rev ${p.revision})` : ""}`, type: "handoff", owner_id: s(a.technical_owner_id) || null, due_date: addDaysISO(x.today, 5), created_by: by }),
    act(id, by, amendment ? "amendment_accepted" : "agreement_confirmed", { revision: p.revision, evidence: str(f, "evidence") }),
  ];
  if (!rel.outcome) st.push({ sql: "INSERT INTO cc2_outcomes(id,account_id,agreement_id,metric,unit,direction,target,updated_at) VALUES (?,?,?,?,?,?,?,?)", args: [uuid(), id, gid, s(p.success_metric), s(p.success_unit) || null, s(p.success_direction) || "higher", p.success_target as Arg, nowISO()] });
  else st.push({ sql: "UPDATE cc2_outcomes SET agreement_id=?, metric=?, unit=?, direction=?, target=?, version=version+1, updated_at=? WHERE account_id=?", args: [gid, s(p.success_metric), s(p.success_unit) || null, s(p.success_direction) || "higher", p.success_target as Arg, nowISO(), id] });
  if (amendment) st.push({ sql: "UPDATE cc2_handoffs SET stale_reason=COALESCE(stale_reason,'superseded') WHERE account_id=? AND agreement_id<>?", args: [id, gid] });
  try { await d.tx(st); } catch (e) { if (/UNIQUE/.test(String(e))) return back(c, accPath(id, "scope"), "This revision was already confirmed (double submit ignored)."); throw e; }
  return back(c, `/accounts/${id}/handoff`, undefined, true);
});
app.get("/accounts/:id/handoff", async (c) => {
  const x = await ctx(c), id = c.req.param("id");
  const r = await loadEval(id, x.users); if (!r) return page(c, x, "Not found", V.notFound(), 404);
  return page(c, x, "Handoff", V.handoffPage(r.a, r.rel, r.ev, x));
});
app.post("/handoffs/:id/accept", async (c) => {
  const x = await ctx(c), id = c.req.param("id"), f = await c.req.parseBody() as Body;
  const h = await d.get("SELECT * FROM cc2_handoffs WHERE id=?", [id]); if (!h) return c.notFound();
  const a = await loadAccount(d, s(h.account_id)); if (!a) return c.notFound();
  if (!a.technical_owner_id) return back(c, `/accounts/${a.id}/handoff`, "Assign a technical owner first; only they can accept.");
  if (s(x.me?.id) !== s(a.technical_owner_id)) return back(c, `/accounts/${a.id}/handoff`, `Only the technical owner (${a.technical_owner_name}) can accept this handoff. Switch identity top-right if that is you.`);
  await d.tx([{ sql: "UPDATE cc2_handoffs SET accepted_by=?, accepted_at=?, acceptance_note=?, stale_reason=NULL WHERE id=?", args: [s(x.me?.id), nowISO(), nul(f, "note"), id] }, closeTask("handoff", id), act(s(a.id), s(x.me?.id), "handoff_accepted", { note: str(f, "note") })]);
  return back(c, accPath(s(a.id), "delivery"), undefined, true);
});

// Outcome: NULL means unknown. Changing the basis makes the comparison non-comparable until a baseline on the same basis exists.
app.post("/accounts/:id/outcome", async (c) => {
  const x = await ctx(c), id = c.req.param("id"), f = await c.req.parseBody() as Body;
  const a = await loadAccount(d, id); if (!a) return c.notFound();
  const o = await d.get("SELECT * FROM cc2_outcomes WHERE account_id=?", [id]);
  if (o && versionMismatch(o, f)) return back(c, accPath(id, "delivery"), "The outcome record changed since you opened it. Reload and retry.");
  const metric = str(f, "metric") || s(o?.metric); if (!metric) return back(c, accPath(id, "delivery"), "Name the success metric.");
  for (const k of ["baseline", "target", "latest"]) if (str(f, k) && num(f, k) == null) return back(c, accPath(id, "delivery"), `${k} must be a number (leave blank if unknown).`);
  const latestV = num(f, "latest"), measured = isDate(str(f, "measured_at")) ? str(f, "measured_at") : (latestV != null ? x.today : null);
  const vals: Arg[] = [metric, nul(f, "unit"), str(f, "direction") === "lower" ? "lower" : "higher", num(f, "baseline"), nul(f, "baseline_basis"), num(f, "target"), latestV, latestV != null ? nul(f, "latest_basis") : null, measured, latestV == null ? nul(f, "not_measured_reason") : null];
  const st: Stmt[] = o
    ? [{ sql: "UPDATE cc2_outcomes SET metric=?, unit=?, direction=?, baseline=?, baseline_basis=?, target=?, latest=?, latest_basis=?, measured_at=?, not_measured_reason=?, version=version+1, updated_at=? WHERE account_id=?", args: [...vals, nowISO(), id] }]
    : [{ sql: "INSERT INTO cc2_outcomes(id,account_id,agreement_id,metric,unit,direction,baseline,baseline_basis,target,latest,latest_basis,measured_at,not_measured_reason,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", args: [uuid(), id, s(a.current_agreement_id) || null, ...vals, nowISO()] }];
  if (latestV != null) st.push(closeTask("measurement", id));
  st.push(act(id, s(x.me?.id) || null, "outcome_recorded", { latest: latestV, basis: str(f, "latest_basis") }));
  await d.tx(st);
  return back(c, accPath(id, "delivery"), undefined, true);
});

// Reset shared data to the seed; asks for the passcode again so it is not one click from wiping shared data.
app.post("/admin/reseed", async (c) => {
  const f = await c.req.parseBody() as Body;
  if (str(f, "passcode") !== PASSCODE) return c.text("wrong passcode", 401);
  await seed(d, { force: true });
  return c.redirect("/?saved=1");
});
app.notFound(async (c) => { const x = await ctx(c); return page(c, x, "Not found", V.notFound(), 404); });
app.onError((e, c) => { console.error(e); return c.text("Something went wrong on the server: " + e.message, 500); });

if (import.meta.main) Deno.serve({ port: Number(Deno.env.get("PORT") ?? 8010) }, app.fetch);
export default app.fetch;
