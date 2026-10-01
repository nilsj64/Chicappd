import type { SupabaseClient } from "@supabase/supabase-js";
import type { IRLGame } from "./irl.ts";
import { validSettings } from "./scoring.ts";

export type HistoryRecord<Game = IRLGame> = { id: string; revision: string; game: Game; updated_at: string };
type LocalRecord<Game = IRLGame> = HistoryRecord<Game> & { baseRevision: string | null; dirty: boolean };
type Cache<Game = IRLGame> = { records: LocalRecord<Game>[]; selectedId: string | null; imports: string[] };
export type HistoryState<Game = IRLGame> = Cache<Game> & { ownerId: string | null; loading: boolean; error: string | null };
export type HistoryRemote<Game = IRLGame> = {
  list(ownerId: string): Promise<HistoryRecord<Game>[]>;
  insert(ownerId: string, record: HistoryRecord<Game>): Promise<HistoryRecord<Game>>;
  update(ownerId: string, record: HistoryRecord<Game>, baseRevision: string): Promise<HistoryRecord<Game> | null>;
};
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
const guestKey = "chicappd-irl-game";
const guestMetaKey = "chicappd-irl-game-meta";
const emptyCache = <Game = IRLGame>(): Cache<Game> => ({ records: [], selectedId: null, imports: [] });
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function validIRLGame(value: unknown): value is IRLGame {
  if (!value || typeof value !== "object") return false;
  const game = value as IRLGame;
  const snapshotValid = (snapshot: Omit<IRLGame, "history">) => !!snapshot &&
    Array.isArray(snapshot.players) && snapshot.players.length >= 2 && snapshot.players.length <= 6 &&
    snapshot.players.every((p) => p && typeof p.id === "string" && typeof p.name === "string" && Number.isSafeInteger(p.score) && typeof p.hasDeclaredChicago === "boolean") &&
    validSettings(snapshot.settings) && Number.isSafeInteger(snapshot.dealNumber) && snapshot.dealNumber >= 1 &&
    ["hands", "tricks", "result"].includes(snapshot.phase) &&
    (snapshot.chicagoPlayerId === null || snapshot.players.some(p => p.id === snapshot.chicagoPlayerId)) &&
    Array.isArray(snapshot.lastSummary) && snapshot.lastSummary.every(s => typeof s === "string");
  return snapshotValid(game) && Array.isArray(game.history) && game.history.every(snapshotValid);
}

export type HistoryOptions<Game> = { guestKey: string; cachePrefix: string; archive: boolean; kind: "digital" | "irl"; validate: (value: unknown) => value is Game };
const irlOptions: HistoryOptions<IRLGame> = { guestKey, cachePrefix: "chicappd-irl-history-", archive: false, kind: "irl", validate: validIRLGame };
const validRecord = <Game>(r: HistoryRecord<Game>, validate: HistoryOptions<Game>["validate"]) => r && uuid(r.id) && uuid(r.revision) && validate(r.game) && Number.isFinite(Date.parse(r.updated_at));
const clean = <Game>(r: HistoryRecord<Game>): LocalRecord<Game> => ({ ...r, baseRevision: r.revision, dirty: false });

