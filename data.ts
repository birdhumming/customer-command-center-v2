import type { DB, Row } from "./db.ts";
import type { Related } from "./rules.ts";

export function todayISO() { return new Date().toLocaleDateString("en-CA", { timeZone: Deno.env.get("CCC_TZ") ?? "America/Los_Angeles" }); }

const ACC = `SELECT a.*, o.name AS owner_name, t.name AS technical_owner_name FROM cc2_accounts a JOIN cc2_users o ON o.id=a.owner_id LEFT JOIN cc2_users t ON t.id=a.technical_owner_id`;
export async function loadAccount(d: DB, id: string): Promise<Row | undefined> { return await d.get(`${ACC} WHERE a.id=?`, [id]); }
export async function loadAccounts(d: DB): Promise<Row[]> { return await d.all(`${ACC} ORDER BY a.name`); }
export async function users(d: DB): Promise<Row[]> { return await d.all("SELECT * FROM cc2_users ORDER BY name"); }

export async function loadRelated(d: DB, id: string, us?: Row[]): Promise<Related> {
  const [proposals, requirements, reviews, agreements, handoffs, tasks, meetings, blockers, outcome, userRows] = await Promise.all([
    d.all("SELECT * FROM cc2_proposals WHERE account_id=? ORDER BY revision DESC", [id]),
    d.all("SELECT * FROM cc2_requirements WHERE account_id=? ORDER BY revision DESC", [id]),
    d.all("SELECT r.*, u.name AS reviewer_name FROM cc2_reviews r LEFT JOIN cc2_users u ON u.id=r.reviewer_id WHERE account_id=? ORDER BY requested_at DESC", [id]),
    d.all("SELECT g.*, u.name AS accepted_by_name FROM cc2_agreements g JOIN cc2_users u ON u.id=g.accepted_by WHERE account_id=? ORDER BY accepted_at DESC", [id]),
    d.all("SELECT h.*, u.name AS accepted_by_name FROM cc2_handoffs h LEFT JOIN cc2_users u ON u.id=h.accepted_by WHERE account_id=? ORDER BY created_at DESC", [id]),
    d.all("SELECT t.*, u.name AS owner_name FROM cc2_tasks t LEFT JOIN cc2_users u ON u.id=t.owner_id WHERE account_id=? ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, due_date IS NULL, due_date", [id]),
    d.all("SELECT m.*, u.name AS author_name FROM cc2_meetings m LEFT JOIN cc2_users u ON u.id=m.author_id WHERE account_id=? ORDER BY occurred_at DESC", [id]),
    d.all("SELECT b.*, u.name AS owner_name FROM cc2_blockers b LEFT JOIN cc2_users u ON u.id=b.owner_id WHERE account_id=? ORDER BY resolved_at IS NOT NULL, opened_at", [id]),
    d.get("SELECT * FROM cc2_outcomes WHERE account_id=?", [id]),
    us ? Promise.resolve(us) : users(d),
  ]);
  return { proposals, requirements, reviews, agreements, handoffs, tasks, meetings, blockers, outcome: outcome ?? null, users: userRows };
}
export async function activity(d: DB, id: string): Promise<Row[]> {
  return await d.all("SELECT x.*, u.name AS actor_name FROM cc2_activity x LEFT JOIN cc2_users u ON u.id=x.actor_id WHERE account_id=? ORDER BY at DESC", [id]);
}
