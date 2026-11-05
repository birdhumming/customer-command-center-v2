// Pure rules. evaluateAccount(account, related, today) -> readiness gaps for the next transition + signals.
// No DB, no HTML. Everything the UI says about an account's state comes from here.
import type { Row } from "./db.ts";

export type Severity = "critical" | "high" | "warning";
export interface Signal { key: string; severity: Severity; reason: string; detail?: string; ownerId: string | null; actionType: string; subjectId: string | null }
export interface Gap { label: string; ok: boolean; hint?: string; anchor?: string }
export interface Readiness { from: string; to: string | null; toLabel: string | null; items: Gap[]; ready: boolean; via: "advance" | "confirm_agreement" | "end" | null }
export interface Related {
  proposals: Row[]; requirements: Row[]; reviews: Row[]; agreements: Row[]; handoffs: Row[];
  tasks: Row[]; meetings: Row[]; blockers: Row[]; outcome: Row | null; users: Row[]; measurements?: Row[];
}
export interface Evaluation { signals: Signal[]; readiness: Readiness; nextStep: string; conflicts: string[]; agreementConflicts: string[] }

export const SALES_STAGES = ["discovery", "proposal", "negotiation", "won"] as const;
export const DELIVERY_STATUSES = ["onboarding_pending", "delivery", "active", "ended"] as const;
export const STAGE_LABEL: Record<string, string> = {
  discovery: "Discovery", proposal: "Proposal", negotiation: "Negotiation", won: "Won", lost: "Lost",
  onboarding_pending: "Onboarding pending", delivery: "Delivery", active: "Active", ended: "Ended",
};
export const REVIEW_KINDS: Record<string, string> = {
  technical_validation: "Technical validation", data_handling: "Data review", agreement_review: "Agreement review",
  delivery_plan: "Delivery-plan review", success_review: "Success review",
};
export const ACTIVITIES = ["inference", "routing", "grading", "training", "logging"] as const;
export const STALLED_DAYS = 14;
export const CHECKIN_DAYS = 30;
export const RENEWAL_WINDOW_DAYS = 30;
export const LOST_REASONS = ["no budget", "built in-house", "competitor", "no decision", "timing", "data restrictions", "other"];

export const s = (v: unknown) => (v == null ? "" : String(v));
export const n = (v: unknown) => (v == null || v === "" ? null : Number(v));
export const addDays = (date: string, days: number) => { const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10) + "T00:00:00Z") - Date.parse(a.slice(0, 10) + "T00:00:00Z")) / 86400000);
export const parseJSON = <T>(v: unknown, fallback: T): T => { try { return v ? JSON.parse(String(v)) as T : fallback; } catch { return fallback; } };

export interface Handling { activities?: string[]; external_processors?: string[]; external_processing?: string; retention?: string; retention_note?: string; training_use?: string }
export const handlingOf = (p: Row | undefined | null): Handling => parseJSON<Handling>(p?.handling, {});

// ---- data restrictions vs proposed handling: deterministic, explicit mismatches only -----------------
export function conflicts(req: Row | null | undefined, p: Row | null | undefined): string[] {
  if (!req || !p || req.restriction_status !== "specified") return [];
  const h = handlingOf(p), out: string[] = [];
  const procs = h.external_processors ?? [];
  if (req.external_processing === "no" && (h.external_processing === "yes" || procs.length)) out.push(`customer forbids external processing; proposal names ${procs.length ? procs.join(", ") : "an external processor"}`);
  if (req.training_use === "no" && h.training_use === "yes") out.push("customer forbids training use; proposal declares training use");
  if (req.retention === "none" && h.retention && h.retention !== "none") out.push(`customer requires no retention; proposal retains (${h.retention}${h.retention_note ? ": " + h.retention_note : ""})`);
  return out;
}
// Things that need a human clarification rather than a verdict.
export function clarifications(req: Row | null | undefined, p: Row | null | undefined): string[] {
  const out: string[] = [];
  if (!p) return out;
  if (!req || req.restriction_status === "unknown") { out.push("data restrictions unknown — unknown is not permission"); return out; }
  if (req.restriction_status !== "specified") return out;
  const h = handlingOf(p);
  if (req.external_processing === "unknown" && (h.external_processing === "yes" || (h.external_processors ?? []).length)) out.push("customer's position on external processing unknown; proposal uses external processors");
  if (req.retention === "custom") out.push(`customer retention wording is custom (${s(req.retention_note) || "see wording"}); confirm handling matches`);
  if (req.training_use === "unknown" && h.training_use === "yes") out.push("customer's position on training use unknown; proposal declares training use");
  if (!h.external_processing && !h.retention) out.push("proposed data handling not yet declared by the technical owner");
  return out;
}

