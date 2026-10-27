-- 另一个我 · Supabase schema
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run again.

-- Every write bumps this sequence; devices sync by asking for "everything after seq N".
create sequence if not exists public.memories_seq;

create table if not exists public.memories (
  id         text primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  doc        jsonb not null,
  deleted    boolean not null default false,
  seq        bigint not null default nextval('public.memories_seq'),
  updated_at timestamptz not null default now()
);

create index if not exists memories_user_seq on public.memories (user_id, seq);

create or replace function public.memories_stamp() returns trigger
language plpgsql as $$
begin
  new.seq := nextval('public.memories_seq');
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
  else
    new.user_id := old.user_id;
  end if;
  return new;
end $$;

drop trigger if exists memories_stamp on public.memories;
create trigger memories_stamp before insert or update on public.memories
  for each row execute function public.memories_stamp();

-- Only the signed-in owner can see or change a row.
alter table public.memories enable row level security;
drop policy if exists "owner only" on public.memories;
create policy "owner only" on public.memories
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.memories from anon;
grant select, insert, update on public.memories to authenticated;
grant usage, select on sequence public.memories_seq to authenticated;

-- Attachments: a private bucket, one folder per user (<user id>/<file>).
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists "attachments owner read" on storage.objects;
create policy "attachments owner read" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "attachments owner write" on storage.objects;
create policy "attachments owner write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "attachments owner delete" on storage.objects;
create policy "attachments owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
