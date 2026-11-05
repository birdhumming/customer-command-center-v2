// Acceptance tests from the spec, run against app.fetch with a throwaway DB.
Deno.env.set("CCC_DB", "/tmp/ccc2_test.sqlite");
try { Deno.removeSync("/tmp/ccc2_test.sqlite"); } catch { /* fresh */ }
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { addDays } from "./rules.ts";
const fetchApp = (await import("./main.ts")).default;
const { db } = await import("./db.ts");
const d = await db();
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const login = await fetchApp(new Request("http://x/login", { method: "POST", body: new URLSearchParams({ passcode: "evalhouse" }) }));
const cookie = login.headers.get("set-cookie")!.split(";")[0];
const users = await d.all("SELECT * FROM cc2_users ORDER BY name"); // Leo, Maya, Priya
const U = Object.fromEntries(users.map((u) => [String(u.name).split(" ")[0], String(u.id)]));
async function post(path: string, body: Record<string, string>, me = U.Maya) {
  const r = await fetchApp(new Request("http://x" + path, { method: "POST", headers: { cookie: `${cookie}; ccc2_me=${me}` }, body: new URLSearchParams(body), redirect: "manual" }));
  return { status: r.status, loc: r.headers.get("location") ?? "", err: decodeURIComponent((r.headers.get("location") ?? "").split("err=")[1] ?? ""), text: r.status !== 302 ? await r.text() : "" };
}
const get = async (path: string, me = U.Maya) => { const r = await fetchApp(new Request("http://x" + path, { headers: { cookie: `${cookie}; ccc2_me=${me}` } })); return { status: r.status, text: await r.text() }; };
const stage = async (id: string, to: string, me = U.Maya, extra: Record<string, string> = {}) => { const a = (await d.get("SELECT version FROM cc2_accounts WHERE id=?", [id]))!; return post(`/accounts/${id}/stage`, { to, version: String(a.version), ...extra }, me); };
const acc = async (name: string) => (await d.get("SELECT * FROM cc2_accounts WHERE name=?", [name]))! as Record<string, string>;