export function supabaseHistoryRemote<Game = IRLGame>(client: SupabaseClient, options: HistoryOptions<Game> = irlOptions as unknown as HistoryOptions<Game>): HistoryRemote<Game> {
  const columns = "id,revision,game,updated_at";
  return {
    async list(ownerId) {
      const rows: HistoryRecord<Game>[] = [];
      for (let start = 0; ; start += 100) {
        const { data, error } = await client.from("irl_history").select(columns).eq("owner_id", ownerId)
          .filter("game->>kind", options.kind === "digital" ? "eq" : "is", options.kind === "digital" ? "digital" : null).order("id").range(start, start + 99).abortSignal(AbortSignal.timeout(15000));
        if (error) throw error;
        if (!data.every(r => validRecord(r, options.validate))) throw new Error("Invalid cloud history");
        rows.push(...data);
        if (data.length < 100) return rows;
      }
    },
    async insert(ownerId, record) {
      // A retry after an uncertain response must not overwrite an existing row.
      const { error } = await client.from("irl_history").upsert({ owner_id: ownerId, ...record },
        { onConflict: "owner_id,id", ignoreDuplicates: true }).abortSignal(AbortSignal.timeout(15000));
      if (error) throw error;
      const result = await client.from("irl_history").select(columns).eq("owner_id", ownerId).eq("id", record.id)
        .abortSignal(AbortSignal.timeout(15000)).single();
      if (result.error) throw result.error;
      if (!validRecord(result.data, options.validate)) throw new Error("Invalid cloud history");
      return result.data;
    },
    async update(ownerId, record, baseRevision) {
      const { data, error } = await client.from("irl_history")
        .update({ game: record.game, revision: record.revision, updated_at: record.updated_at })
        .eq("owner_id", ownerId).eq("id", record.id).eq("revision", baseRevision).select(columns)
        .abortSignal(AbortSignal.timeout(15000));
      if (error) throw error;
      if (data.length && !validRecord(data[0], options.validate)) throw new Error("Invalid cloud history");
      return data[0] ?? null;
    },
  };
}

