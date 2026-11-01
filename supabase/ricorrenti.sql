-- Voci ricorrenti: quando le spunti, invece di restare fatte si spostano alla prossima scadenza.
-- Da eseguire una volta sola, dopo inviti-creatore.sql.

alter table public.voci add column ripeti text
  check (ripeti in ('giorno', 'settimana', 'mese', 'anno'));
