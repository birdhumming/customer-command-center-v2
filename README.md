# Customer Command Center v2

Internal workspace for a small team selling and delivering AI-agent evaluation and improvement services. The primary question it answers: **what needs my attention, why, and what should I do next?**

- Live: https://devinbugbasher--727ba386d8cb11f181b81607ee4eb77e.web.val.run (passcode `evalhouse-v2`, then pick the role you are acting as: Sales, Engineering or Delivery)
- Write-up and design decisions: [WRITEUP.md](WRITEUP.md)
- Shared persistence: one SQLite database on Val Town; every change is visible to the next browser.

Public self-serve page: `/grade` (no passcode) — a prospect grades 5-20 pasted outputs and becomes a Discovery lead.

## Run locally
```
deno task dev        # http://localhost:8010, seeds on first start (passcode: evalhouse)
deno task test       # acceptance tests against app.fetch with a throwaway DB
deno task reseed     # reset the shared scenario
VALTOWN_API_TOKEN=... deno run -A deploy.ts --passcode <passcode>
```

## Files
`rules.ts` pure evaluator and advancement rules · `main.ts` routes and transactions · `views.ts` server-rendered HTML · `schema.ts` tables · `seed.ts` five scenarios · `db.ts` SQLite adapter (node:sqlite locally, Val Town libsql hosted) · `app_test.ts` spec acceptance tests.
