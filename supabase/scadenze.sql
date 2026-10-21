-- Scadenze: una data facoltativa entro cui fare la voce.
-- Da eseguire una volta sola, dopo quantita.sql.

alter table public.voci add column scadenza date;
