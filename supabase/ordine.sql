-- Ordine delle voci: ognuna ha una posizione, e trascinandola la si cambia.
-- Da eseguire una volta sola, dopo nomi.sql.

alter table public.voci add column posizione double precision;

-- Le voci esistenti restano nell'ordine in cui sono state create
update public.voci set posizione = extract(epoch from creata_il);

-- Le nuove voci finiscono in fondo alla lista
alter table public.voci alter column posizione set default extract(epoch from clock_timestamp());
alter table public.voci alter column posizione set not null;
