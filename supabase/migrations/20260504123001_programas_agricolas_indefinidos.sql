alter table public.programas_agricolas
  alter column end_date drop not null;

alter table public.programas_agricolas
  drop constraint if exists programas_agricolas_dates_check;

alter table public.programas_agricolas
  add constraint programas_agricolas_dates_check
  check (end_date is null or end_date >= start_date);
