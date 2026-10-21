-- Aggiornamento in tempo reale: il database avvisa la pagina quando una voce cambia.
-- Le regole di protezione valgono anche qui: ognuno riceve solo le modifiche delle sue liste.
alter publication supabase_realtime add table public.voci;
