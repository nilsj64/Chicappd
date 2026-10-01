// Explicit live check: creates two dedicated test accounts and only their own data.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadEnv } from "vite";
import { createClient } from "@supabase/supabase-js";
import { accountIdentifier, authenticateAccount } from "../src/account.ts";
import { HistoryStore, supabaseHistoryRemote } from "../src/history.ts";
import { createIRLGame, correctIRLScore } from "../src/irl.ts";
import { defaultSettings } from "../src/scoring.ts";

const env = loadEnv("development", process.cwd(), "VITE_SUPABASE_");
if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) throw new Error("Configure public Supabase values in .env.local first.");
const clients = [];
const makeClient = () => {
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  clients.push(client); return client;
};
const memoryStorage = () => {
  const values = new Map();
  return { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
};
const stamp = Date.now().toString(36);
const names = [`historya_${stamp}`, `historyb_${stamp}`];
// Empty test accounts only; no personal data or private project credentials.
const password = "Temporary!HistoryCheck-601-qJ7nS8";
try {
  const a = makeClient(), b = makeClient(), anon = makeClient();
  const userA = (await authenticateAccount(a, "signup", names[0], password)).user.id;
  const userB = (await authenticateAccount(b, "signup", names[1], password)).user.id;
  console.log("Dedicated live test accounts:", names.join(", "));
  const remote = supabaseHistoryRemote(a);
  const createGame = () => createIRLGame(["Synktest Ada", "Synktest Bo"], defaultSettings);
  const existing = { id: randomUUID(), revision: randomUUID(), game: correctIRLScore(createGame(), "irl-1", 25), updated_at: new Date().toISOString() };
  await remote.insert(userA, existing);
  const disk = memoryStorage();
  disk.setItem("chicappd-irl-game", JSON.stringify(correctIRLScore(createGame(), "irl-1", 9)));
  const guestCopy = disk.getItem("chicappd-irl-game");
  const store = new HistoryStore(disk);
  store.setOwner(userA, remote); await store.sync();
  assert.equal(store.getSnapshot().error, null);
  assert.equal((await remote.list(userA)).length, 2);
  const id = store.getSnapshot().selectedId;
  assert.ok(id);
  store.setGame(current => correctIRLScore(current, "irl-1", 17)); await store.sync();
  assert.equal(store.getSnapshot().error, null);
  assert.equal(disk.getItem("chicappd-irl-game"), guestCopy);
  store.setOwner(null, null);
  assert.equal(store.getSnapshot().records[0].game.players[0].score, 9);
  store.setOwner(userA, remote); await store.sync();
  assert.equal((await remote.list(userA)).length, 2);
  assert.equal(store.getSnapshot().records.find(r => r.id === id).game.players[0].score, 17);
  console.log("Guest migration, cloud merge, edits, sign-out state and idempotent sign-back-in passed.");

  const freshClient = makeClient();
  await authenticateAccount(freshClient, "signin", names[0], password);
  const fresh = new HistoryStore(memoryStorage());
  fresh.setOwner(userA, supabaseHistoryRemote(freshClient)); await fresh.sync();
  assert.equal(fresh.getSnapshot().error, null);
  assert.equal(fresh.getSnapshot().records.find(r => r.id === id).game.players[0].score, 17);
  console.log("Fresh authenticated session on empty device restored the cloud match and undo history.");

  const read = await b.from("irl_history").select("*").eq("owner_id", userA);
  assert.equal(read.error, null); assert.deepEqual(read.data, []);
  const insert = await b.from("irl_history").insert({ owner_id: userA, ...existing, id: randomUUID() });
  assert.equal(insert.error?.code, "42501");
  const update = await b.from("irl_history").update({ revision: randomUUID(), game: createGame() }).eq("owner_id", userA).eq("id", id).select("id");
  assert.equal(update.error, null); assert.deepEqual(update.data, []);
  const remove = await b.from("irl_history").delete().eq("owner_id", userA).eq("id", id).select("id");
  assert.equal(remove.error, null); assert.deepEqual(remove.data, []);
  const anonymousRead = await anon.from("irl_history").select("id");
  assert.equal(anonymousRead.error?.code, "42501");
  const ownerRewrite = await a.from("irl_history").update({ owner_id: userB }).eq("owner_id", userA).eq("id", id);
  assert.equal(ownerRewrite.error?.code, "42501");
  assert.equal((await remote.list(userA)).find(r => r.id === id).game.players[0].score, 17);
  const ownId = randomUUID();
  assert.equal((await b.from("irl_history").insert({ owner_id: userB, ...existing, id: ownId })).error, null);
  assert.equal((await b.from("irl_history").update({ revision: randomUUID() }).eq("owner_id", userB).eq("id", ownId)).error, null);
  const ownDelete = await b.from("irl_history").delete().eq("owner_id", userB).eq("id", ownId).select("id");
  assert.equal(ownDelete.error, null); assert.equal(ownDelete.data.length, 1);
  console.log("Live RLS passed: cross-user SELECT/INSERT/UPDATE/DELETE blocked; anonymous denied; own CRUD allowed; owner UUID immutable.");

  const unreliable = { ...remote, list: async () => { throw new TypeError("offline"); } };
  fresh.setOwner(userA, unreliable);
  fresh.setGame(current => correctIRLScore(current, "irl-1", 18)); await fresh.sync();
  assert.ok(fresh.getSnapshot().error);
  assert.equal(fresh.getSnapshot().records.find(r => r.id === fresh.getSnapshot().selectedId).game.players[0].score, 18);
  fresh.setOwner(userA, remote); await fresh.sync();
  assert.equal(fresh.getSnapshot().error, null);
  console.log("Simulated network failure retained local changes; retry reached live Supabase.");
  console.log("All live history checks passed. Only dedicated test data was created/changed.");
} catch (error) {
  console.log(JSON.stringify({ liveHistoryCheckFailed: true, code: error?.code ?? error?.name ?? "unknown", assertion: error?.operator }));
  process.exitCode = 1;
} finally {
  for (const client of clients) { await client.auth.signOut({ scope: "local" }); await client.auth.stopAutoRefresh(); }
}
