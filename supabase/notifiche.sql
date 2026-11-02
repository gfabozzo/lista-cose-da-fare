-- Notifiche: ogni mattina alle 8 (ora italiana) il telefono avvisa delle cose in ritardo, di oggi e di domani.
-- Da eseguire una volta sola, dopo ricorrenti.sql e dopo aver creato la funzione "promemoria" (vedi README).

-- I dispositivi su cui qualcuno ha attivato le notifiche
create table public.iscrizioni_notifiche (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  p256dh text not null,
  auth text not null,
  -- Il giorno dell'ultimo promemoria del mattino, per non mandarne due nello stesso giorno
  ultimo_invio date,
  creata_il timestamptz not null default now()
);

create index iscrizioni_notifiche_user_id_idx on public.iscrizioni_notifiche (user_id);

alter table public.iscrizioni_notifiche enable row level security;

-- Ognuno vede e gestisce solo i propri dispositivi
create policy "Vedo i miei dispositivi con le notifiche"
  on public.iscrizioni_notifiche for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Attivo le notifiche per me"
  on public.iscrizioni_notifiche for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Aggiorno i miei dispositivi con le notifiche"
  on public.iscrizioni_notifiche for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Disattivo le notifiche per me"
  on public.iscrizioni_notifiche for delete to authenticated
  using (user_id = (select auth.uid()));

-- L'orologio: chiama la funzione "promemoria" alle 6 e alle 7 di Greenwich.
-- In Italia sono le 8 una volta d'inverno e una volta d'estate: la funzione invia solo quando da noi sono le 8.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'promemoria-del-mattino',
  '0 6,7 * * *',
  $$
  select net.http_post(
    url := 'https://nfhcggivsdorubguqfgy.supabase.co/functions/v1/promemoria',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
