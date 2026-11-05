# Customer Command Center v2 — what was built, what decides, what stays human

Live: https://devinbugbasher--727ba386d8cb11f181b81607ee4eb77e.web.val.run · passcode `evalhouse-v2` · source: https://github.com/birdhumming/customer-command-center-v2

## 1. Product decision

Internal workspace for a three-person team selling and delivering AI-agent evaluation services. One question on every screen: what needs my attention, why, and what should I do next. Two navigation items (My work, Accounts), one account page with three tabs. No charts, no kanban, no portal.

Operating principle, unchanged from the spec: the application automates bookkeeping, readiness checks, risk detection and the preparation of human decisions. Humans confirm customer agreements, technical feasibility, data permissions, handoff acceptance, relationship health, measurements and endings.

## 2. What is automated and what is not

| Concern | Automated | Human | Why the line is here |
|---|---|---|---|
| Stage readiness | Checklist computed per stage from records; server rejects an advance with the missing list | Clicking Advance | Filling the last field must not move a deal; a person owns the claim "ready" |
| Won | Never set by dropdown | Confirm agreement with evidence note/link and date | Won is a customer act; the app records who claimed it and on what evidence, it does not verify the evidence |
| Scope and terms | Revisions are immutable; accepted agreement is a snapshot; later edits are "proposed change" | Writing the revision; accepting an amendment | Sales and delivery cannot disagree about what was agreed because there is exactly one accepted text |
| Technical / data review | Request creates one task bound to (proposal rev, requirements rev); material change reopens the same task with the diff | Approved / Approved with conditions / Blocked, with a note; checking conditions off | The reviewer decides; the app guarantees they decide on the current revision |
| Data restrictions | Explicit mismatch (customer says no external processing, proposal names a processor; no training vs training; no retention vs retention) → Critical | Recording the customer's exact wording; interpreting custom wording | Only contradictions are decidable by rule; "unknown" and "custom" produce a clarification task, never approval |
| Handoff | Generated from the agreement at confirmation; one acceptance task for the technical owner; amendment reopens acceptance | Technical owner accepts with a note | The packet is a view of the agreement, not a second editable document |
| Overdue commitments | Incomplete committed task past due → High, owned by the task owner; counted in the one metric | Marking a task committed; completing it | Commitments are promises to a customer; the owner must claim completion |
| Stalled / missing next step | 14 days without customer contact; no dated open action → Warning | Logging the meeting; adding the action | Cheap to compute, cheap to clear |
| Delivery intervention | Open blocker + overdue committed milestone → one High | Requesting the delivery-plan review | Two facts together mean the plan is wrong, not the task |
| Renewal | ≤30 days (or past) and latest comparable result missing or below target → High | Success review, renewal proposal | The app will not infer success from task completion |
| Success | NULL means unknown; a different evaluation basis is "not comparable", never improvement | Entering baseline, latest, basis | Measurement is the only evidence; changing the ruler is not progress |
| Relationship health | Never computed | Unknown / Healthy / Watch / At risk with reason and date | Automatic warnings stay visible next to it; Healthy cannot hide them |
| Concurrency | Versioned edits; stale save rejected with a recoverable message | Reloading and re-saving | Shared data, no locks |

Nothing sends external messages. Nothing is hidden by snoozing (not built).

## 3. Rules (all in `rules.ts`, pure, re-evaluated on every read)

`evaluateAccount(account, related, today)` returns readiness (next transition, items, ready/blocked) and signals `{key, severity, reason, ownerId, actionType, subjectId}`.

Transitions and gates:

| From → To | Required |
|---|---|
| Discovery → Proposal | problem; contact; buyer named or explicitly unknown; proposal revision with deliverables and price; success metric + target; technical validation approved for this revision, or waived with reason when no unresolved restriction exists |
| Proposal → Negotiation | revision marked shared with date; buyer named; dated commercial action with owner |
| Negotiation → Won | only via Confirm agreement: evidence + date; technical owner; every required review satisfied for the current revisions; no explicit data conflict |
| Onboarding pending → Delivery | handoff accepted (not reopened); required data review still valid; first milestone with owner and date |
| Delivery → Active | required milestones done; outcome measured, or "not yet measured" reason plus a dated measurement task |
| Active → Ended | reason and date (End engagement) |

Skipping forward is rejected. Backward presales moves need a reason. Lost needs a reason and is presales-only. Unknown budget and missing baseline are warnings, not blockers.

Signals, strongest first: critical (data conflict with proposal → "Proposed change requires review"; with the accepted agreement → "Current agreement needs review"), high (reopened review, stale approval, blocked review, overdue commitment, handoff pending, delivery intervention, renewal intervention, unassigned reviewer), warning (pending review, clarification, stalled prospect, missing next step, open blocker, budget unknown, baseline missing, renewal step missing). Needs attention shows one row per account: strongest reason, count of others, responsible person, one action.

