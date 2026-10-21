-- Quantità: quante unità servono di ogni voce (per esempio "Latte ×2").
-- Da eseguire una volta sola, dopo ordine.sql.

alter table public.voci add column quantita integer not null default 1
  check (quantita between 1 and 999);
