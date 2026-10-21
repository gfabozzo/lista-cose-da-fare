-- Nomi: ognuno sceglie come farsi chiamare, e lo vede chi condivide una lista con lui.
-- Da eseguire una volta sola, dopo piu-liste.sql.

create table public.profili (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  nome text not null check (char_length(nome) between 1 and 40)
);

alter table public.profili enable row level security;

-- Dice se io e un'altra persona siamo membri di almeno una lista in comune
create function public.condividiamo_una_lista(altro uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.membri io
    join public.membri lui on lui.lista_id = io.lista_id
    where io.user_id = (select auth.uid()) and lui.user_id = altro
  );
$$;

create policy "Vedo il mio nome e quello di chi condivide una lista con me"
  on public.profili for select to authenticated
  using (user_id = (select auth.uid()) or public.condividiamo_una_lista(user_id));

create policy "Scelgo il mio nome"
  on public.profili for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Cambio il mio nome"
  on public.profili for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