/** Small durable local queue; cloud operations are serialized and fenced by account. */
export class HistoryStore<Game = IRLGame> {
  private state: HistoryState<Game> = { ...emptyCache<Game>(), ownerId: null, loading: false, error: null };
  private listeners = new Set<() => void>();
  private remote: HistoryRemote<Game> | null = null;
  private generation = 0;
  private running: Promise<void> | null = null;
  private resumeLatest = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private storage: Storage;
  private options: HistoryOptions<Game>;
  private cacheKey(owner: string) { return `${this.options.cachePrefix}${owner}`; }
  private newId: () => string;
  private now: () => string;
  constructor(storage: Storage, newId: () => string = () => crypto.randomUUID(), now = () => new Date().toISOString(), options: HistoryOptions<Game> = irlOptions as unknown as HistoryOptions<Game>) {
    this.options = options;
    this.storage = storage; this.newId = newId; this.now = now;
    this.loadGuest();
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { for (const listener of this.listeners) listener(); }
  private read(key: string): unknown {
    try { return JSON.parse(this.storage.getItem(key) ?? "null"); } catch { return null; }
  }
  private persist() {
    try {
      if (this.state.ownerId || this.options.archive) this.storage.setItem(this.state.ownerId ? this.cacheKey(this.state.ownerId) : this.options.guestKey, JSON.stringify(this.state));
      else {
        const record = this.state.records[0];
        if (record) {
          this.storage.setItem(guestKey, JSON.stringify(record.game));
          this.storage.setItem(guestMetaKey, JSON.stringify({ id: record.id, revision: record.revision, updated_at: record.updated_at }));
        } else { this.storage.removeItem(guestKey); this.storage.removeItem(guestMetaKey); }
      }
    } catch { this.state = { ...this.state, error: "Kunde inte spara på den här enheten. Håll sidan öppen och försök igen." }; }
  }
  private guest(): LocalRecord<Game> | null {
    const game = this.read(guestKey);
    if (!this.options.validate(game)) return null;
    const meta = this.read(guestMetaKey) as Partial<HistoryRecord<Game>> | null;
    const record: LocalRecord<Game> = { id: uuid(meta?.id) ? meta.id : this.newId(), revision: uuid(meta?.revision) ? meta.revision : this.newId(),
      updated_at: meta?.updated_at && Number.isFinite(Date.parse(meta.updated_at)) ? meta.updated_at : this.now(), game, dirty: true, baseRevision: null };
    // Assign identity to legacy saves once, before any migration request.
    try { this.storage.setItem(guestMetaKey, JSON.stringify({ id: record.id, revision: record.revision, updated_at: record.updated_at })); } catch { /* Keep guest data intact. */ }
    return record;
  }
  private loadGuest() {
    this.resumeLatest = false;
    if (this.options.archive) {
      const cached = this.read(this.options.guestKey) as Cache<Game> | null;
      const cache = this.validCache(cached) ? cached : emptyCache<Game>();
      this.state = { ...cache, ownerId: null, loading: false, error: null }; return;
    }
    const guest = this.guest();
    this.state = { ...emptyCache<Game>(), records: guest ? [guest] : [], selectedId: guest?.id ?? null, ownerId: null, loading: false, error: null };
  }
  setOwner(ownerId: string | null, remote: HistoryRemote<Game> | null) {
    if (ownerId === this.state.ownerId && remote === this.remote) return;
    this.generation++;
    clearTimeout(this.timer);
    this.remote = remote;
    if (!ownerId) this.loadGuest();
    else {
      const cached = this.read(this.cacheKey(ownerId)) as Cache<Game> | null;
      const cache = this.validCache(cached) ? cached : emptyCache<Game>();
      this.state = { ...cache, ownerId, loading: true, error: null };
      this.resumeLatest = cached === null;
      const guestCache = this.read(this.options.guestKey) as Cache<Game> | null;
      const guest = this.options.archive ? (this.validCache(guestCache) ? guestCache.records : []) : [this.guest()].filter((r): r is LocalRecord<Game> => r !== null);
      for (const record of guest) {
        const importId = this.options.archive ? record.id : record.revision;
        if (cache.imports.includes(importId)) continue;
        const imported = { ...record, id: importId, dirty: true, baseRevision: null };
        if (!this.state.records.some(r => r.id === importId)) this.state.records = [...this.state.records, imported];
        this.state.selectedId ??= importId;
      }
      this.persist();
    }
    this.emit();
    if (ownerId) void this.sync();
  }
  private validCache(value: Cache<Game> | null): value is Cache<Game> {
    return !!value && Array.isArray(value.records) && value.records.every(r => validRecord(r, this.options.validate) && typeof r.dirty === "boolean" && (r.baseRevision === null || uuid(r.baseRevision))) && Array.isArray(value.imports) && value.imports.every(uuid);
  }
  append = (id: string, game: Game, ownerId = this.state.ownerId) => {
    if (!uuid(id) || !this.options.validate(game)) throw new Error("Invalid history record");
    if (ownerId !== this.state.ownerId) {
      const key = ownerId ? this.cacheKey(ownerId) : this.options.guestKey;
      const cached = this.read(key) as Cache<Game> | null;
      const cache = this.validCache(cached) ? cached : emptyCache<Game>();
      if (!cache.records.some(r => r.id === id)) this.storage.setItem(key, JSON.stringify({ ...cache,
        selectedId: id, records: [...cache.records, { id, revision: id, game, updated_at: this.now(), dirty: true, baseRevision: null }] }));
      // A guest result finishing capture during sign-in must reach both its local
      // backup and the newly authenticated scope. Other accounts stay isolated.
      if (ownerId === null && this.state.ownerId) this.append(id, game);
      return;
    }
    if (this.state.records.some(r => r.id === id)) return;
    const record: LocalRecord<Game> = { id, revision: id, game, updated_at: this.now(), dirty: true, baseRevision: null };
    this.state = { ...this.state, records: [...this.state.records, record], selectedId: id };
    this.persist(); this.emit();
    clearTimeout(this.timer);
    if (this.state.ownerId) this.timer = setTimeout(() => { void this.sync(); }, 500);
  };
  setGame = (update: Game | null | ((current: Game | null) => Game | null)) => {
    const old = this.state.records.find(r => r.id === this.state.selectedId);
    const game = typeof update === "function" ? (update as (current: Game | null) => Game | null)(old?.game ?? null) : update;
    if (game === old?.game) return;
    if (game === null) {
      this.resumeLatest = false;
      // New match clears the guest slot as before; cloud matches remain selectable.
      this.state = { ...this.state, records: this.state.ownerId ? this.state.records : [], selectedId: null };
    } else {
      const record: LocalRecord<Game> = { id: old?.id ?? this.newId(), revision: this.newId(), game, updated_at: this.now(), dirty: true, baseRevision: old?.baseRevision ?? null };
      this.state = { ...this.state, selectedId: record.id, records: [...this.state.records.filter(r => r.id !== record.id), record] };
    }
    this.persist(); this.emit();
    clearTimeout(this.timer);
    if (this.state.ownerId) this.timer = setTimeout(() => { void this.sync(); }, 500);
  };
  select = (id: string) => {
    if (!this.state.records.some(r => r.id === id)) return;
    this.state = { ...this.state, selectedId: id }; this.persist(); this.emit();
  };
  sync = async (): Promise<void> => {
    if (!this.state.ownerId || !this.remote) return;
    if (this.running) { await this.running; return this.sync(); }
    const task = this.runSync();
    this.running = task;
    try { await task; } finally { if (this.running === task) this.running = null; }
  };
  private async runSync() {
    const ownerId = this.state.ownerId!;
    const remote = this.remote!;
    const generation = this.generation;
    const current = () => generation === this.generation;
    this.state = { ...this.state, loading: true, error: null }; this.emit();
    try {
      const cloud = await remote.list(ownerId);
      if (!current()) return;
      const pending = this.state.records.filter(r => r.dirty);
      // Never resurrect remotely removed clean rows or overwrite unsent edits.
      this.state = { ...this.state, records: [...cloud.filter(r => !pending.some(p => p.id === r.id)).map(clean), ...pending] };
      if (this.resumeLatest && !this.state.selectedId && this.state.records.length) {
        this.state = { ...this.state, selectedId: [...this.state.records].sort((a,b) => b.updated_at.localeCompare(a.updated_at))[0].id };
      }
      this.resumeLatest = false;
      this.persist(); this.emit();
      for (const record of pending) {
        if (!current()) return;
        let saved = record.baseRevision === null
          ? await remote.insert(ownerId, { id: record.id, revision: record.revision, game: record.game, updated_at: record.updated_at })
          : await remote.update(ownerId, record, record.baseRevision);
        if (!current()) return;
        // Lost response: the same revision may already be committed.
        let retained = cloud.find(r => r.id === record.id);
        if (!saved) {
          retained = (await remote.list(ownerId)).find(r => r.id === record.id);
          saved = retained?.revision === record.revision ? retained : null;
        }
        if (!current()) return;
        let savedId = record.id;
        if (!saved || saved.revision !== record.revision) {
          // Concurrent edit/delete: retain remote and fork local under its revision
          // UUID. Retries produce the same fork instead of more duplicates.
          const fork = { id: record.revision, revision: record.revision, game: record.game, updated_at: record.updated_at };
          saved = await remote.insert(ownerId, fork);
          savedId = fork.id;
        }
        if (!current()) return;
        const latest = this.state.records.find(r => r.id === record.id);
        const replacement = latest && latest.revision !== record.revision
          ? { ...latest, id: savedId, baseRevision: saved.revision, dirty: true } : clean(saved);
        const retainedCloud = savedId !== record.id && retained ? [clean(retained)] : [];
        this.state = { ...this.state,
          records: [...this.state.records.filter(r => r.id !== record.id && r.id !== savedId), ...retainedCloud, replacement],
          selectedId: this.state.selectedId === record.id ? savedId : this.state.selectedId,
          imports: [...new Set([...this.state.imports, record.id])],
        };
        this.persist(); this.emit();
      }
      if (!this.state.records.some(r => r.id === this.state.selectedId) && this.state.selectedId !== null) this.state = { ...this.state, selectedId: null };
    } catch {
      if (current()) this.state = { ...this.state, error: "Kunde inte synka historiken. Dina ändringar finns kvar på den här enheten. Försök igen." };
    } finally {
      if (current()) { this.state = { ...this.state, loading: false }; this.persist(); this.emit(); }
    }
  }
}
