alter table public.rutas
  add column if not exists actual_start_latitude numeric(10,7),
  add column if not exists actual_start_longitude numeric(10,7),
  add column if not exists actual_start_recorded_at timestamptz;