Automation tasks are unique per (account, rule, subject); re-requests reopen the same row. Review tasks close only through a decision; handoff tasks only through acceptance.

## 4. Data model

12 tables, UUID keys, versions on mutable rows: users, accounts, proposals (immutable revisions incl. handling JSON), requirements (immutable revisions), reviews (bound to revision ids, conditions JSON), agreements (snapshot: proposal + requirements + evidence + who/when, supersedes), handoffs (one per agreement, acceptance fields, stale_reason), tasks (action | milestone | measurement | review | handoff; committed, required, automation_key, subject_id), meetings (date, summary, author), blockers, outcomes (one per account; baseline/latest with bases; not_measured_reason), activity (append-only).

## 5. Seed

Five accounts, three teammates, dates relative to seed day so the conditions hold on any day:

| Account | State | What it exercises |
|---|---|---|
| Northstar Support | Discovery | custom ZDR wording vs grader audit log → data review pending for Leo; buyer unknown; validation not yet requested |
| Atlas Commerce | Negotiation | rev 2 added an external grader after rev 1 approvals → data review reopened, validation stale; competing with Northstar on Leo's list |
| Harbor Operations | Won, onboarding pending | handoff awaiting Priya; SSO blocker; no baseline yet |
| Meridian Services | Active | renewal in 21 days at 71% vs 80%; Leo's committed regression report 4 days late; upcoming re-index will change the basis |
| Cedar Analytics | Active | target met; expansion ask with a dated owner; the quiet control case |

## 6. Deviations from the spec and assumptions

1. Hosting is Val Town + SQLite (libsql) rather than hosted PostgreSQL: no Postgres credentials were available; the shared-persistence guarantee is the same and the adapter is one file. Val Town's SQLite is shared across vals on the account, so tables are prefixed `cc2_`.
2. Identity is a shared passcode plus a teammate selector. Ownership rules (only the technical owner accepts a handoff, only the reviewer checks conditions) are enforced against the selected identity; this is attribution, not authentication.
3. Dates are date-only, interpreted in America/Los_Angeles. "Today" on the server uses that zone.
4. Acceptance evidence is a typed note or link; the app labels it "as recorded, not verified".
5. Renewal uses one date; notice periods are the owner's job to encode as the renewal date (see adverse-review findings).

## 7. Adverse review

Two reviewer sessions worked the live app with the earlier messy scenarios (Halden Health, Lattice Payroll, Thistle & Vine, Kessler Roth, Caldera Freight) plus raw POSTs.

### 7.1 Hiring manager — "HIRE (lean, not strong)" before fixes

Held: stage skipping, Lost from Won, three concurrent Confirm agreement → one agreement, deciding a closed review, closing a review task via the checkbox, waiving validation with unknown restrictions, accepting a handoff as the wrong person.

| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | Anyone could decide any review; sales could self-approve | blocker | Decide requires `me == reviewer_id`; technical/data reviews need a non-sales role (request and decide) |
| 2 | Missing identity cookie fell back to the first user | blocker | POST without a valid identity → 403; no fallback |
| 3 | `unknown` restrictions let Caldera reach Won with no data review; specified→unknown erased a Critical | blocker | Data review required unless restrictions are explicitly "none stated" (with evidence); Won gate requires restrictions recorded; specified→unknown rejected; clarification warnings no longer suppressed post-sale |
| 4 | Version check was opt-in (missing `version` → accepted) | major | Missing/garbled version is treated as stale |
| 5 | Sales could set themselves as technical owner, accept their own handoff, then clear the owner | major | Technical owner must be non-sales; cannot be cleared on a Won account |
| 6 | Lost/Ended accounts fully writable | major | Read-only except stage change (reopen with reason) |
| 7 | Two 500s (bogus owner on blockers, on meeting follow-up) | major | Owners validated; fallback to account/technical owner |
| 8 | Dates: `9999-12-31` stored, `2025-02-30` stored, invalid dates silently replaced by today | major | Strict round-trip validation, 2000–2100, future meetings/acceptance/measurement rejected, never substituted |
| 9 | Enum fields were free text; `success_target=abc` → NULL silently; negative budget | major | Enums validated on proposals and requirements; non-numeric target rejected; budget 0–1e9 |
| 10 | Handoff did not show what rev 1 promised that the accepted rev dropped (Lattice "weekly reports") | major | Handoff section "Changed before acceptance": change notes and rev-1→accepted field diffs |
| 11 | Renewal had no notice period; expansion was an unowned note | major | `renewal_notice_days`; renewal signals run against the decision deadline; expansion note without an owned action → warning |
| 12 | Post-sale risk thin: below target outside 30d, never-met customer, one-click "Mark done" on a commitment from My work | major | `below_target` and `checkin_overdue` (30d) signals; My work links to the commitment instead of completing it |
| 13 | Could not express "waiting on counsel until the 14th" vs stalled | major | Actions can be "waiting on customer": suppresses stalled while pending, becomes "Customer late" when past due, never counts as our commitment |
| 14 | Errors from Scope/Delivery forms lost the tab (`?tab=scope?err=`) | minor | `back()` joins query params correctly |
| 15 | Blocker "open -1d" (UTC vs LA) | minor | Blocker open date recorded in LA |
| 16 | Stale message named only the proposal revision | minor | Names proposal and restrictions revisions |

