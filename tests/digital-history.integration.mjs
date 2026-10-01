// Explicit live check using dedicated accounts from the original history check.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadEnv } from "vite";
import { createClient } from "@supabase/supabase-js";
import { authenticateAccount } from "../src/account.ts";
import { HistoryStore, supabaseHistoryRemote } from "../src/history.ts";
import { digitalResult, digitalResultId, digitalHistoryOptions, digitalStatistics } from "../src/digitalHistory.ts";
import { finishedDigitalRound } from "./digital-fixture.mjs";

const env = loadEnv("development", process.cwd(), "VITE_SUPABASE_");
if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) throw new Error("Configure public Supabase values in .env.local first.");
const clients = [];
const client = () => {
  const c = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  clients.push(c); return c;
};
const disk = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) }; };
const store = storage => new HistoryStore(storage, undefined, undefined, digitalHistoryOptions);
const password = "Temporary!HistoryCheck-601-qJ7nS8";
try {
  const a = client(), b = client();
  const userA = (await authenticateAccount(a,"signin","historya_mupp5xxm",password)).user.id;
  await authenticateAccount(b,"signin","historyb_mupp5xxm",password);
  const physical = supabaseHistoryRemote(a), remote = supabaseHistoryRemote(a,digitalHistoryOptions);
  const physicalBefore = await physical.list(userA), before = await remote.list(userA);
  const fixture = finishedDigitalRound(`CHECK-${Date.now()}`);
  fixture.view.players[0].score=55;fixture.view.players[0].hasDeclaredChicago=true;
  const local = digitalResult(fixture.view,"local",fixture.game.ownerId);
  const id = await digitalResultId(local);
  const storage = disk(), guest = store(storage);
  guest.append(id,local);
  const backup = storage.getItem("chicappd-digital-history");
  guest.setOwner(userA,remote); await guest.sync();
  assert.equal(guest.getSnapshot().error,null,"Digital migration must be applied before this check");
  assert.deepEqual((await remote.list(userA)).find(r => r.id === id).game,local);
  assert.equal(storage.getItem("chicappd-digital-history"),backup);
  await guest.sync(); guest.setOwner(null,null);
  assert.equal(guest.getSnapshot().records.length,1);
  guest.setOwner(userA,remote); await guest.sync();
  assert.equal((await remote.list(userA)).length,before.length+1);
  const stats=digitalStatistics(guest.getSnapshot().records,"historya_mupp5xxm");
  assert.equal(digitalStatistics(guest.getSnapshot().records.filter(r=>r.id===id)).wins,1);
  const reloaded = store(storage); reloaded.setOwner(userA,remote); await reloaded.sync();
  assert.ok(reloaded.getSnapshot().records.some(r => r.id === id));
  console.log("Live guest import, reload, sign-out guest restoration and duplicate-free sign-in passed.");

  const freshClient = client(); await authenticateAccount(freshClient,"signin","historya_mupp5xxm",password);
  const fresh = store(disk()); fresh.setOwner(userA,supabaseHistoryRemote(freshClient,digitalHistoryOptions)); await fresh.sync();
  assert.deepEqual(fresh.getSnapshot().records.find(r => r.id === id).game,local);
  assert.deepEqual(digitalStatistics(fresh.getSnapshot().records,"historya_mupp5xxm"),stats);
  console.log("Aggregated statistics survive guest merge, repeated sign-in and a fresh authenticated session.");
  const failed = {...remote,list:async () => { throw new TypeError("offline"); }};
  reloaded.setOwner(userA,failed);
  const online = {...local,source:"online",sourceRevision:1,roomCode:`ONLINE-${Date.now()}`};
  const onlineId = await digitalResultId(online); reloaded.append(onlineId,online); await reloaded.sync();
  assert.ok(reloaded.getSnapshot().error);
  const retry = store(storage); retry.setOwner(userA,remote); await retry.sync();
  assert.equal(retry.getSnapshot().error,null);
  assert.deepEqual((await remote.list(userA)).find(r => r.id === onlineId).game,online);
  assert.equal((await remote.list(userA)).length,before.length+2);
  console.log("Fresh authenticated session and failed-sync local queue/retry passed for local and online result formats.");

  const read = await b.from("irl_history").select("id").eq("owner_id",userA).eq("id",id);
  assert.equal(read.error,null); assert.deepEqual(read.data,[]);
  const insert = await b.from("irl_history").insert({owner_id:userA,id:randomUUID(),revision:id,game:local,updated_at:new Date().toISOString()});
  assert.equal(insert.error?.code,"42501");
  for (const query of [b.from("irl_history").update({game:online}).eq("owner_id",userA).eq("id",id).select("id"),
    b.from("irl_history").delete().eq("owner_id",userA).eq("id",id).select("id")]) {
    const result = await query; assert.equal(result.error,null); assert.deepEqual(result.data,[]);
  }
  assert.deepEqual(await physical.list(userA),physicalBefore);
  console.log("Digital cross-user SELECT/INSERT/UPDATE/DELETE denied; existing physical-card records unchanged.");
  console.log("All live digital history checks passed. Only two new dedicated result fixtures were added.");
} catch (error) {
  console.log(JSON.stringify({liveDigitalCheckFailed:true,code:error?.code ?? error?.name ?? "unknown",assertion:error?.operator}));
  process.exitCode = 1;
} finally {
  for (const c of clients) { await c.auth.signOut({scope:"local"}); await c.auth.stopAutoRefresh(); }
}
