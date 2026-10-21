-- Più liste: crearne di nuove ed eliminare quelle create da me.
-- Da eseguire una volta sola, dopo condivisione.sql.

-- Crea una lista e ne fa diventare membro chi la crea
create function public.crea_lista(nome_lista text) returns public.liste
language plpgsql security definer set search_path = '' as $$
declare
  io uuid := auth.uid();
  nuova public.liste;
begin
  if io is null then
    raise exception 'Accesso richiesto';
  end if;
  insert into public.liste (nome, creata_da) values (trim(nome_lista), io) returning * into nuova;
  insert into public.membri (lista_id, user_id, email) values (nuova.id, io, lower(auth.jwt() ->> 'email'));
  return nuova;
end $$;

revoke execute on function public.crea_lista(text) from public, anon;
grant execute on function public.crea_lista(text) to authenticated;

-- Solo chi ha creato una lista può eliminarla (con tutte le sue voci, membri e inviti)
create policy "Elimino le liste che ho creato"
  on public.liste for delete to authenticated
  using (creata_da = (select auth.uid()));