Not fixed, by choice: meeting attendees (so "buyer never in a meeting" is still a note), a baseline field on the proposal (contested baselines live in `success_basis`), unresolved commercial terms as structured items (uncapped indemnity is prose in `price_terms`), amendments that widen scope at the same price are not flagged, and the three unconsumed review kinds remain selectable.

### 7.2 RevOps working day — "No, not this quarter; fix three and I'd pilot it" before fixes

| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | No way to enter an existing customer without faking a sale; Thistle's notice clause lived in the problem sentence | required | Add account has an "Existing customer" section: contract scope, price, success criterion, technical owner (non-sales), contract reference, start, renewal date and notice period → rev 1 + agreement snapshot marked backfilled, delivery status Active/Delivery, outcome seeded with the target; no handoff is generated; restrictions still unknown until recorded |
| 2 | Unowned actions silently became the account owner's; reopening a review overwrote the previous decision and checked conditions | required | Blank owner is stored as unowned and raises "Unowned action"; a commitment must have an owner. Reopen appends the prior decision to `reviews.history`, shown on the review as "Earlier decisions (kept, not overwritten)" |
| 3 | Seed reset behind the shared team passcode on a help page; rejected forms lost what was typed | required | Reset moved to `/admin` behind a separate `CCC_ADMIN_PASSCODE`. Rejected saves restore the typed values into the same form (fresh version from the server) and open the drawer |
| 4 | Blocked data review did not gate Discovery → Proposal | high | "No review blocked" is a Discovery gate item |
| 5 | Price-only revision made approvals stale with no task for Leo | high | Price/dates-only revisions carry approved/conditional reviews forward (logged); scope, success criterion and data-handling changes still reopen them |
| 6 | "Shared with customer" pre-checked on the revision form, so new revisions were recorded as shared on a date they were not | high | Never pre-checked; Won now also requires the accepted revision to have a shared date |
| 7 | New measurement overwrote the previous; no series, basis change lost the pre-swap number | high | Append-only `measurements`; history shown under Measured success with a "differs from baseline basis" marker; the outcome still has one operative latest value |
| 8 | Health "reviewed" and other timestamps rendered in UTC against a Pacific today | low | Timestamps render as Pacific dates; health review date stored as the Pacific date |
| 9 | Harbor "Ready for Delivery" with a blocker open 6 days | med | Not changed: an open blocker is a warning, not a gate; the team decides whether to start delivery around it |
| 10 | Add account has no stakeholder list / legal asks / "contested baseline" flag | med | Not changed: stakeholders and open commercial terms stay in prose this version (see §9) |

Confirmed working on the fixed build by the reviewer: "waiting on customer" (Halden), two-tab stale save rejected with the conflicting value kept, relative alert dates current on refresh, Healthy not hiding warnings, v4 measurement shown as not comparable.

## 8. Three bullets on design and tradeoffs

1. **Revisions, snapshots and bound reviews instead of editable fields.** Proposals and customer restrictions are immutable revisions; the accepted agreement is a snapshot; every review records which revisions it approved. A material edit therefore cannot silently keep an approval, and "what did we agree" has exactly one answer. Cost: more rows and a small diff view; benefit: the Lattice "weekly reports dropped at 23:40" problem becomes a visible proposed change rather than a memory.
2. **One pure evaluator, read-time signals, write-time tasks.** `evaluateAccount` computes readiness and signals on every page load, so time-based alerts are never stale and no "health score" is stored; the only writes automation performs are deduplicated tasks keyed by (account, rule, subject). Cost: every list page evaluates every account (fine at this scale); benefit: rules are testable in one file and explainable on one page.
3. **Rules compute, people decide, and the decision surface is small.** Six human acts carry weight: confirm agreement, decide review, accept handoff, assess health, record measurement, end engagement. Everything else is derived. Deliberately not built: charts, integrations, transcripts, AI health, drag-and-drop, uploads, workflow configuration, multiple deals per account, notifications, real auth.
