-- Solo chi ha creato una lista può invitare persone o annullare gli inviti.
-- Da eseguire una volta sola, dopo scadenze.sql.

drop policy "Invito persone nelle mie liste" on public.inviti;
drop policy "Annullo gli inviti delle mie liste" on public.inviti;

create policy "Invito persone nelle liste che ho creato"
  on public.inviti for insert to authenticated
  with check (
    invitato_da = (select auth.uid())
    and exists (select 1 from public.liste l where l.id = lista_id and l.creata_da = (select auth.uid()))
  );

create policy "Annullo gli inviti delle liste che ho creato"
  on public.inviti for delete to authenticated
  using (
    exists (select 1 from public.liste l where l.id = lista_id and l.creata_da = (select auth.uid()))
  );
