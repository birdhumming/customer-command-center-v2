// Five accounts, three teammates. Dates relative to seed time so overdue/upcoming conditions hold. Seeds once; --force resets.
import { type DB, db as getDB, uuid } from "./db.ts";
import { ensureSchema } from "./schema.ts";
import { addDays } from "./rules.ts";

export async function seed(d: DB, opts: { force?: boolean; today?: string } = {}) {
  await ensureSchema(d);
  if (Number((await d.get("SELECT COUNT(*) c FROM cc2_accounts"))?.c) > 0 && !opts.force) return false;
  for (const t of ["activity", "calibrations", "measurements", "outcomes", "blockers", "meetings", "tasks", "handoffs", "reviews"]) await d.run(`DELETE FROM cc2_${t}`);
  await d.run("UPDATE cc2_accounts SET current_agreement_id=NULL");
  for (const t of ["agreements", "requirements", "proposals", "accounts", "users"]) await d.run(`DELETE FROM cc2_${t}`);
  const today = opts.today ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const D = (off: number) => addDays(today, off);
  const T = (off: number, h = 10) => `${D(off)}T${String(h).padStart(2, "0")}:00:00.000Z`;

  const user = async (name: string, role: string) => { const id = uuid(); await d.run("INSERT INTO cc2_users(id,name,role) VALUES (?,?,?)", [id, name, role]); return id; };
  const maya = await user("Sales", "sales");
  const leo = await user("Engineering", "engineer");
  const priya = await user("Delivery", "delivery");

  type V = string | number | null;
  const ins = async (table: string, row: Record<string, V>) => { const id = uuid(); const cols = ["id", ...Object.keys(row)]; await d.run(`INSERT INTO cc2_${table}(${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, [id, ...Object.values(row)]); return id; };
  const account = (r: Record<string, V>) => ins("accounts", { buyer_status: "not_assessed", health: "unknown", version: 1, created_at: T(-30), updated_at: T(0), ...r });
  const proposal = (account_id: string, revision: number, r: Record<string, V>) => ins("proposals", { account_id, revision, created_at: T(-10), ...r });
  const requirement = (account_id: string, revision: number, r: Record<string, V>) => ins("requirements", { account_id, revision, created_at: T(-10), ...r });
  const review = (account_id: string, r: Record<string, V>) => ins("reviews", { account_id, status: "open", conditions: "[]", requested_at: T(-5), version: 1, ...r });
  const task = (account_id: string, title: string, r: Record<string, V>) => ins("tasks", { account_id, title, type: "action", status: "open", committed: 0, required: 0, created_at: T(-7), updated_at: T(-7), version: 1, ...r });
  const meeting = (account_id: string, off: number, summary: string, author_id: string) => ins("meetings", { account_id, occurred_at: T(off, 15), summary, author_id, created_at: T(off, 16) });
  const blocker = (account_id: string, description: string, owner_id: string, off: number) => ins("blockers", { account_id, description, owner_id, opened_at: T(off) });
  const act = (account_id: string, off: number, actor_id: string, event_type: string, payload: Record<string, V>) => ins("activity", { account_id, actor_id, event_type, at: T(off, 11), payload: JSON.stringify(payload) });
  const H = (h: Record<string, unknown>) => JSON.stringify(h);

  // ---------------------------------------------------------------- Northstar Support — Discovery (Sales; review pending for Engineering)
  const ns = await account({
    name: "Northstar Support", owner_id: maya, technical_owner_id: null, contact: "Dana Whitcomb, Support Operations Lead", buyer: null, buyer_status: "unknown",
    problem: "Their Zendesk support agent confidently answers warranty questions with the wrong policy version. Dana has 14 example tickets where the agent cited a 2023 policy; nobody has measured how often it happens.",
    sales_stage: "discovery", last_customer_contact_at: T(-6, 15), created_at: T(-19),
  });
  await meeting(ns, -19, "Intro call. Dana brought 14 tickets with wrong-policy answers. Budget owner unknown — 'probably the VP CX but she hasn't been looped in'. Wants to know if we can score policy correctness before she asks for budget.", maya);
  await meeting(ns, -6, "Dana sent their vendor security addendum. It contains custom 'zero data retention' wording: 'no prompt or completion may be stored beyond the duration of the request'. Unclear whether that covers our grader's audit log.", maya);
  const nsReq = await requirement(ns, 1, { restriction_status: "specified", wording: "No prompt or completion may be stored by the vendor or its subprocessors beyond the duration of the request. (Security addendum §4.2)", activities: JSON.stringify(["inference", "grading", "logging"]), external_processing: "unknown", retention: "custom", retention_note: "ZDR per §4.2 — unclear whether audit logs of grader verdicts count", training_use: "no", evidence_note: "Security addendum v3, sent by Dana", created_by: maya, created_at: T(-6) });
  const nsProp = await proposal(ns, 1, { deliverables: "Policy-correctness evaluation set (300 sampled tickets, graded against the current policy document); weekly scorecard; remediation recommendations for the top 3 failure patterns", exclusions: "No changes to the agent itself; no live traffic interception", price_terms: "$18,000 fixed-fee pilot, 6 weeks, net-30", dates: "Start within 2 weeks of signature", customer_responsibilities: "Export of 300 anonymised tickets; current policy document; one weekly 30-min review", success_metric: "Policy-correct answers on the sampled set", success_unit: "%", success_direction: "higher", success_target: 95, success_basis: "300-ticket sample v1", handling: H({ activities: ["grading", "logging"], external_processors: ["hosted LLM grader (OpenAI)"], external_processing: "yes", retention: "custom", retention_note: "grader verdicts retained 30 days for audit", training_use: "no" }), created_by: maya, created_at: T(-4) });
  const nsRev = await review(ns, { kind: "data_handling", question: "Does our 30-day grader audit log violate their §4.2 ZDR wording? Can we run the grader with retention off?", proposal_id: nsProp, requirements_id: nsReq, reviewer_id: leo, requested_by: maya, requested_at: T(-4) });
  await task(ns, "Data review: Northstar ZDR wording vs grader audit log", { type: "review", owner_id: leo, due_date: D(2), required: 1, automation_key: "review", subject_id: nsRev, created_by: maya, created_at: T(-4) });
  await task(ns, "Ask Dana who owns the CX budget; get an intro before pricing is shared", { owner_id: maya, due_date: D(1) });
  await act(ns, -4, maya, "review_requested", { kind: "data_handling", reviewer: "Engineering" });

  // ---------------------------------------------------------------- Atlas Commerce — Negotiation (Sales/Engineering; external grader added after approval)
  const at = await account({
    name: "Atlas Commerce", owner_id: maya, technical_owner_id: leo, contact: "Rob Hadley, Director of CX", buyer: "Imani Clarke, VP Customer Experience", buyer_status: "named",
    problem: "Returns-initiation chatbot resolves 61% of conversations unassisted; Imani wants 75% before peak season and a way to prove the number to Finance.", budget: "FY budget approved up to $60k",
    sales_stage: "negotiation", last_customer_contact_at: T(-3, 15), created_at: T(-48),
  });
  const atReq = await requirement(at, 1, { restriction_status: "specified", wording: "Customer conversation data may be processed by subprocessors listed in the DPA. No training on customer data. Retention per DPA (30 days).", activities: JSON.stringify(["inference", "grading"]), external_processing: "unknown", retention: "custom", retention_note: "30 days per DPA", training_use: "no", evidence_note: "DPA v2, Annex 3", created_by: maya, created_at: T(-30) });
  const atP1 = await proposal(at, 1, { deliverables: "Resolution-quality evaluation across 1,200 conversations/month; grader for 'resolved without human'; monthly report to Finance", exclusions: "No voice channel", price_terms: "$54,000 / 12 months, quarterly in advance", dates: "Kickoff first week after signature", customer_responsibilities: "Gorgias export access; named reviewer for grader calibration", success_metric: "Unassisted resolution rate", success_unit: "%", success_direction: "higher", success_target: 75, success_basis: "Gorgias monthly export, our grader v1", handling: H({ activities: ["grading"], external_processors: [], external_processing: "no", retention: "custom", retention_note: "30 days, in-region", training_use: "no" }), shared_at: D(-22), created_by: maya, created_at: T(-25) });
  const atRev1 = await review(at, { kind: "technical_validation", question: "Can we grade 'resolved without human' reliably from Gorgias exports alone?", proposal_id: atP1, requirements_id: atReq, reviewer_id: leo, status: "approved", decision_note: "Yes with calibration set of 200; in-house grader, no external processors.", decided_at: T(-20), requested_by: maya, requested_at: T(-24) });
  const atRev1d = await review(at, { kind: "data_handling", question: "Handling matches DPA Annex 3?", proposal_id: atP1, requirements_id: atReq, reviewer_id: leo, status: "approved", decision_note: "No subprocessors beyond DPA list; retention 30d matches.", decided_at: T(-20), requested_by: maya, requested_at: T(-24) });
  const atP2 = await proposal(at, 2, { deliverables: "Resolution-quality evaluation across 1,200 conversations/month; grader for 'resolved without human'; monthly report to Finance; ADDED: second-opinion grading by an external LLM grader (customer request, to 'check our checker')", exclusions: "No voice channel", price_terms: "$58,000 / 12 months, quarterly in advance", dates: "Kickoff first week after signature", customer_responsibilities: "Gorgias export access; named reviewer for grader calibration", success_metric: "Unassisted resolution rate", success_unit: "%", success_direction: "higher", success_target: 75, success_basis: "Gorgias monthly export, our grader v1", handling: H({ activities: ["grading"], external_processors: ["external LLM grader (Anthropic API)"], external_processing: "yes", retention: "custom", retention_note: "30 days, in-region", training_use: "no" }), shared_at: D(-2), change_note: "Rob asked for an external second-opinion grader after seeing our calibration numbers.", created_by: maya, created_at: T(-2) });
  const atRev2 = await review(at, { kind: "data_handling", question: "Rev 2 adds an external LLM grader. Is Anthropic on their DPA subprocessor list? Their position on external processing is not stated.", proposal_id: atP2, requirements_id: atReq, reviewer_id: leo, reopened_reason: "New external grader added in proposal rev 2", requested_by: maya, requested_at: T(-2) });
  await task(at, "Data review: Atlas rev 2 external grader vs DPA subprocessor list", { type: "review", owner_id: leo, due_date: D(1), required: 1, automation_key: "review", subject_id: atRev2, created_by: maya, created_at: T(-2) });
  await task(at, "Send rev 2 pricing to Imani with the external-grader line item", { owner_id: maya, due_date: D(3) });
  await meeting(at, -3, "Rob: 'Finance wants a second opinion on your grader — can you run Claude as a check?' Said we'd confirm it is allowed under the DPA before pricing it. Imani wants signature before Nov 30.", maya);
  await act(at, -20, leo, "review_decided", { kind: "technical_validation", status: "approved" });
  await act(at, -2, maya, "proposal_revised", { revision: 2, change_note: "external grader added" });
  await act(at, -2, maya, "review_reopened", { kind: "data_handling", reason: "New external grader added in proposal rev 2" });
  void atRev1; void atRev1d;

  // ---------------------------------------------------------------- Harbor Operations — Won, onboarding pending (Sales sold; Delivery delivers)
  const hb = await account({
    name: "Harbor Operations", owner_id: maya, technical_owner_id: priya, contact: "Wei Zhang, Head of Dispatch Systems", buyer: "Dr. Amara Osei, COO", buyer_status: "named",
    problem: "Dispatch voice agent books ~4% of pickups to the wrong depot; staff re-book by hand. COO wants the error rate measured and under 1.5% before the second region goes live.", budget: "Signed",
    sales_stage: "won", delivery_status: "onboarding_pending", last_customer_contact_at: T(-5, 15), renewal_date: D(358), created_at: T(-60),
  });
  const hbReq = await requirement(hb, 1, { restriction_status: "specified", wording: "Call recordings stay in Harbor's tenant; vendor may process transcripts; no training use; delete derived data at engagement end.", activities: JSON.stringify(["inference", "grading", "logging"]), external_processing: "no", retention: "custom", retention_note: "delete derived data at engagement end", training_use: "no", evidence_note: "MSA Schedule B", created_by: maya, created_at: T(-20) });
  const hbP = await proposal(hb, 1, { deliverables: "Wrong-depot booking evaluation on 400 calls/week; weekly scorecard; root-cause report per failure class", exclusions: "No changes to telephony", price_terms: "$72,000 / 12 months, net-45", dates: "Kickoff " + D(-2) + "; first scorecard by " + D(19), customer_responsibilities: "Transcript export (SSO service account); depot master list; weekly 30-min review", success_metric: "Wrong-depot booking rate", success_unit: "%", success_direction: "lower", success_target: 1.5, success_basis: "weekly 400-call sample, in-house grader v2", handling: H({ activities: ["grading", "logging"], external_processors: [], external_processing: "no", retention: "custom", retention_note: "derived data deleted at end", training_use: "no" }), shared_at: D(-14), created_by: maya, created_at: T(-16) });
  await review(hb, { kind: "technical_validation", question: "Feasible from transcripts without audio?", proposal_id: hbP, requirements_id: hbReq, reviewer_id: priya, status: "approved", decision_note: "Yes; depot names are in the transcript.", decided_at: T(-12), requested_by: maya, requested_at: T(-15) });
  await review(hb, { kind: "data_handling", question: "Handling matches Schedule B?", proposal_id: hbP, requirements_id: hbReq, reviewer_id: priya, status: "approved", decision_note: "In-tenant processing; deletion plan documented.", decided_at: T(-12), requested_by: maya, requested_at: T(-15) });
  const hbAg = await ins("agreements", { account_id: hb, proposal_id: hbP, requirements_id: hbReq, accepted_by: maya, accepted_at: T(-7), acceptance_evidence: "Order form HO-2026-11 signed by Dr. Osei (DocuSign envelope 4F2A)", created_at: T(-7) });
  await d.run("UPDATE cc2_accounts SET current_agreement_id=? WHERE id=?", [hbAg, hb]);
  const hbHand = await ins("handoffs", { account_id: hb, agreement_id: hbAg, created_at: T(-7) });
  await task(hb, "Accept handoff: Harbor Operations", { type: "handoff", owner_id: priya, due_date: D(-2), required: 1, automation_key: "handoff", subject_id: hbHand, created_by: maya, created_at: T(-7) });
  await task(hb, "Baseline evaluation set agreed with Wei (400 calls, depot list v1)", { type: "milestone", owner_id: priya, due_date: D(5), committed: 1, required: 1, created_by: maya, created_at: T(-7) });
  await task(hb, "First weekly scorecard delivered", { type: "milestone", owner_id: priya, due_date: D(19), committed: 1, required: 1, created_by: maya, created_at: T(-7) });
  await blocker(hb, "Transcript export needs an SSO service account; Harbor IT ticket open since " + D(-6) + ", no ETA", priya, -6);
  await meeting(hb, -5, "Kickoff prep with Wei. IT has not provisioned the SSO service account; Wei will escalate. Depot master list arrives Friday.", priya);
  await ins("outcomes", { account_id: hb, agreement_id: hbAg, metric: "Wrong-depot booking rate", unit: "%", direction: "lower", baseline: null, baseline_basis: null, target: 1.5, latest: null, latest_basis: null, measured_at: null, not_measured_reason: null, version: 1, updated_at: T(-7) });
  await act(hb, -7, maya, "agreement_confirmed", { evidence: "Order form HO-2026-11" });
  await act(hb, -7, maya, "handoff_created", {});

  // ---------------------------------------------------------------- Meridian Services — Active; renewal in 21d; overdue commitment (Delivery owns; Engineering tech)
  const md = await account({
    name: "Meridian Services", owner_id: priya, technical_owner_id: leo, contact: "Sam Odunaike, Knowledge Manager", buyer: "Helen Kessler-Moore, General Counsel", buyer_status: "named",
    problem: "Internal legal-research copilot cited non-existent cases; GC paused the partner roll-out until citation accuracy is demonstrably above 80% on the firm's own queries.", budget: "Innovation fund",
    sales_stage: "won", delivery_status: "active", last_customer_contact_at: T(-9, 15), renewal_date: D(21), health: "watch", health_reason: "Accuracy improving but below target; GC has not been in a meeting since kickoff.", health_reviewed_at: T(-9), created_at: T(-300),
  });
  const mdReq = await requirement(md, 1, { restriction_status: "specified", wording: "Client-matter data may not leave the firm's Azure tenant. No external processors. No training.", activities: JSON.stringify(["inference", "grading", "logging"]), external_processing: "no", retention: "custom", retention_note: "in-tenant only", training_use: "no", evidence_note: "Engagement letter §7", created_by: priya, created_at: T(-290) });
  const mdP = await proposal(md, 1, { deliverables: "Weekly citation-accuracy evaluation on 400 firm queries; failure taxonomy; monthly GC briefing", exclusions: "No retrieval re-architecture", price_terms: "$96,000 / 12 months", dates: "Term " + D(-344) + " to " + D(21), customer_responsibilities: "Weekly query sample; access to brief bank index metadata", success_metric: "Citation accuracy", success_unit: "%", success_direction: "higher", success_target: 80, success_basis: "weekly 400-query sample, index v3", handling: H({ activities: ["grading", "logging"], external_processors: [], external_processing: "no", retention: "custom", retention_note: "in-tenant", training_use: "no" }), shared_at: D(-350), created_by: priya, created_at: T(-352) });
  await review(md, { kind: "technical_validation", question: "In-tenant grader feasible?", proposal_id: mdP, requirements_id: mdReq, reviewer_id: leo, status: "approved", decision_note: "Yes, Azure-hosted grader.", decided_at: T(-346), requested_by: priya, requested_at: T(-348) });
  await review(md, { kind: "data_handling", question: "Matches §7?", proposal_id: mdP, requirements_id: mdReq, reviewer_id: leo, status: "approved", decision_note: "In-tenant only; confirmed.", decided_at: T(-346), requested_by: priya, requested_at: T(-348) });
  const mdAg = await ins("agreements", { account_id: md, proposal_id: mdP, requirements_id: mdReq, accepted_by: priya, accepted_at: T(-344), acceptance_evidence: "Engagement letter countersigned by H. Kessler-Moore", created_at: T(-344) });
  await d.run("UPDATE cc2_accounts SET current_agreement_id=? WHERE id=?", [mdAg, md]);
  const mdHand = await ins("handoffs", { account_id: md, agreement_id: mdAg, created_at: T(-344), accepted_by: leo, accepted_at: T(-342), acceptance_note: "Accepted; index metadata access confirmed." });
  void mdHand;
  await task(md, "Kickoff and baseline run", { type: "milestone", owner_id: leo, due_date: D(-330), status: "done", done_at: T(-331), committed: 1, required: 1, created_at: T(-344), updated_at: T(-331) });
  await task(md, "Q3 regression report to the GC (committed at the " + D(-40) + " briefing)", { owner_id: leo, due_date: D(-4), committed: 1, created_at: T(-40), updated_at: T(-40) });
  await task(md, "Renewal proposal to Helen; include the index-v4 re-baseline plan", { owner_id: priya, due_date: D(7), created_at: T(-9), updated_at: T(-9) });
  await task(md, "Weekly measurement: citation accuracy sample", { type: "measurement", owner_id: leo, due_date: D(3), committed: 1, created_at: T(-9), updated_at: T(-9) });
  await meeting(md, -9, "Monthly briefing with Sam (GC declined). Accuracy 71% on index v3. IT plans to re-index the brief bank (v4) next month; we flagged that the comparison will need a new baseline.", priya);
  await meeting(md, -40, "Briefing with Sam and Helen. Helen asked for a regression report before she un-pauses partners; Engineering committed to it by " + D(-4) + ".", priya);
  await ins("outcomes", { account_id: md, agreement_id: mdAg, metric: "Citation accuracy", unit: "%", direction: "higher", baseline: 62, baseline_basis: "weekly 400-query sample, index v3", target: 80, latest: 71, latest_basis: "weekly 400-query sample, index v3", measured_at: D(-9), version: 1, updated_at: T(-9) });
  await act(md, -9, priya, "health_assessed", { health: "watch" });
  await act(md, -9, leo, "outcome_recorded", { latest: 71 });

  // ---------------------------------------------------------------- Cedar Analytics — Active, healthy (Delivery owns; Engineering tech)
  const cd = await account({
    name: "Cedar Analytics", owner_id: priya, technical_owner_id: leo, contact: "Jon Castellano, Head of Support", buyer: "Renata Oyelaran, VP Operations", buyer_status: "named",
    problem: "Support copilot drafts replies for agents; escalations were 31% and they wanted a defensible number for the board.", budget: "Opex, renewed annually",
    sales_stage: "won", delivery_status: "active", last_customer_contact_at: T(-4, 15), renewal_date: D(150), expansion_note: "Renata asked about evaluating the new billing-dispute agent; demo requested for next month.",
    health: "healthy", health_reason: "Target met two months running; weekly reviews attended by Jon.", health_reviewed_at: T(-4), created_at: T(-240),
  });
  const cdReq = await requirement(cd, 1, { restriction_status: "none_stated", wording: null, activities: "[]", external_processing: "unknown", retention: "unknown", training_use: "unknown", evidence_note: "Standard MSA; no addendum", created_by: priya, created_at: T(-230) });
  const cdP = await proposal(cd, 1, { deliverables: "Escalation-rate evaluation on sampled drafts; weekly review; quarterly board one-pager", exclusions: null, price_terms: "$48,000 / 12 months", dates: "Term " + D(-215) + " to " + D(150), customer_responsibilities: "Weekly export; one reviewer", success_metric: "Escalation rate on copilot-drafted replies", success_unit: "%", success_direction: "lower", success_target: 20, success_basis: "weekly sample, grader v1", handling: H({ activities: ["grading"], external_processors: ["hosted LLM grader (OpenAI)"], external_processing: "yes", retention: "none", training_use: "no" }), shared_at: D(-225), created_by: priya, created_at: T(-228) });
  await review(cd, { kind: "technical_validation", question: "Feasible?", proposal_id: cdP, requirements_id: cdReq, reviewer_id: leo, status: "approved", decision_note: "Standard setup.", decided_at: T(-222), requested_by: priya, requested_at: T(-226) });
  const cdAg = await ins("agreements", { account_id: cd, proposal_id: cdP, requirements_id: cdReq, accepted_by: priya, accepted_at: T(-215), acceptance_evidence: "Order form CA-2026-03, signed R. Oyelaran", created_at: T(-215) });
  await d.run("UPDATE cc2_accounts SET current_agreement_id=? WHERE id=?", [cdAg, cd]);
  await ins("handoffs", { account_id: cd, agreement_id: cdAg, created_at: T(-215), accepted_by: leo, accepted_at: T(-214), acceptance_note: "Accepted." });
  await task(cd, "Kickoff and baseline", { type: "milestone", owner_id: leo, due_date: D(-200), status: "done", done_at: T(-201), committed: 1, required: 1, created_at: T(-215), updated_at: T(-201) });
  await task(cd, "Weekly review with Jon", { owner_id: priya, due_date: D(3), created_at: T(-4), updated_at: T(-4) });
  await task(cd, "Expansion: demo evaluation of the billing-dispute agent for Renata", { owner_id: priya, due_date: D(24), created_at: T(-4), updated_at: T(-4) });
  await meeting(cd, -4, "Weekly review. Escalations 18% (target 20). Renata joined for ten minutes and asked about the billing-dispute agent.", priya);
  await ins("outcomes", { account_id: cd, agreement_id: cdAg, metric: "Escalation rate on copilot-drafted replies", unit: "%", direction: "lower", baseline: 31, baseline_basis: "weekly sample, grader v1", target: 20, latest: 18, latest_basis: "weekly sample, grader v1", measured_at: D(-4), version: 1, updated_at: T(-4) });
  await act(cd, -4, priya, "health_assessed", { health: "healthy" });

  // ---------------------------------------------------------------- grading calibrations (what "good" means, measured)
  await ins("calibrations", { account_id: ns, source: "redacted_sample", n_examples: 40, agreement: 74, grader_version: "metagrader v1", metric: "Policy-incorrect answers", baseline: 23, unit: "%", direction: "lower", failure_categories: JSON.stringify([{ label: "cites retired policy", count: 6 }, { label: "wrong refund window", count: 3 }, { label: "escalates when it should answer", count: 2 }]), expert: "Dana Whitcomb", notes: "Dana disputes 4 of the 40 grades; the ZDR question decides whether a production sample is possible.", applied: 1, recorded_by: leo, created_at: T(-6) });
  await ins("calibrations", { account_id: cd, source: "production_sample", n_examples: 300, agreement: 88, grader_version: "grader v1", metric: "Escalation rate on copilot-drafted replies", baseline: 31, unit: "%", direction: "lower", failure_categories: JSON.stringify([{ label: "missing order context", count: 41 }, { label: "tone", count: 17 }]), expert: "Cedar support QA lead", notes: null, applied: 1, recorded_by: leo, created_at: T(-200) });

  return true;
}

if (import.meta.main) {
  const d = await getDB();
  console.log((await seed(d, { force: Deno.args.includes("--force") })) ? "seeded" : "already seeded (use --force)");
}