// ---- reviews ----------------------------------------------------------------------------------------
export const latest = (rows: Row[]) => rows[0] ?? null;    // related lists are ordered newest first
export const reviewCurrent = (r: Row, p: Row | null, req: Row | null) => s(r.proposal_id) === s(p?.id) && s(r.requirements_id) === s(req?.id);
export const conditionsDone = (r: Row) => parseJSON<{ text: string; done: boolean }[]>(r.conditions, []).every((c) => c.done);
export const reviewSatisfied = (r: Row) => r.status === "approved" || (r.status === "conditional" && conditionsDone(r));
export const latestReview = (rel: Related, kind: string) => rel.reviews.filter((r) => r.kind === kind)[0] ?? null;
export function requiredReviewKinds(account: Row, rel: Related): string[] {
  const p = latest(rel.proposals), req = latest(rel.requirements);
  const kinds: string[] = [];
  if (p && !p.validation_waived_reason) kinds.push("technical_validation");
  // unknown is not permission: only an explicit "none stated" (with evidence) removes the data review
  if (p && (!req || req.restriction_status !== "none_stated")) kinds.push("data_handling");
  return kinds;
}
export interface ReviewState { kind: string; label: string; review: Row | null; state: "missing" | "open" | "stale" | "satisfied" | "blocked" | "conditional"; why: string }
export function reviewStates(account: Row, rel: Related): ReviewState[] {
  const p = latest(rel.proposals), req = latest(rel.requirements);
  return requiredReviewKinds(account, rel).map((kind) => {
    const r = latestReview(rel, kind), label = REVIEW_KINDS[kind];
    if (!r) return { kind, label, review: null, state: "missing", why: `${label} not requested` };
    if (r.status === "open") return { kind, label, review: r, state: "open", why: `${label} pending${r.reviewer_id ? "" : " (no reviewer)"}` };
    if (!reviewCurrent(r, p, req)) return { kind, label, review: r, state: "stale", why: `${label} was for proposal rev ${rel.proposals.find((x) => x.id === r.proposal_id)?.revision ?? "?"} / restrictions rev ${rel.requirements.find((x) => x.id === r.requirements_id)?.revision ?? "none"}; current is proposal rev ${p?.revision} / restrictions rev ${req?.revision ?? "none"}` };
    if (r.status === "blocked") return { kind, label, review: r, state: "blocked", why: `${label} blocked: ${s(r.decision_note)}` };
    if (r.status === "conditional" && !conditionsDone(r)) return { kind, label, review: r, state: "conditional", why: `${label} approved with conditions not yet checked off` };
    return { kind, label, review: r, state: "satisfied", why: `${label} approved` };
  });
}

