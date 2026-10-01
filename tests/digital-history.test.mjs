import test from "node:test";
import assert from "node:assert/strict";
import { HistoryStore } from "../src/history.ts";
import { digitalResult, digitalResultId, digitalHistoryOptions, validDigitalHistory } from "../src/digitalHistory.ts";
import { createRoom, viewForPlayer } from "../src/game.ts";
import { finishedDigitalRound } from "./digital-fixture.mjs";

const disk = () => { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) }; };
const store = storage => new HistoryStore(storage, undefined, undefined, digitalHistoryOptions);
function remote() {
  const rows = new Map();
  return { fail: false, async list(owner) { if (this.fail) throw new Error("offline"); return [...rows.values()].filter(r => r.owner === owner).map(({owner: _,...r}) => r); },
    async insert(owner, record) { if (this.fail) throw new Error("offline"); const key = owner + record.id; if (!rows.has(key)) rows.set(key,{...record,owner}); const {owner: _,...saved} = rows.get(key); return saved; },
    async update() { throw new Error("Immutable archive should not need updates"); } };
}

test("only completed results are archived, with a public seat-independent projection", async () => {
  const lobby = createRoom("Guest","TEST1");
  assert.equal(digitalResult(viewForPlayer(lobby,lobby.ownerId),"local"), null);
  const {game,view} = finishedDigitalRound();
  const own = digitalResult(view,"online"), other = digitalResult(viewForPlayer(game,game.players[1].id),"online");
  assert.ok(validDigitalHistory(own));
  assert.deepEqual(own,other);
  assert.equal(await digitalResultId(own),await digitalResultId(other));
  const json = JSON.stringify(own);
  assert.doesNotMatch(json,/"(token|deck|discard|hand|finalHands|pendingExchange)":/);
  assert.ok(!validDigitalHistory({...own,history:[{tricks:[{}]}]}));
});

test("guest archive retains multiple rounds and survives reload without duplicates", async () => {
  const storage = disk(), a = store(storage);
  const one = digitalResult(finishedDigitalRound("TEST1").view,"local");
  const two = {...one,matchId:crypto.randomUUID(),roomCode:"TEST2"};
  for (const g of [one,two,one]) a.append(await digitalResultId(g),g);
  assert.equal(a.getSnapshot().records.length,2);
  const b = store(storage); assert.equal(b.getSnapshot().records.length,2);
  assert.equal(storage.getItem("chicappd-irl-game"),null);
});

test("digital guest migration, retry, sign-out and fresh session reuse the shared engine", async () => {
  const storage = disk(), a = store(storage), cloud = remote();
  const result = digitalResult(finishedDigitalRound().view,"local"), id = await digitalResultId(result);
  a.append(id,result); const guestBackup = storage.getItem("chicappd-digital-history");
  cloud.fail = true; a.setOwner("alice",cloud); await a.sync();
  assert.ok(a.getSnapshot().error);
  assert.equal(storage.getItem("chicappd-digital-history"),guestBackup);
  const b = store(storage); b.setOwner("alice",cloud); await b.sync();
  assert.equal(b.getSnapshot().records.length,1);
  cloud.fail = false; await b.sync(); await b.sync();
  assert.equal((await cloud.list("alice")).length,1);
  b.setOwner(null,null); assert.equal(b.getSnapshot().records[0].id,id);
  b.setOwner("alice",cloud); await b.sync(); b.append(id,result); await b.sync();
  assert.equal((await cloud.list("alice")).length,1);
  const fresh = store(disk()); fresh.setOwner("alice",cloud); await fresh.sync();
  assert.deepEqual(fresh.getSnapshot().records[0].game,result);
  fresh.setOwner("bob",cloud); await fresh.sync(); assert.equal(fresh.getSnapshot().records.length,0);
});

test("late captures stay in the original account or guest backup across auth changes", async () => {
  const storage = disk(), a = store(storage), cloud = remote();
  const result = digitalResult(finishedDigitalRound().view,"local"), id = await digitalResultId(result);
  a.setOwner("alice",cloud); await a.sync(); a.setOwner("bob",cloud); await a.sync();
  a.append(id,result,"alice"); assert.equal(a.getSnapshot().records.length,0);
  a.setOwner("alice",cloud); await a.sync(); assert.equal(a.getSnapshot().records.length,1);
  const guestResult = {...result,matchId:crypto.randomUUID(),roomCode:"NEW11"}; a.append(await digitalResultId(guestResult),guestResult,null); await a.sync();
  assert.equal((await cloud.list("alice")).length,2);
  a.setOwner(null,null); assert.equal(a.getSnapshot().records.length,1);
});
