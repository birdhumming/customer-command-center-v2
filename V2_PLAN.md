# v2 build plan (working notes; spec at /home/ubuntu/attachments/e2148a29-54fc-47e6-9f6b-3981846d4ce0/pasted-1793849353422.txt)

Done: db.ts (DB with tx), schema.ts (11 tables + handoffs), rules.ts (evaluateAccount, readinessFor, conflicts/clarifications, reviewStates, outcomeStatus), data.ts (loaders, todayISO Pacific), seed.ts (5 spec accounts, users maya/leo/priya), deploy.ts (copied from v1; val name must change to customer-command-center-v2 and new .valtown-id).

TODO main.ts (Hono, npm:hono@4.6.14; passcode cookie as v1 with sha256; identity cookie ccc_me = user id; helper ctx(c) -> {d, me, today}):
- GET /login, POST /login(next), POST /me
- GET /  My work: owner selector (me|all), search, metric "Open commitments overdue: X / Y" (committed open tasks, due<today / all; owner filter; em dash if Y=0), Needs attention rows (accounts with signals; critical>high>oldest; strongest reason · +N others · responsible · one action button), My actions (open tasks owner=me incl. reviews/handoffs on others' accounts; overdue, today, upcoming; complete inline; review/handoff open decision panel), My pipeline / My customers switch (?view=pipeline|customers).
- GET /accounts  table + filters owner, presales/post, stage, needs-attention, search; Clear filters; empty states.
- GET /accounts/new, POST /accounts (name + owner required; stage discovery; optional contact/problem)
- GET /accounts/:id?tab=overview|scope|delivery  header (name, owner, tech owner, stage chip -> readiness panel, Log meeting, Add action), next-step banner (ev.nextStep), tabs.
- POST /accounts/:id (small forms: overview fields, owners, health+reason, renewal/expansion) with expected version -> 409 page preserving draft.
- POST /accounts/:id/meetings (date, summary, optional action title/owner/due) in one tx; updates last_customer_contact_at.
- POST /accounts/:id/tasks (title, owner default account owner, due, committed toggle, type action|milestone|measurement; milestone committed by default); POST /tasks/:id/done (not for review/handoff types -> use decision endpoint), POST /tasks/:id (edit w/ version).
- POST /accounts/:id/blockers, POST /blockers/:id/resolve
- POST /accounts/:id/proposals (new revision prefilled from latest; fields incl. handling JSON pieces; change_note; mark shared; waive validation reason). Material change (deliverables/handling/price/success) -> reopen applicable reviews (status open, reopened_reason, task reopened) via ensureReviewTask.
- POST /accounts/:id/requirements (new revision) -> reopens data_handling review if specified; if conflicts with current agreement -> signal only ("Current agreement needs review").
- POST /accounts/:id/reviews (request: kind, reviewer default tech owner, question) -> ensureReviewTask (unique automation_key='review', subject=review id); if no tech owner -> task for account owner "Assign technical reviewer" (automation_key 'assign_reviewer').
- GET /reviews/:id (decision panel: question, scope rev, requirements, diff vs prior approved revision), POST /reviews/:id/decide (approved|conditional(conditions lines)|blocked + note) -> closes task; POST /reviews/:id/conditions (check off).
- POST /accounts/:id/stage (to, reason for backward/lost) server validates readinessFor; forward skipping rejected; lost from presales with reason; backward presales with reason.
- POST /accounts/:id/agreements (confirm: evidence + date) tx: validate negotiation readiness (except evidence item), insert agreement, set current_agreement_id, sales_stage won, delivery_status onboarding_pending, create handoff + handoff task for tech owner (UNIQUE(agreement_id) and UNIQUE(account_id,proposal_id) => idempotent), outcome row from proposal success fields. Amendment: same endpoint when agreement exists -> supersedes, reopen handoff acceptance (stale_reason), don't touch tasks, list milestones "may need adjustment".
- GET /accounts/:id/handoff (renders by reference) POST /handoffs/:id/accept (only tech owner) -> task done.
- POST /accounts/:id/outcome (baseline/basis/target/latest/basis/measured_at/not_measured_reason; version) ; POST /accounts/:id/end (reason, date).
- GET /how-alerts-work (small panel content also inline on My work via details).
- Every mutation: activity row; redirect back with ?saved=1 or ?err=.
- 409: compare `version` hidden field; on mismatch render form with error + Reload link, keep draft.

views.ts: layout (nav: My work, Accounts; owner selector = identity; restrained CSS from v1), myWork, accountsList, accountDetail (3 tabs), reviewPanel, handoffPage, forms as <details> drawers. Colours: red = intervention (critical/high), amber = warning; every label has text.

tests: rules_test.ts table-driven (evaluator cases per seed + advancing with stale review rejected + clock advance + dedupe), plus route tests via app.fetch (409, double confirm -> one handoff).
Then: deploy (new val), acceptance tests 1-10 via curl, GitHub push (new repo birdhumming/customer-command-center-v2 or replace), persona review children with v1 scenarios, write-up WRITEUP.md in spec style.
