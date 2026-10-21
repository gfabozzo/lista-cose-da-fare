-- Liste condivise: una lista può avere più membri, che vedono e modificano le stesse voci.
-- Da eseguire una volta sola, dopo schema.sql.

create table public.liste (
  id uuid primary key default gen_random_uuid(),
  nome text not null default 'La mia lista' check (char_length(nome) between 1 and 100),
  creata_da uuid not null default auth.uid() references auth.users on delete cascade,
  creata_il timestamptz not null default now()
);

create table public.membri (
  lista_id uuid not null references public.liste on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  email text not null,
  primary key (lista_id, user_id)
);

create index membri_user_id_idx on public.membri (user_id);

-- Inviti in attesa: diventano membri quando la persona accede con quella email
create table public.inviti (
  lista_id uuid not null references public.liste on delete cascade,
  email text not null check (email = lower(email)),
  invitato_da uuid not null default auth.uid() references auth.users on delete cascade,
  creato_il timestamptz not null default now(),
  primary key (lista_id, email)
);

-- Dice se chi sta usando la pagina fa parte della lista
create function public.sono_membro(lista uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.membri
    where lista_id = lista and user_id = (select auth.uid())
  );
$$;

-- Le voci ora appartengono a una lista
alter table public.voci add column lista_id uuid references public.liste on delete cascade;

-- Sposta le voci esistenti in una lista personale per ogni utente
do $$
declare
  u record;
  nuova uuid;
begin
  for u in
    select distinct v.user_id, lower(au.email) as email
    from public.voci v join auth.users au on au.id = v.user_id
  loop
    insert into public.liste (nome, creata_da) values ('La mia lista', u.user_id) returning id into nuova;
    insert into public.membri (lista_id, user_id, email) values (nuova, u.user_id, u.email);
    update public.voci set lista_id = nuova where user_id = u.user_id;
  end loop;
end $$;

alter table public.voci alter column lista_id set not null;
create index voci_lista_id_idx on public.voci (lista_id);

-- Nuove regole per le voci: le vede e le modifica chi è membro della lista
drop policy "Leggo solo le mie voci" on public.voci;
drop policy "Aggiungo voci solo a mio nome" on public.voci;
drop policy "Modifico solo le mie voci" on public.voci;
drop policy "Elimino solo le mie voci" on public.voci;

create policy "Leggo le voci delle mie liste"
  on public.voci for select to authenticated
  using (public.sono_membro(lista_id));

create policy "Aggiungo voci alle mie liste"
  on public.voci for insert to authenticated
  with check (public.sono_membro(lista_id) and user_id = (select auth.uid()));

create policy "Modifico le voci delle mie liste"
  on public.voci for update to authenticated
  using (public.sono_membro(lista_id))
  with check (public.sono_membro(lista_id));

create policy "Elimino le voci delle mie liste"
  on public.voci for delete to authenticated
  using (public.sono_membro(lista_id));

-- Regole per liste, membri e inviti
alter table public.liste enable row level security;
alter table public.membri enable row level security;
alter table public.inviti enable row level security;

create policy "Vedo le mie liste"
  on public.liste for select to authenticated
  using (public.sono_membro(id));

create policy "Rinomino le mie liste"
  on public.liste for update to authenticated
  using (public.sono_membro(id))
  with check (public.sono_membro(id));

create policy "Vedo chi c'è nelle mie liste"
  on public.membri for select to authenticated
  using (public.sono_membro(lista_id));

create policy "Esco da una lista o, se l'ho creata io, tolgo qualcuno"
  on public.membri for delete to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.liste l where l.id = lista_id and l.creata_da = (select auth.uid()))
  );

create policy "Vedo gli inviti delle mie liste e quelli per me"
  on public.inviti for select to authenticated
  using (public.sono_membro(lista_id) or email = lower((select auth.jwt()) ->> 'email'));

create policy "Invito persone nelle mie liste"
  on public.inviti for insert to authenticated
  with check (public.sono_membro(lista_id) and invitato_da = (select auth.uid()));

create policy "Annullo gli inviti delle mie liste"
  on public.inviti for delete to authenticated
  using (public.sono_membro(lista_id));

-- Chiamata a ogni accesso: accetta gli inviti per la mia email,
-- crea una lista personale se non ne ho nessuna e restituisce le mie liste
create function public.prepara_liste() returns setof public.liste
language plpgsql security definer set search_path = '' as $$
declare
  io uuid := auth.uid();
  mia_email text := lower(auth.jwt() ->> 'email');
  nuova uuid;
begin
  if io is null then
    raise exception 'Accesso richiesto';
  end if;

  insert into public.membri (lista_id, user_id, email)
    select i.lista_id, io, mia_email from public.inviti i where i.email = mia_email
    on conflict do nothing;
  delete from public.inviti where email = mia_email;

  if not exists (select 1 from public.membri where user_id = io) then
    insert into public.liste (nome, creata_da) values ('La mia lista', io) returning id into nuova;
    insert into public.membri (lista_id, user_id, email) values (nuova, io, mia_email);
  end if;

  return query
    select l.* from public.liste l
    join public.membri m on m.lista_id = l.id
    where m.user_id = io
    order by l.creata_il;
end $$;

revoke execute on function public.prepara_liste() from public, anon;
grant execute on function public.prepara_liste() to authenticated;