Deno.test("1 create persists; new account starts in Discovery owned by me", async () => {
  const r = await post("/accounts", { name: "Halden Health", owner_id: U.Maya, problem: "Prior-auth agent approves out-of-network claims." });
  assertEquals(r.status, 302);
  const a = await acc("Halden Health"); assertEquals(a.sales_stage, "discovery");
  const bad = await post("/accounts", { name: "", owner_id: U.Maya }); assertEquals(bad.status, 400); assertMatch(bad.text, /Account name is required/);
});
Deno.test("2 owner filter: Leo sees his review task on Maya's account; Maya does not", async () => {
  const leo = await get("/?owner=" + U.Leo); assertMatch(leo.text, /Data review: Northstar/);
  const maya = await get("/?owner=" + U.Maya); assert(!/Data review: Northstar/.test(maya.text));
});
Deno.test("3 meeting + action save together; contact date moves", async () => {
  const a = await acc("Halden Health");
  const r = await post(`/accounts/${a.id}/meetings`, { date: today, summary: "Intro with counsel (OOO until the 14th)", action_title: "Send DPA redlines", action_owner: U.Maya, action_due: today });
  assertEquals(r.status, 302);
  assertEquals(Number((await d.get("SELECT COUNT(*) c FROM cc2_tasks WHERE account_id=? AND title='Send DPA redlines'", [a.id]))!.c), 1);
  const bad = await post(`/accounts/${a.id}/meetings`, { summary: "x", action_title: "no date" }); assertMatch(bad.err, /due date/);
  assertEquals(Number((await d.get("SELECT COUNT(*) c FROM cc2_meetings WHERE account_id=? AND summary='x'", [a.id]))!.c), 0, "nothing saved on failure");
});
Deno.test("4 stage change fails server-side with the missing list; skipping rejected", async () => {
  const a = await acc("Halden Health");
  let r = await post(`/accounts/${a.id}/stage`, { to: "proposal", version: String(a.version) }); assertMatch(r.err, /Not ready for Proposal: .*Customer contact/);
  r = await stage(a.id, "negotiation"); assertMatch(r.err, /skipping is rejected/);
  r = await stage(a.id, "won"); assertMatch(r.err, /skipping is rejected|Confirm agreement/);
  assertEquals((await acc("Halden Health")).sales_stage, "discovery");
});
Deno.test("5+6 proposed edit after agreement leaves agreement intact and reopens the data review", async () => {
  const hb = await acc("Harbor Operations");
  const before = await d.get("SELECT * FROM cc2_agreements WHERE id=?", [hb.current_agreement_id]);
  const p = (await d.get("SELECT * FROM cc2_proposals WHERE account_id=? ORDER BY revision DESC", [hb.id]))! as Record<string, string>;
  const r = await post(`/accounts/${hb.id}/proposals`, { deliverables: String(p.deliverables), price_terms: String(p.price_terms), success_metric: String(p.success_metric), success_target: String(p.success_target), success_unit: "%", success_direction: "lower", success_basis: String(p.success_basis), h_external: "yes", h_processors: "OpenAI grader", h_retention: "custom", h_retention_note: "30d", h_training: "no", "h_activities[]": "grading", change_note: "Lattice-style: add an external grader after signature" }, U.Priya);
  assertEquals(r.status, 302, r.err);
  const after = await d.get("SELECT * FROM cc2_agreements WHERE id=?", [hb.current_agreement_id]);
  assertEquals(after!.proposal_id, before!.proposal_id, "agreement still points at rev 1");
  const rv = (await d.get("SELECT * FROM cc2_reviews WHERE account_id=? AND kind='data_handling'", [hb.id]))! as Record<string, string>;
  assertEquals(rv.status, "open"); assertMatch(String(rv.reopened_reason), /data handling changed in rev 2/);
  const tasks = await d.all("SELECT * FROM cc2_tasks WHERE account_id=? AND automation_key='review' AND subject_id=?", [hb.id, String(rv.id)]); assertEquals(tasks.length, 1); assertEquals(tasks[0].status, "open");
  const page = await get(`/accounts/${hb.id}?tab=scope`); assertMatch(page.text, /Proposed change requires review/); assertMatch(page.text, /remains operative/);
  // Advancing delivery is blocked while the review is stale; the agreement itself is not flagged (rev 1 had no external processor)
  const adv = await stage(hb.id, "delivery", U.Priya); assertMatch(adv.err, /Not ready for Delivery/);
  assert(!/Current agreement needs review/.test(page.text));
});
Deno.test("7 confirming agreement twice yields one agreement, one handoff, one acceptance task", async () => {
  const at = await acc("Atlas Commerce");
  const leoRv = (await d.get("SELECT * FROM cc2_reviews WHERE account_id=? AND kind='data_handling' AND status='open'", [at.id]))! as Record<string, string>;
  // Leo decides; Leo must also re-validate technically (stale for rev 2)
  let r = await post(`/reviews/${leoRv.id}/decide`, { status: "conditional", conditions: "Anthropic added to DPA subprocessor list", decision_note: "OK once the DPA annex is updated", version: String(leoRv.version) }, U.Leo); assertEquals(r.status, 302, r.err);
  r = await post(`/accounts/${at.id}/agreements`, { evidence: "Order form AC-11", version: String(at.version) }); assertMatch(r.err, /Cannot confirm/); // conditions unchecked + stale validation
  await post(`/reviews/${leoRv.id}/conditions`, { "done[]": "0" }, U.Leo);
  await post(`/accounts/${at.id}/reviews`, { kind: "technical_validation", reviewer_id: U.Leo, question: "re-validate rev 2" });
  const tv = (await d.get("SELECT * FROM cc2_reviews WHERE account_id=? AND kind='technical_validation'", [at.id]))! as Record<string, string>;
  await post(`/reviews/${tv.id}/decide`, { status: "approved", decision_note: "fine", version: String(tv.version) }, U.Leo);
  const a2 = await acc("Atlas Commerce");
  const [r1, r2] = await Promise.all([post(`/accounts/${at.id}/agreements`, { evidence: "Order form AC-11", version: String(a2.version) }), post(`/accounts/${at.id}/agreements`, { evidence: "Order form AC-11", version: String(a2.version) })]);
  assert([r1, r2].some((x) => x.loc.includes("/handoff")), r1.err + r2.err);
  assertEquals(Number((await d.get("SELECT COUNT(*) c FROM cc2_agreements WHERE account_id=?", [at.id]))!.c), 1);
  assertEquals(Number((await d.get("SELECT COUNT(*) c FROM cc2_handoffs WHERE account_id=?", [at.id]))!.c), 1);
  assertEquals(Number((await d.get("SELECT COUNT(*) c FROM cc2_tasks WHERE account_id=? AND type='handoff'", [at.id]))!.c), 1);
  const a3 = await acc("Atlas Commerce"); assertEquals(a3.sales_stage, "won"); assertEquals(a3.delivery_status, "onboarding_pending");
  const dd = await stage(at.id, "onboarding_pending"); assertMatch(dd.err, /skipping is rejected|only forward step/);
  // handoff: only Leo (technical owner) can accept
  const h = (await d.get("SELECT * FROM cc2_handoffs WHERE account_id=?", [at.id]))! as Record<string, string>;
  assertMatch((await post(`/handoffs/${h.id}/accept`, { note: "x" }, U.Maya)).err, /Only the technical owner/);
  assertEquals((await post(`/handoffs/${h.id}/accept`, { note: "ok" }, U.Leo)).status, 302);
  assertEquals((await d.get("SELECT status FROM cc2_tasks WHERE type='handoff' AND account_id=?", [at.id]))!.status, "done");
});
Deno.test("8 time-based signals appear on refresh without edits (stalled after 14d)", async () => {
  const a = await acc("Halden Health");
  await d.run("UPDATE cc2_accounts SET last_customer_contact_at=? WHERE id=?", ["2020-01-01T00:00:00Z", a.id]);
  const page = await get(`/accounts/${a.id}`); assertMatch(page.text, /No customer contact for \d+d/);
});
Deno.test("9 repeated review requests do not duplicate tasks", async () => {
  const ns = await acc("Northstar Support");
  for (let i = 0; i < 3; i++) await post(`/accounts/${ns.id}/reviews`, { kind: "data_handling", reviewer_id: U.Leo, question: "again" });
  assertEquals(Number((await d.get("SELECT COUNT(*) c FROM cc2_tasks WHERE account_id=? AND automation_key='review'", [ns.id]))!.c), 1);
  assertEquals(Number((await d.get("SELECT COUNT(*) c FROM cc2_reviews WHERE account_id=? AND kind='data_handling'", [ns.id]))!.c), 1);
  // review task cannot be completed via the generic checkbox
  const t = (await d.get("SELECT * FROM cc2_tasks WHERE account_id=? AND automation_key='review'", [ns.id]))! as Record<string, string>;
  assertMatch((await post(`/tasks/${t.id}/done`, {}, U.Leo)).err, /decision, not a checkbox/);
});
Deno.test("10 missing vs zero; changed basis is not comparable; 409-style stale edit", async () => {
  const cd = await acc("Cedar Analytics");
  const o = (await d.get("SELECT * FROM cc2_outcomes WHERE account_id=?", [cd.id]))! as Record<string, string>;
  let r = await post(`/accounts/${cd.id}/outcome`, { metric: String(o.metric), unit: "%", direction: "lower", baseline: "31", baseline_basis: "weekly sample, grader v1", target: "20", latest: "0", latest_basis: "weekly sample, grader v1", version: String(o.version) }, U.Priya); assertEquals(r.status, 302, r.err);
  let page = await get(`/accounts/${cd.id}?tab=delivery`); assertMatch(page.text, /target met/); assertMatch(page.text, /0% vs target 20%/);
  r = await post(`/accounts/${cd.id}/outcome`, { metric: String(o.metric), unit: "%", direction: "lower", baseline: "31", baseline_basis: "weekly sample, grader v1", target: "20", latest: "12", latest_basis: "weekly sample, grader v2", version: String(Number(o.version) + 1) }, U.Priya); assertEquals(r.status, 302, r.err);
  page = await get(`/accounts/${cd.id}?tab=delivery`); assertMatch(page.text, /not comparable/);
  r = await post(`/accounts/${cd.id}/outcome`, { metric: String(o.metric), latest: "", version: String(o.version) }, U.Priya); assertMatch(r.err, /changed since you opened it/);
  r = await post(`/accounts/${cd.id}/outcome`, { metric: String(o.metric), latest: "74%x", version: String(Number(o.version) + 2) }, U.Priya); assertMatch(r.err, /must be a number/);
  // account-level 409 on a stale form
  const stale = await post(`/accounts/${cd.id}/edit/overview`, { contact: "Jon", buyer_status: "named", buyer: "Renata", version: "99" }); assertMatch(stale.err, /Someone else changed/);
});
Deno.test("health: Healthy does not hide automatic warnings; reason required", async () => {
  const md = await acc("Meridian Services");
  assertMatch((await post(`/accounts/${md.id}/edit/health`, { health: "healthy", health_reason: "", version: String(md.version) }, U.Priya)).err, /needs a reason/);
  assertEquals((await post(`/accounts/${md.id}/edit/health`, { health: "healthy", health_reason: "GC said nice things", version: String(md.version) }, U.Priya)).status, 302);
  const page = await get(`/accounts/${md.id}`); assertMatch(page.text, /Healthy/); assertMatch(page.text, /Renewal in \d+d and success not demonstrated/); assertMatch(page.text, /Committed work overdue/);
});
Deno.test("requirements mismatch: specified 'no external processing' vs rev 2 proposal -> critical conflict; current agreement untouched", async () => {
  const hb = await acc("Harbor Operations");
  const page = await get(`/accounts/${hb.id}`); assertMatch(page.text, /Critical/); assertMatch(page.text, /Proposed change requires review/);
  assert(!/Current agreement needs review/.test(page.text));
});

