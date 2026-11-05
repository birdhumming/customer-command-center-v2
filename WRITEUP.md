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

_(filled in after the persona sessions report)_

## 8. Three bullets on design and tradeoffs

1. **Revisions, snapshots and bound reviews instead of editable fields.** Proposals and customer restrictions are immutable revisions; the accepted agreement is a snapshot; every review records which revisions it approved. A material edit therefore cannot silently keep an approval, and "what did we agree" has exactly one answer. Cost: more rows and a small diff view; benefit: the Lattice "weekly reports dropped at 23:40" problem becomes a visible proposed change rather than a memory.
2. **One pure evaluator, read-time signals, write-time tasks.** `evaluateAccount` computes readiness and signals on every page load, so time-based alerts are never stale and no "health score" is stored; the only writes automation performs are deduplicated tasks keyed by (account, rule, subject). Cost: every list page evaluates every account (fine at this scale); benefit: rules are testable in one file and explainable on one page.
3. **Rules compute, people decide, and the decision surface is small.** Six human acts carry weight: confirm agreement, decide review, accept handoff, assess health, record measurement, end engagement. Everything else is derived. Deliberately not built: charts, integrations, transcripts, AI health, drag-and-drop, uploads, workflow configuration, multiple deals per account, notifications, real auth.
