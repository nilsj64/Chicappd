import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { HistoryStore } from "../src/history.ts";
import { createIRLGame, correctIRLScore, undoIRL } from "../src/irl.ts";
import { defaultSettings } from "../src/scoring.ts";

function storage() {
  const values = new Map();
  return { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
}
function remote() {
  const owners = new Map();
  const rows = owner => { if (!owners.has(owner)) owners.set(owner, new Map()); return owners.get(owner); };
  return {
    fail: false,
    inserts: 0,
    async list(owner) { if (this.fail) throw new Error("offline"); return [...rows(owner).values()].map(r => structuredClone(r)); },
    async insert(owner, record) {
      if (this.fail) throw new Error("offline"); this.inserts++;
      if (!rows(owner).has(record.id)) rows(owner).set(record.id, structuredClone(record));
      return structuredClone(rows(owner).get(record.id));
    },
    async update(owner, record, revision) {
      if (this.fail) throw new Error("offline");
      if (rows(owner).get(record.id)?.revision !== revision) return null;
      const saved = { id: record.id, revision: record.revision, game: record.game, updated_at: record.updated_at };
      rows(owner).set(record.id, structuredClone(saved)); return saved;
    },
  };
}
const game = () => createIRLGame(["Ada", "Bo"], defaultSettings);
const selected = store => store.getSnapshot().records.find(r => r.id === store.getSnapshot().selectedId)?.game;
const seed = async (cloud, owner, score = 20) => {
  const record = { id: randomUUID(), revision: randomUUID(), game: correctIRLScore(game(), "irl-1", score), updated_at: new Date().toISOString() };
  await cloud.insert(owner, record); return record;
};

test("guest format, reload and undo remain local; sign-in merges without replacing cloud", async () => {
  const disk = storage(), cloud = remote();
  disk.setItem("chicappd-irl-game", JSON.stringify(correctIRLScore(game(), "irl-1", 7)));
  const original = disk.getItem("chicappd-irl-game");
  const store = new HistoryStore(disk);
  assert.equal(selected(store).players[0].score, 7);
  assert.equal(undoIRL(selected(store)).players[0].score, 0);
  await seed(cloud, "alice");
  store.setOwner("alice", cloud); await store.sync();
  assert.equal((await cloud.list("alice")).length, 2);
  assert.equal(store.getSnapshot().records.length, 2);
  assert.equal(disk.getItem("chicappd-irl-game"), original);
  const importedId = store.getSnapshot().selectedId;
  assert.equal(selected(store).players[0].score, 7);
  const insertCount = cloud.inserts;
  const reloaded = new HistoryStore(disk);
  reloaded.setOwner("alice", cloud); await reloaded.sync();
  assert.equal(cloud.inserts, insertCount);
  assert.equal(reloaded.getSnapshot().selectedId, importedId);
  store.setOwner(null, null);
  assert.equal(selected(store).players[0].score, 7);
});

test("signed-in edits persist on a fresh device while guest slot stays unchanged", async () => {
  const disk = storage(), cloud = remote(), store = new HistoryStore(disk);
  store.setGame(game());
  const guest = disk.getItem("chicappd-irl-game");
  store.setOwner("alice", cloud); await store.sync();
  store.setGame(current => correctIRLScore(current, "irl-1", 14)); await store.sync();
  assert.equal(disk.getItem("chicappd-irl-game"), guest);
  const fresh = new HistoryStore(storage()); fresh.setOwner("alice", cloud); await fresh.sync();
  assert.equal(selected(fresh).players[0].score, 14);
  assert.equal(selected(fresh).history.length, 1);
  store.setOwner(null, null);
  assert.equal(selected(store).players[0].score, 0);
  store.setOwner("alice", cloud); await store.sync();
  assert.equal(selected(store).players[0].score, 14);
  assert.equal((await cloud.list("alice")).length, 1);
});

test("failed imports and edits retain durable local copies and retry without duplicates", async () => {
  const disk = storage(), cloud = remote(), store = new HistoryStore(disk);
  store.setGame(game()); cloud.fail = true;
  store.setOwner("alice", cloud); await store.sync();
  assert.ok(store.getSnapshot().error);
  assert.ok(disk.getItem("chicappd-irl-game"));
  store.setGame(current => correctIRLScore(current, "irl-1", 9)); await store.sync();
  const reloaded = new HistoryStore(disk); reloaded.setOwner("alice", cloud); await reloaded.sync();
  assert.equal(selected(reloaded).players[0].score, 9);
  cloud.fail = false; await reloaded.sync();
  assert.equal((await cloud.list("alice")).length, 1);
  assert.equal((await cloud.list("alice"))[0].game.players[0].score, 9);
  assert.equal(reloaded.getSnapshot().error, null);
});

test("an uncertain successful insert or update is retried idempotently", async () => {
  const cloud = remote(), disk = storage(), store = new HistoryStore(disk);
  store.setGame(game());
  const insert = cloud.insert.bind(cloud); let loseReply = true;
  cloud.insert = async (...args) => { const result = await insert(...args); if (loseReply) { loseReply = false; throw new Error("lost reply"); } return result; };
  store.setOwner("alice", cloud); await store.sync(); await store.sync();
  assert.equal((await cloud.list("alice")).length, 1);
  const update = cloud.update.bind(cloud); loseReply = true;
  cloud.update = async (...args) => { const result = await update(...args); if (loseReply) { loseReply = false; throw new Error("lost reply"); } return result; };
  store.setGame(current => correctIRLScore(current, "irl-1", 8)); await store.sync(); await store.sync();
  assert.equal((await cloud.list("alice")).length, 1);
  assert.equal(selected(store).players[0].score, 8);
});

test("concurrent device edits preserve both divergent matches", async () => {
  const cloud = remote(); await seed(cloud, "alice", 1);
  const a = new HistoryStore(storage()), b = new HistoryStore(storage());
  a.setOwner("alice", cloud); b.setOwner("alice", cloud); await Promise.all([a.sync(), b.sync()]);
  a.setGame(current => correctIRLScore(current, "irl-1", 10)); await a.sync();
  b.setGame(current => correctIRLScore(current, "irl-1", 15)); await b.sync();
  const rows = await cloud.list("alice");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.game.players[0].score).sort((a,b) => a-b), [10,15]);
  await b.sync(); assert.equal((await cloud.list("alice")).length, 2);
});