Deno.test("review findings: identity required; only the reviewer decides; sales cannot review", async () => {
  const ns = await acc("Northstar Support");
  const r = await fetchApp(new Request("http://x/accounts/" + ns.id + "/tasks", { method: "POST", headers: { cookie }, body: new URLSearchParams({ title: "anon", due_date: today }), redirect: "manual" }));
  assertEquals(r.status, 403);
  const rv = (await d.get("SELECT * FROM cc2_reviews WHERE account_id=? AND kind='data_handling'", [ns.id]))! as Record<string, string>;
  assertMatch((await post(`/reviews/${rv.id}/decide`, { status: "approved", decision_note: "x", version: String(rv.version) }, U.Priya)).err, /Only the assigned reviewer/);
  assertMatch((await post(`/accounts/${ns.id}/reviews`, { kind: "technical_validation", reviewer_id: U.Maya, question: "self" })).err, /not sales/);
  assertMatch((await post(`/reviews/${rv.id}/decide`, { status: "approved", decision_note: "x" }, U.Leo)).err, /changed since you opened it/);
});
Deno.test("review findings: unknown restrictions are not permission at Won; specified cannot go back to unknown", async () => {
  await post("/accounts", { name: "Caldera Freight", owner_id: U.Maya, problem: "Dispatch agent", contact: "Rosa" });
  const cf = await acc("Caldera Freight");
  await post(`/accounts/${cf.id}/edit/overview`, { contact: "Rosa", buyer_status: "named", buyer: "Rosa", problem: "Dispatch agent", version: String(cf.version) });
  await post(`/accounts/${cf.id}/proposals`, { deliverables: "Eval harness", price_terms: "$40k", success_metric: "Wrong-dispatch rate", success_target: "5", success_unit: "%", success_direction: "lower", h_external: "yes", h_processors: "OpenAI grader", h_retention: "none", h_training: "no", shared: "1" });
  // no requirements recorded at all -> data review is required, Won gate names restrictions
  const page = await get(`/accounts/${cf.id}?tab=scope`); assertMatch(page.text, /Data review not requested/);
  await post(`/accounts/${cf.id}/requirements`, { restriction_status: "specified", wording: "No data leaves our VPC", external_processing: "no", retention: "none", training_use: "no" });
  assertMatch((await post(`/accounts/${cf.id}/requirements`, { restriction_status: "unknown" })).err, /cannot go back to unknown/);
  assertMatch((await post(`/accounts/${cf.id}/requirements`, { restriction_status: "specified", wording: "x", external_processing: "maybe", retention: "forever", training_use: "sometimes" })).err, /only the listed values/);
  assertMatch((await post(`/accounts/${cf.id}/requirements`, { restriction_status: "none_stated" })).err, /evidence note/);
});
Deno.test("review findings: lost accounts are read-only; garbage dates and owners rejected; tab preserved on error", async () => {
  const ns = await acc("Northstar Support");
  assertMatch((await post(`/accounts/${ns.id}/meetings`, { date: "2025-02-30", summary: "x" })).err, /real date/);
  assertMatch((await post(`/accounts/${ns.id}/meetings`, { date: "9999-12-31", summary: "x" })).err, /real date/);
  const b = await post(`/accounts/${ns.id}/blockers`, { description: "x", owner_id: "bogus" }, U.Leo); assertEquals(b.status, 302, b.text.slice(0, 200));
  const m = await post(`/accounts/${ns.id}/meetings`, { summary: "m", action_title: "a", action_due: today, action_owner: "bogus" }); assertEquals(m.status, 302, m.text.slice(0, 200));
  const e = await post(`/accounts/${ns.id}/proposals`, { deliverables: "x" }); assert(e.loc.includes("?tab=scope&err="), e.loc);
  await post("/accounts", { name: "Gone Co", owner_id: U.Maya });
  const g = await acc("Gone Co");
  assertEquals((await stage(g.id, "lost", U.Maya, { reason: "went in-house" })).status, 302);
  assertMatch((await post(`/accounts/${g.id}/edit/health`, { health: "healthy", health_reason: "nope", version: "2" })).err, /read-only/);
  assertMatch((await post(`/accounts/${g.id}/tasks`, { title: "x", due_date: today })).err, /read-only/);
});
Deno.test("review findings: waiting on customer is not stalled; renewal notice period moves the deadline; dropped scope shows in handoff", async () => {
  const hh = await acc("Halden Health");
  const r = await post(`/accounts/${hh.id}/tasks`, { title: "Counsel back from leave; DPA redlines due", due_date: addDays(today, 10), customer_side: "1" }); assertEquals(r.status, 302, r.err);
  let page = await get(`/accounts/${hh.id}`); assertMatch(page.text, /Waiting on customer: Counsel back/); assert(!/No customer contact for/.test(page.text), "stalled suppressed while waiting");
  const md = await acc("Meridian Services");
  await post(`/accounts/${md.id}/edit/renewal`, { renewal_date: addDays(today, 46), renewal_notice_days: "60", expansion_note: "Add refunds queue", version: String(md.version) }, U.Priya);
  page = await get(`/accounts/${md.id}`); assertMatch(page.text, /Renewal notice deadline 14d overdue/); assertMatch(page.text, /Expansion noted with no owned, dated action/);
  const at = await acc("Atlas Commerce");
  page = await get(`/accounts/${at.id}/handoff`); assertMatch(page.text, /Changed before acceptance/);
});
Deno.test("revops findings: existing-customer backfill, unowned action flagged, review history kept, price-only carries approvals, blocked review gates Proposal, admin passcode", async () => {
  // backfill Thistle & Vine as an active customer with a 60-day notice clause
  let r = await post("/accounts", { name: "Thistle & Vine", owner_id: U.Priya, contact: "Imogen", existing: "1", ex_deliverables: "Quarterly eval of the sommelier agent", ex_price_terms: "$36k/yr", ex_success_metric: "Wrong-pairing rate", ex_success_target: "5", ex_success_unit: "%", ex_success_direction: "lower", ex_technical_owner_id: U.Leo, ex_evidence: "Order form TV-2 signed 2026-03-01", ex_started: "2026-03-01", ex_renewal_date: addDays(today, 50), ex_notice_days: "60" }, U.Priya);
  assertEquals(r.status, 302, r.text.slice(0, 300));
  const tv = await acc("Thistle & Vine"); assertEquals(tv.sales_stage, "won"); assertEquals(tv.delivery_status, "active"); assert(tv.current_agreement_id);
  let page = await get(`/accounts/${tv.id}`); assertMatch(page.text, /Renewal notice deadline 10d overdue/); assertMatch(page.text, /data restrictions unknown/);
  page = await get(`/accounts/${tv.id}/handoff`); assertMatch(page.text, /Backfilled existing engagement/);
  // sales cannot be the backfilled technical owner; validation errors re-render the form with input kept
  r = await post("/accounts", { name: "Bad Backfill", owner_id: U.Maya, existing: "1", ex_deliverables: "x", ex_price_terms: "y", ex_success_metric: "m", ex_success_target: "1", ex_technical_owner_id: U.Maya, ex_evidence: "e", ex_started: "2026-01-01" });
  assertEquals(r.status, 400); assertMatch(r.text, /engineer or delivery teammate/); assertMatch(r.text, /value="Bad Backfill"/);
  // unowned action is recorded as unowned and flagged, not given to the account owner
  r = await post(`/accounts/${tv.id}/tasks`, { title: "Expansion ask: second agent", owner_id: "", due_date: addDays(today, 7) }, U.Priya); assertEquals(r.status, 302, r.err);
  assertEquals((await d.get("SELECT owner_id FROM cc2_tasks WHERE title='Expansion ask: second agent'"))!.owner_id, null);
  page = await get(`/accounts/${tv.id}`); assertMatch(page.text, /Unowned action: Expansion ask/);
  assertMatch((await post(`/accounts/${tv.id}/tasks`, { title: "c", owner_id: "", due_date: today, committed: "1" }, U.Priya)).err, /needs an owner/);
  // measurement series: two measurements are both kept
  const o = (await d.get("SELECT * FROM cc2_outcomes WHERE account_id=?", [tv.id]))! as Record<string, string>;
  await post(`/accounts/${tv.id}/outcome`, { metric: o.metric, unit: "%", direction: "lower", baseline: "12", baseline_basis: "v3 index", target: "5", latest: "7", latest_basis: "v3 index", version: String(o.version) }, U.Priya);
  await post(`/accounts/${tv.id}/outcome`, { metric: o.metric, unit: "%", direction: "lower", baseline: "12", baseline_basis: "v3 index", target: "5", latest: "4", latest_basis: "v4 index", version: String(Number(o.version) + 1) }, U.Priya);
  assertEquals(Number((await d.get("SELECT COUNT(*) c FROM cc2_measurements WHERE account_id=?", [tv.id]))!.c), 2);
  page = await get(`/accounts/${tv.id}?tab=delivery`); assertMatch(page.text, /Measurement history \(2\)/); assertMatch(page.text, /differs from baseline basis/);
  // review history: Harbor's data review was decided then reopened earlier in this run -> earlier decision kept
  const hb = await acc("Harbor Operations");
  const rv = (await d.get("SELECT * FROM cc2_reviews WHERE account_id=? AND kind='data_handling'", [hb.id]))! as Record<string, string>;
  assertMatch(rv.history, /"status":"approved"/);
  page = await get(`/reviews/${rv.id}`, U.Priya); assertMatch(page.text, /Earlier decisions on this review/);
  // blocked data review gates Discovery -> Proposal
  const ns = await acc("Northstar Support");
  const nrv = (await d.get("SELECT * FROM cc2_reviews WHERE account_id=? AND kind='data_handling'", [ns.id]))! as Record<string, string>;
  assertEquals((await post(`/reviews/${nrv.id}/decide`, { status: "blocked", decision_note: "ZDR forbids the grader audit log", version: String(nrv.version) }, U.Leo)).status, 302);
  assertMatch((await stage(ns.id, "proposal")).err, /No review blocked/);
  // price-only revision carries approvals forward instead of going stale
  const cd = await acc("Cedar Analytics");
  await post(`/accounts/${cd.id}/reviews`, { kind: "technical_validation", reviewer_id: U.Leo, question: "ok?" }, U.Priya);
  const crv = (await d.get("SELECT * FROM cc2_reviews WHERE account_id=? AND kind='technical_validation'", [cd.id]))! as Record<string, string>;
  await post(`/reviews/${crv.id}/decide`, { status: "approved", decision_note: "fine", version: String(crv.version) }, U.Leo);
  const cp = (await d.get("SELECT * FROM cc2_proposals WHERE account_id=? ORDER BY revision DESC", [cd.id]))! as Record<string, string>;
  const h = JSON.parse(cp.handling || "{}");
  r = await post(`/accounts/${cd.id}/proposals`, { deliverables: cp.deliverables, exclusions: cp.exclusions ?? "", price_terms: cp.price_terms + " (+5% uplift)", dates: cp.dates ?? "", customer_responsibilities: cp.customer_responsibilities ?? "", success_metric: cp.success_metric, success_unit: cp.success_unit ?? "", success_direction: cp.success_direction, success_target: cp.success_target, success_basis: cp.success_basis ?? "", h_external: h.external_processing ?? "", h_processors: (h.external_processors ?? []).join(","), h_retention: h.retention ?? "", h_retention_note: h.retention_note ?? "", h_training: h.training_use ?? "", ...Object.fromEntries((h.activities ?? []).map((a: string) => ["h_activities[]", a])), change_note: "price only" }, U.Priya);
  assertEquals(r.status, 302, r.err);
  const after = (await d.get("SELECT r.proposal_id, p.revision FROM cc2_reviews r JOIN cc2_proposals p ON p.id=r.proposal_id WHERE r.id=?", [crv.id]))!;
  assertEquals(Number(after.revision), Number(cp.revision) + 1);
  // reseed needs the admin passcode, not the team passcode
  const rs = await fetchApp(new Request("http://x/admin/reseed", { method: "POST", headers: { cookie }, body: new URLSearchParams({ passcode: "evalhouse" }) })); assertEquals(rs.status, 401);
});
Deno.test("continual grading: calibration feeds the baseline; low agreement and pasted samples are flagged; self-serve /grade creates a Discovery lead", async () => {
  const ns = await acc("Northstar Support");
  let r = await post(`/accounts/${ns.id}/calibrations`, { source: "redacted_sample", n_examples: "40", agreement: "74", grader_version: "metagrader v1", metric: "Policy-incorrect answers", baseline: "23", unit: "%", direction: "lower", expert: "Dana (support lead)", failure_categories: "cites retired policy ×6\nwrong refund window ×3", apply: "1" }, U.Leo);
  assertEquals(r.status, 302, r.err);
  const o = (await d.get("SELECT * FROM cc2_outcomes WHERE account_id=?", [ns.id]))!;
  assertEquals(Number(o.baseline), 23); assertMatch(String(o.baseline_basis), /metagrader v1 on redacted sample \(n=40\)/);
  let page = await get(`/accounts/${ns.id}`); assertMatch(page.text, /Grader agrees with the expert on 74%/);
  // a better session replaces it; the old one is kept but no longer "in use"
  r = await post(`/accounts/${ns.id}/calibrations`, { source: "production_sample", n_examples: "120", agreement: "88", grader_version: "metagrader v2", metric: "Policy-incorrect answers", baseline: "19", unit: "%", direction: "lower", apply: "1" }, U.Leo);
  assertEquals(r.status, 302, r.err);
  assertEquals(Number((await d.get("SELECT COUNT(*) c FROM cc2_calibrations WHERE account_id=?", [ns.id]))!.c), 2);
  assertEquals(Number((await d.get("SELECT COUNT(*) c FROM cc2_calibrations WHERE account_id=? AND applied=1", [ns.id]))!.c), 1);
  page = await get(`/accounts/${ns.id}`); assert(!/Grader agrees with the expert on 74%/.test(page.text));
  assertMatch((await post(`/accounts/${ns.id}/calibrations`, { source: "production_sample", n_examples: "x" }, U.Leo)).err, /whole number/);
  assertMatch((await post(`/accounts/${ns.id}/calibrations`, { source: "production_sample", n_examples: "10", apply: "1" }, U.Leo)).err, /name the metric/);
  // self-serve: public, no passcode, no identity
  const pub = async (path: string, body?: Record<string, string>) => { const res = await fetchApp(new Request("http://x" + path, body ? { method: "POST", body: new URLSearchParams(body) } : {})); return { status: res.status, text: await res.text() }; };
  assertEquals((await pub("/grade")).status, 200);
  const ex = Array.from({ length: 6 }, (_, i) => `Agent reply ${i}: your refund will arrive in ${i} days.`).join("\n\n");
  let s2 = await pub("/grade/examples", { company: "Orbit Dental", contact: "Sam Reyes sam@orbit.example", agent: "Answers patient billing questions in chat", examples: ex });
  assertEquals(s2.status, 200); assertMatch(s2.text, /name="e5"/);
  s2 = await pub("/grade/examples", { company: "Orbit Dental", contact: "Sam", agent: "Answers billing questions", examples: "only one" }); assertEquals(s2.status, 400); assertMatch(s2.text, /at least 5/);
  const body: Record<string, string> = { company: "Orbit Dental", contact: "Sam Reyes sam@orbit.example", agent: "Answers patient billing questions in chat", n: "6" };
  for (let i = 0; i < 6; i++) { body[`e${i}`] = `Agent reply ${i}`; body[`g${i}`] = i < 2 ? "bad" : "good"; body[`w${i}`] = i < 2 ? "Wrong refund window." : ""; }
  const incomplete = { ...body }; delete incomplete.g3;
  assertMatch((await pub("/grade/submit", incomplete)).text, /Grade every example \(1 left\)/);
  const done = await pub("/grade/submit", body); assertEquals(done.status, 200); assertMatch(done.text, /2 of 6/); assertMatch(done.text, /wrong refund window/);
  const od = await acc("Orbit Dental"); assertEquals(od.sales_stage, "discovery"); assertEquals(od.owner_id, U.Maya);
  const k = (await d.get("SELECT * FROM cc2_calibrations WHERE account_id=?", [od.id]))!; assertEquals(k.source, "self_serve_samples"); assertEquals(Number(k.applied), 0); assertEquals(Number(k.baseline), 33.3);
  assertEquals(Number((await d.get("SELECT COUNT(*) c FROM cc2_tasks WHERE account_id=? AND title LIKE 'Follow up on self-serve grading%'", [od.id]))!.c), 1);
  page = await get(`/accounts/${od.id}?tab=scope`); assertMatch(page.text, /pasted samples \(self-serve\)/); assertMatch(page.text, /not production/);
  // applying the self-serve numbers as the baseline is allowed but flagged
  await post(`/accounts/${od.id}/calibrations`, { source: "self_serve_samples", n_examples: "6", metric: "Unacceptable outputs", baseline: "33.3", unit: "%", apply: "1" }, U.Leo);
  page = await get(`/accounts/${od.id}`); assertMatch(page.text, /Baseline comes from 6 pasted samples, not production traces/);
});