// ---- outcome ----------------------------------------------------------------------------------------
export type OutcomeStatus = "none" | "not_measured" | "not_comparable" | "met" | "below";
export function outcomeStatus(o: Row | null): { status: OutcomeStatus; why: string } {
  if (!o) return { status: "none", why: "no success metric recorded" };
  if (o.latest == null) return { status: "not_measured", why: o.not_measured_reason ? `not yet measured: ${o.not_measured_reason}` : "not yet measured" };
  if (o.baseline == null || !o.baseline_basis || o.baseline_basis !== o.latest_basis) return { status: "not_comparable", why: `latest ${o.latest}${s(o.unit)} on "${s(o.latest_basis) || "?"}" is not comparable to baseline on "${s(o.baseline_basis) || "?"}"` };
  const met = o.target != null && (o.direction === "lower" ? Number(o.latest) <= Number(o.target) : Number(o.latest) >= Number(o.target));
  return { status: met ? "met" : "below", why: `${o.latest}${s(o.unit)} vs target ${o.target}${s(o.unit)} (baseline ${o.baseline}${s(o.unit)}, ${o.direction} is better, basis "${o.baseline_basis}")` };
}

// ---- the evaluator ----------------------------------------------------------------------------------
export const isOpenAccount = (a: Row) => a.sales_stage !== "lost" && a.delivery_status !== "ended";
export const isPresales = (a: Row) => ["discovery", "proposal", "negotiation"].includes(s(a.sales_stage));
const openTasks = (rel: Related) => rel.tasks.filter((t) => t.status === "open");
const overdue = (t: Row, today: string) => !!t.due_date && s(t.due_date) < today;