test("starting a new signed-in match retains prior matches; guests keep their single slot", async () => {
  const disk = storage(), cloud = remote(), store = new HistoryStore(disk);
  store.setGame(game()); store.setGame(null);
  assert.equal(disk.getItem("chicappd-irl-game"), null);
  store.setOwner("alice", cloud); await store.sync();
  store.setGame(game()); await store.sync(); store.setGame(null);
  store.setGame(game()); await store.sync();
  assert.equal((await cloud.list("alice")).length, 2);
});

test("account change fences a late response and isolates user caches", async () => {
  const cloud = remote(); await seed(cloud, "alice", 10); await seed(cloud, "bob", 20);
  const store = new HistoryStore(storage());
  const list = cloud.list.bind(cloud); let resolve;
  cloud.list = owner => owner === "alice" ? new Promise(r => { resolve = r; }) : list(owner);
  store.setOwner("alice", cloud);
  store.setOwner("bob", cloud);
  assert.equal(store.getSnapshot().records.length, 0);
  resolve(await list("alice")); await store.sync();
  assert.equal(store.getSnapshot().ownerId, "bob");
  assert.equal(selected(store).players[0].score, 20);
  store.setOwner(null, null); assert.equal(store.getSnapshot().records.length, 0);
});

test("editing during an in-flight save leaves the newer revision pending", async () => {
  const cloud = remote(), store = new HistoryStore(storage()); await seed(cloud, "alice", 1);
  store.setOwner("alice", cloud); await store.sync();
  const update = cloud.update.bind(cloud); let release;
  cloud.update = async (...args) => { await new Promise(r => { release = r; }); return update(...args); };
  store.setGame(current => correctIRLScore(current, "irl-1", 10));
  const saving = store.sync();
  await new Promise(r => setImmediate(r));
  store.setGame(current => correctIRLScore(current, "irl-1", 20));
  release(); await saving;
  assert.equal(selected(store).players[0].score, 20);
  assert.equal(store.getSnapshot().records[0].dirty, true);
  cloud.update = update; await store.sync();
  assert.equal((await cloud.list("alice"))[0].game.players[0].score, 20);
});

test("Chicago bonus settings and awarded marker survive local and cloud history reload", async () => {
  const disk = storage(), cloud = remote(), store = new HistoryStore(disk);
  const saved = { ...createIRLGame(["Ada", "Bo"], { ...defaultSettings, firstChicagoBreakBonus: true }), chicagoBreakBonusAwarded: true };
  store.setGame(saved);
  assert.deepEqual(selected(new HistoryStore(disk)), saved);
  store.setOwner("alice", cloud); await store.sync();
  const fresh = new HistoryStore(storage());
  fresh.setOwner("alice", cloud); await fresh.sync();
  assert.deepEqual(fresh.getSnapshot().records[0].game, saved);
});
