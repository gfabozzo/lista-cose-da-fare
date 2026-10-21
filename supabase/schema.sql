-- Tabella delle voci della lista: ogni voce appartiene a un utente
create table public.voci (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  testo text not null check (char_length(testo) between 1 and 500),
  fatto boolean not null default false,
  creata_il timestamptz not null default now()
);

create index voci_user_id_idx on public.voci (user_id);

-- Protezione: ognuno vede e modifica solo le proprie voci
alter table public.voci enable row level security;

create policy "Leggo solo le mie voci"
  on public.voci for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Aggiungo voci solo a mio nome"
  on public.voci for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Modifico solo le mie voci"
  on public.voci for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Elimino solo le mie voci"
  on public.voci for delete
  to authenticated
  using ((select auth.uid()) = user_id);