export function evaluateAccount(a: Row, rel: Related, today: string): Evaluation {
  const p = latest(rel.proposals), req = latest(rel.requirements);
  const agreement = rel.agreements.find((g) => g.id === a.current_agreement_id) ?? null;
  const agreementProposal = agreement ? rel.proposals.find((x) => x.id === agreement.proposal_id) ?? null : null;
  const techOwner = s(a.technical_owner_id) || null, owner = s(a.owner_id);
  const S: Signal[] = [];
  const sig = (key: string, severity: Severity, reason: string, ownerId: string | null, actionType: string, subjectId: string | null = null, detail?: string) => S.push({ key, severity, reason, ownerId, actionType, subjectId, detail });

  const conf = conflicts(req, p);
  const agreementConf = conflicts(req, agreementProposal);
  const open = isOpenAccount(a);

  if (open) {
    // data conflicts: proposed change vs accepted agreement are different sentences
    if (agreementConf.length) sig("agreement_conflict", "critical", "Current agreement needs review", techOwner ?? owner, "request_review", "data_handling", agreementConf.join("; "));
    if (conf.length && (!agreement || s(p?.id) !== s(agreementProposal?.id))) sig("data_conflict", "critical", "Proposed change requires review", techOwner ?? owner, "request_review", "data_handling", conf.join("; "));
    // reviews
    for (const r of rel.reviews.filter((r) => r.status === "open")) {
      if (!r.reviewer_id) sig("review_unassigned", "high", `${REVIEW_KINDS[s(r.kind)]} has no reviewer`, owner, "assign_reviewer", s(r.id), s(r.question));
      else sig("review_open", r.reopened_reason ? "high" : "warning", `${REVIEW_KINDS[s(r.kind)]} ${r.reopened_reason ? "reopened" : "pending"}`, s(r.reviewer_id), "decide_review", s(r.id), s(r.reopened_reason || r.question));
    }
    for (const st of reviewStates(a, rel)) {
      if (st.state === "stale") sig("approval_stale", "high", st.why, techOwner ?? owner, "request_review", st.kind);
      if (st.state === "blocked") sig("review_blocked", "high", st.why, owner, "revise_proposal", st.kind);
    }
    for (const c of clarifications(req, p)) sig("clarification", "warning", c, c.startsWith("proposed data handling") ? (techOwner ?? owner) : owner, c.startsWith("proposed data handling") ? "declare_handling" : "record_requirements");
    // commitments
    // customer-side items: waiting on them is not stalled; late is their lateness, not our commitment
    const waiting = openTasks(rel).filter((t) => t.customer_side);
    for (const t of waiting) {
      if (overdue(t, today)) sig("customer_late", "high", `Customer late ${daysBetween(s(t.due_date), today)}d: ${t.title}`, s(t.owner_id) || owner, "log_meeting", s(t.id));
      else sig("waiting_on_customer", "warning", `Waiting on customer: ${t.title} (by ${t.due_date})`, s(t.owner_id) || owner, "open_account", s(t.id));
    }
    for (const t of openTasks(rel).filter((t) => t.committed && !t.customer_side && overdue(t, today))) {
      sig("overdue_commitment", "high", `Committed ${t.type === "milestone" ? "milestone" : "work"} overdue ${daysBetween(s(t.due_date), today)}d: ${t.title}`, s(t.owner_id) || owner, t.type === "review" ? "decide_review" : "complete_task", s(t.id));
    }
    // handoff
    const h = rel.handoffs.find((x) => x.agreement_id === a.current_agreement_id);
    if (h && !h.accepted_at) sig("handoff_pending", "high", h.stale_reason ? `Handoff acceptance reopened: ${h.stale_reason}` : "Handoff awaiting technical owner's acceptance", techOwner ?? owner, techOwner ? "accept_handoff" : "assign_technical_owner", s(h.id));
    // delivery
    const openBlockers = rel.blockers.filter((b) => !b.resolved_at);
    const lateMilestones = openTasks(rel).filter((t) => t.type === "milestone" && t.committed && overdue(t, today));
    if (openBlockers.length && lateMilestones.length) sig("delivery_intervention", "high", `Blocker open (${openBlockers[0].description}) and milestone overdue (${lateMilestones[0].title})`, techOwner ?? owner, "request_delivery_review");
    else if (openBlockers.length && a.delivery_status) sig("blocker_open", "warning", `Blocker open ${daysBetween(s(openBlockers[0].opened_at), today)}d: ${openBlockers[0].description}`, s(openBlockers[0].owner_id) || techOwner || owner, "resolve_blocker", s(openBlockers[0].id));
    // renewal
    if (a.renewal_date && a.delivery_status && a.delivery_status !== "ended") {
      const notice = Number(a.renewal_notice_days) || 0;
      const left = daysBetween(today, s(a.renewal_date)) - notice;     // days until the decision deadline, not the term end
      const what = notice ? `Renewal notice deadline` : `Renewal`;
      const when = left < 0 ? `${-left}d overdue` : `in ${left}d`;
      const os = outcomeStatus(rel.outcome);
      if (left <= RENEWAL_WINDOW_DAYS && os.status !== "met") sig("renewal_intervention", "high", `${what} ${when} and success not demonstrated (${os.why})`, owner, "request_success_review");
      else if (left <= RENEWAL_WINDOW_DAYS && !openTasks(rel).some((t) => /renew|expan/i.test(s(t.title)))) sig("renewal_step_missing", "warning", `${what} ${when} with no renewal or expansion action`, owner, "add_action");
    }
    if (a.delivery_status && a.delivery_status !== "ended") {
      const os = outcomeStatus(rel.outcome);
      if (os.status === "below" && a.delivery_status === "active") sig("below_target", "warning", `Latest result below target (${os.why})`, techOwner ?? owner, "record_outcome");
      const since = daysBetween(s(a.last_customer_contact_at || a.created_at), today);
      if (since >= CHECKIN_DAYS && !waiting.some((t) => !overdue(t, today))) sig("checkin_overdue", "warning", a.last_customer_contact_at ? `No customer check-in for ${since}d` : "No customer meeting ever logged", owner, "log_meeting");
      if (a.expansion_note && !openTasks(rel).some((t) => /expan/i.test(s(t.title)))) sig("expansion_unowned", "warning", "Expansion noted with no owned, dated action", owner, "add_action");
    }
    // cadence
    if (isPresales(a)) {
      const since = daysBetween(s(a.last_customer_contact_at || a.created_at), today);
      if (since >= STALLED_DAYS && !waiting.some((t) => !overdue(t, today))) sig("stalled_prospect", "warning", `No customer contact for ${since}d`, owner, "log_meeting");
      if (!a.budget && a.sales_stage !== "discovery") sig("budget_unknown", "warning", "Budget unknown", owner, "edit_account");
    }
    for (const t of openTasks(rel).filter((t) => !t.owner_id && t.type !== "review")) sig("unowned_task", "warning", `Unowned ${t.type === "milestone" ? "milestone" : "action"}: ${t.title}`, owner, "open_account", s(t.id));
    if (!openTasks(rel).some((t) => t.due_date)) sig("missing_next_step", "warning", "No dated next step", owner, "add_action");
    if (a.delivery_status && rel.outcome && rel.outcome.baseline == null) sig("baseline_missing", "warning", "Success metric has no baseline", techOwner ?? owner, "record_outcome");
  }

  const order: Record<Severity, number> = { critical: 0, high: 1, warning: 2 };
  S.sort((x, y) => order[x.severity] - order[y.severity]);

  const readiness = readinessFor(a, rel, today, conf);
  const critical = S.find((x) => x.severity === "critical");
  let nextStep: string;
  if (!open) nextStep = a.sales_stage === "lost" ? `Lost: ${s(a.lost_reason) || "no reason recorded"}` : `Ended: ${s(a.end_reason) || "no reason recorded"}`;
  else if (critical) nextStep = `${critical.reason}: ${critical.detail}`;
  else if (readiness.via === "end") nextStep = S[0] ? `${S[0].reason}` : `On track${a.renewal_date ? `; renewal ${a.renewal_date}` : ""}`;
  else if (readiness.to && readiness.ready) nextStep = `Ready for ${readiness.toLabel}`;
  else if (readiness.to) { const miss = readiness.items.find((i) => !i.ok)!; nextStep = `To reach ${readiness.toLabel}: ${miss.hint ?? miss.label}`; }
  else nextStep = S[0] ? S[0].reason : "Nothing needs attention";
  return { signals: S, readiness, nextStep, conflicts: conf, agreementConflicts: agreementConf };
}

