begin;

-- Existing IRL match + undo snapshots, owned by Supabase Auth UUID.
create table public.irl_history (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  revision uuid not null,
  game jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint irl_history_game_object check (
    jsonb_typeof(game) = 'object'
    and game ?& array['players', 'history', 'phase']
    and jsonb_typeof(game->'players') = 'array'
    and jsonb_typeof(game->'history') = 'array'
    and game->>'phase' in ('hands', 'tricks', 'result')
  )
);

alter table public.irl_history enable row level security;
alter table public.irl_history force row level security;

create policy irl_history_select_owner on public.irl_history
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy irl_history_insert_owner on public.irl_history
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy irl_history_update_owner on public.irl_history
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy irl_history_delete_owner on public.irl_history
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- Expose only this table to signed-in users. No anonymous/table-wide defaults.
revoke all on public.irl_history from public, anon, authenticated;
grant select, insert, delete on public.irl_history to authenticated;
grant update (game, revision, updated_at) on public.irl_history to authenticated;

create index irl_history_owner_updated on public.irl_history (owner_id, updated_at desc);
notify pgrst, 'reload schema';
commit;
