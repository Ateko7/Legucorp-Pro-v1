-- Add missing policies for public tables that have RLS enabled but no policy.

drop policy if exists org_journal_entries_all on public.journal_entries;
create policy org_journal_entries_all on public.journal_entries
  using (organization_id = public.get_my_profile_org())
  with check (organization_id = public.get_my_profile_org());

drop policy if exists org_journal_entry_lines_all on public.journal_entry_lines;
create policy org_journal_entry_lines_all on public.journal_entry_lines
  using (exists (
    select 1
      from public.journal_entries je
      where je.id = journal_entry_lines.entry_id
        and je.organization_id = public.get_my_profile_org()
  ))
  with check (exists (
    select 1
      from public.journal_entries je
      where je.id = journal_entry_lines.entry_id
        and je.organization_id = public.get_my_profile_org()
  ));

drop policy if exists org_liquidaciones_empleado_all on public.liquidaciones_empleado;
create policy org_liquidaciones_empleado_all on public.liquidaciones_empleado
  using (organization_id = public.get_my_profile_org())
  with check (organization_id = public.get_my_profile_org());

drop policy if exists org_nomina_detalle_all on public.nomina_detalle;
create policy org_nomina_detalle_all on public.nomina_detalle
  using (organization_id = public.get_my_profile_org())
  with check (organization_id = public.get_my_profile_org());

drop policy if exists org_nomina_detalle_conceptos_all on public.nomina_detalle_conceptos;
create policy org_nomina_detalle_conceptos_all on public.nomina_detalle_conceptos
  using (organization_id = public.get_my_profile_org())
  with check (organization_id = public.get_my_profile_org());