// ---- advancement rules (server validates the same list) --------------------------------------------
export function readinessFor(a: Row, rel: Related, today: string, conf = conflicts(latest(rel.requirements), latest(rel.proposals))): Readiness {
  const p = latest(rel.proposals), req = latest(rel.requirements);
  const items: Gap[] = [];
  const need = (label: string, ok: unknown, hint?: string, anchor?: string) => items.push({ label, ok: !!ok, hint, anchor });
  const states = reviewStates(a, rel);
  const reviewsCurrent = states.every((st) => st.state === "satisfied");
  const stage = s(a.sales_stage), ds = s(a.delivery_status);
  let to: string | null = null, via: Readiness["via"] = "advance";
  const openDated = rel.tasks.filter((t) => t.status === "open" && t.due_date && t.owner_id);

  if (stage === "lost" || ds === "ended") return { from: stage === "lost" ? "lost" : "ended", to: null, toLabel: null, items, ready: false, via: null };
  if (stage === "discovery") {
    to = "proposal";
    need("Customer problem written", s(a.problem).length > 10, "write the problem in the customer's words", "overview");
    need("Customer contact recorded", a.contact, undefined, "overview");
    need("Buyer named or explicitly unknown", a.buyer_status !== "not_assessed", "set buyer status", "overview");
    need("Proposed scope and terms drafted", p && s(p.deliverables) && s(p.price_terms), "create a proposal revision", "scope");
    need("Success criterion defined", p && s(p.success_metric) && n(p.success_target) != null, "metric and target on the proposal", "scope");
    const tv = states.find((x) => x.kind === "technical_validation");
    const unresolvedRestriction = !req || req.restriction_status === "unknown" || conf.length > 0 || clarifications(req, p).some((c) => !c.startsWith("proposed data handling"));
    if (p?.validation_waived_reason) need("Technical validation waived (allowed only with no unresolved data restriction)", !unresolvedRestriction, "record data restrictions first", "scope");
    else need("Technical validation approved for this revision", tv?.state === "satisfied", tv ? tv.why : "request technical validation or waive it with a reason", "approvals");
    need("No review blocked", !states.some((x) => x.state === "blocked"), states.find((x) => x.state === "blocked")?.why, "approvals");
  } else if (stage === "proposal") {
    to = "negotiation";
    need("Proposal marked shared with a date", p?.shared_at, "mark the current revision as shared", "scope");
    need("Buyer named", a.buyer_status === "named" && s(a.buyer), undefined, "overview");
    need("Commercial next action assigned and dated", openDated.some((t) => t.type === "action"), "add a dated action with an owner", "overview");
  } else if (stage === "negotiation") {
    to = "won"; via = "confirm_agreement";
    need("Acceptance evidence and date recorded by a person", false, "use Confirm agreement", "scope");
    need("Agreed scope/terms and success criterion present", p && s(p.deliverables) && s(p.price_terms) && s(p.success_metric), undefined, "scope");
    need("Technical owner assigned", a.technical_owner_id, undefined, "overview");
    need("Accepted revision was shared with the customer (date recorded)", p?.shared_at, "mark the revision as shared", "scope");
    need("Required reviews current and approved", states.length > 0 && reviewsCurrent, states.find((x) => x.state !== "satisfied")?.why ?? (states.length ? undefined : "no review requested"), "approvals");
    need("No explicit data conflict", conf.length === 0, conf[0], "approvals");
    need("Customer data restrictions recorded (unknown is not permission)", req && req.restriction_status !== "unknown", undefined, "requirements");
  } else if (stage === "won" && ds === "onboarding_pending") {
    to = "delivery";
    const h = rel.handoffs.find((x) => x.agreement_id === a.current_agreement_id);
    need("Technical owner accepted the handoff", h?.accepted_at && !h.stale_reason, h?.stale_reason ? `acceptance reopened: ${h.stale_reason}` : undefined, "delivery");
    const dr = states.find((x) => x.kind === "data_handling");
    need("Required data review still valid", !dr || dr.state === "satisfied", dr?.why, "approvals");
    need("First delivery milestone has an owner and date", rel.tasks.some((t) => t.type === "milestone" && t.owner_id && t.due_date), "add a milestone", "delivery");
  } else if (stage === "won" && ds === "delivery") {
    to = "active";
    const reqMs = rel.tasks.filter((t) => t.type === "milestone" && t.required);
    need("Required delivery milestones complete", reqMs.length > 0 && reqMs.every((t) => t.status === "done"), reqMs.length ? `${reqMs.filter((t) => t.status !== "done").length} open` : "mark at least one milestone required", "delivery");
    const o = rel.outcome;
    need("Success measured, or 'not yet measured' reason with a dated measurement task", o && (o.latest != null || (o.not_measured_reason && rel.tasks.some((t) => t.type === "measurement" && t.status === "open" && t.due_date))), "record the outcome", "delivery");
  } else if (stage === "won" && ds === "active") {
    to = "ended"; via = "end";
    need("End date and outcome/reason recorded", false, "use End engagement", "delivery");
  }
  const blockingItems = via === "advance" ? items : items.filter((i) => !/Acceptance evidence|End date/.test(i.label));
  return { from: ds || stage, to, toLabel: to ? STAGE_LABEL[to] : null, items, ready: via !== "end" && blockingItems.every((i) => i.ok), via };
}

// Attention row helper: strongest signal + count of others.
export function attention(ev: Evaluation) {
  const top = ev.signals[0];
  return top ? { top, others: ev.signals.length - 1 } : null;
}
export const SEVERITY_LABEL: Record<Severity, string> = { critical: "Critical", high: "High", warning: "Warning" };
