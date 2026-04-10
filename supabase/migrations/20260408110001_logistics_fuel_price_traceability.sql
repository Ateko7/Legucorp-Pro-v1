alter table public.ruta_tramos
  add column if not exists fuel_history_id uuid,
  add column if not exists fuel_price_effective_date date,
  add column if not exists fuel_price_source_name text,
  add column if not exists fuel_price_source_url text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ruta_tramos_fuel_history_id_fkey'
  ) then
    alter table public.ruta_tramos
      add constraint ruta_tramos_fuel_history_id_fkey
      foreign key (fuel_history_id) references public.historial_combustible(id) on delete set null;
  end if;
end $$;

create index if not exists idx_ruta_tramos_fuel_history
  on public.ruta_tramos (fuel_history_id);
