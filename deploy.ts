// Deploy to Val Town via the REST API: creates the val once (id cached in .valtown-id), then upserts every source file.
// Usage: VALTOWN_API_TOKEN=... deno run -A deploy.ts [--name customer-command-center] [--passcode ...]
const token = Deno.env.get("VALTOWN_API_TOKEN") ?? Deno.env.get("VAL_TOWN_API_KEY");
if (!token) throw new Error("set VALTOWN_API_TOKEN");
const argv = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
const name = argv.name ?? "customer-command-center-v2";
const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch("https://api.val.town" + path, { method, headers: H, body: body == null ? undefined : JSON.stringify(body) });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${txt.slice(0, 300)}`);
  return txt ? JSON.parse(txt) : null;
};
let id = "";
try { id = (await Deno.readTextFile(".valtown-id")).trim(); } catch { /* first deploy */ }
if (!id) {
  const v = await api("POST", "/v2/vals", { name, privacy: "public", description: "Customer Command Center v2" });
  id = v.id; await Deno.writeTextFile(".valtown-id", id);
  console.log("created val", id);
}
const files = ["main.ts", "views.ts", "views_public.ts", "rules.ts", "data.ts", "db.ts", "schema.ts", "seed.ts", "README.md"];
const existing = new Set(((await api("GET", `/v2/vals/${id}/files?path=&recursive=true&limit=100`)).data as { path: string }[]).map((f) => f.path));
for (const f of files) {
  let content: string;
  try { content = await Deno.readTextFile(f); } catch { continue; }
  const type = f === "main.ts" ? "http" : "file";
  const q = `/v2/vals/${id}/files?path=${encodeURIComponent(f)}`;
  const res = existing.has(f) ? await api("PUT", q, { content, type }) : await api("POST", q, { content, type });
  if (f === "main.ts") console.log("endpoint:", res?.links?.endpoint);
  console.log("uploaded", f, content.length);
}
for (const [flag, key] of [["passcode", "CCC_PASSCODE"], ["admin", "CCC_ADMIN_PASSCODE"]] as const) {
  if (!argv[flag]) continue;
  try { await api("POST", `/v2/vals/${id}/environment_variables/`, { key, value: argv[flag] }); }
  catch { await api("PUT", `/v2/vals/${id}/environment_variables/${key}`, { value: argv[flag] }); }
  console.log(key, "set");
}
const v = await api("GET", `/v2/vals/${id}`);
console.log("val page:", v.links?.html);
