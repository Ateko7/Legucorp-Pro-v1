alter table public.clients
  add column if not exists delivery_latitude numeric(10,7),
  add column if not exists delivery_longitude numeric(10,7),
  add column if not exists location_updated_at timestamptz;

create index if not exists idx_clients_delivery_location
  on public.clients (organization_id, location_updated_at desc);
