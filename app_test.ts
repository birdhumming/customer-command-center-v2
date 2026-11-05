// Acceptance tests from the spec, run against app.fetch with a throwaway DB.
Deno.env.set("CCC_DB", "/tmp/ccc2_test.sqlite");
try { Deno.removeSync("/tmp/ccc2_test.sqlite"); } catch { /* fresh */ }
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
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
  r = await post(`/accounts/${a.id}/stage`, { to: "negotiation" }); assertMatch(r.err, /skipping is rejected/);
  r = await post(`/accounts/${a.id}/stage`, { to: "won" }); assertMatch(r.err, /skipping is rejected|Confirm agreement/);
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
  const adv = await post(`/accounts/${hb.id}/stage`, { to: "delivery" }); assertMatch(adv.err, /Not ready for Delivery/);
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
  const dd = await post(`/accounts/${at.id}/stage`, { to: "onboarding_pending" }); assertMatch(dd.err, /skipping is rejected|only forward step/);
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
