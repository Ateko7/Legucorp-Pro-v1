create or replace function public.crm_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table public.prospects
  add column if not exists contact_role text,
  add column if not exists whatsapp text,
  add column if not exists business_type text,
  add column if not exists lead_source text,
  add column if not exists interest_category text,
  add column if not exists estimated_volume numeric(14,4),
  add column if not exists estimated_monthly_potential numeric(14,2),
  add column if not exists closing_probability numeric(5,2) default 0,
  add column if not exists responsible_id uuid references public.salespeople(id) on delete set null,
  add column if not exists first_contact_date date,
  add column if not exists last_contact_at timestamptz,
  add column if not exists next_followup_at timestamptz,
  add column if not exists zone text,
  add column if not exists geolocation_lat numeric(10,7),
  add column if not exists geolocation_lng numeric(10,7),
  add column if not exists state_reason text,
  add column if not exists loss_reason text,
  add column if not exists observations text,
  add column if not exists lead_temperature text default 'templado',
  add column if not exists updated_at timestamptz default now();

alter table public.prospects
  drop constraint if exists prospects_status_check;

alter table public.prospects
  add constraint prospects_status_check
  check (
    status = any (
      array[
        'nuevo'::text,
        'contactado'::text,
        'interesado'::text,
        'cotizacion_enviada'::text,
        'negociacion'::text,
        'prueba_producto'::text,
        'aprobado'::text,
        'convertido'::text,
        'perdido'::text,
        'sin_respuesta'::text,
        'pausado'::text,
        'activo'::text,
        'descartado'::text
      ]
    )
  );

create index if not exists idx_prospects_org_status_responsible
  on public.prospects (organization_id, status, responsible_id);

create index if not exists idx_prospects_org_next_followup
  on public.prospects (organization_id, next_followup_at);

drop trigger if exists trg_prospects_touch_updated_at on public.prospects;
create trigger trg_prospects_touch_updated_at
before update on public.prospects
for each row execute function public.crm_touch_updated_at();

create table if not exists public.crm_followups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  prospect_id uuid references public.prospects(id) on delete cascade,
  quote_id uuid references public.quotes(id) on delete set null,
  followup_type text not null,
  responsible_id uuid references public.salespeople(id) on delete set null,
  scheduled_at timestamptz not null,
  priority text not null default 'media' check (priority in ('baja', 'media', 'alta', 'urgente')),
  status text not null default 'pendiente' check (status in ('pendiente', 'realizado', 'reprogramado', 'cancelado', 'sin_respuesta', 'vencido')),
  result text,
  next_action text,
  notes text,
  completed_at timestamptz,
  reminder_at timestamptz,
  auto_created boolean not null default false,
  parent_followup_id uuid references public.crm_followups(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_active boolean not null default true,
  check (client_id is not null or prospect_id is not null)
);

create index if not exists idx_crm_followups_org_scheduled
  on public.crm_followups (organization_id, scheduled_at, status);

create index if not exists idx_crm_followups_org_responsible
  on public.crm_followups (organization_id, responsible_id, status);

create index if not exists idx_crm_followups_org_client
  on public.crm_followups (organization_id, client_id, prospect_id);

drop trigger if exists trg_crm_followups_touch_updated_at on public.crm_followups;
create trigger trg_crm_followups_touch_updated_at
before update on public.crm_followups
for each row execute function public.crm_touch_updated_at();

create table if not exists public.crm_commercial_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  alert_type text not null,
  severity text not null default 'media' check (severity in ('baja', 'media', 'alta', 'critica')),
  status text not null default 'nueva' check (status in ('nueva', 'en_revision', 'en_accion', 'resuelta', 'ignorada')),
  client_id uuid references public.clients(id) on delete cascade,
  prospect_id uuid references public.prospects(id) on delete cascade,
  quote_id uuid references public.quotes(id) on delete set null,
  followup_id uuid references public.crm_followups(id) on delete set null,
  responsible_id uuid references public.salespeople(id) on delete set null,
  title text not null,
  description text not null,
  recommended_action text,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  ignored_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_active boolean not null default true
);

create index if not exists idx_crm_alerts_org_status
  on public.crm_commercial_alerts (organization_id, status, severity, detected_at desc);

create index if not exists idx_crm_alerts_org_responsible
  on public.crm_commercial_alerts (organization_id, responsible_id, status);

drop trigger if exists trg_crm_alerts_touch_updated_at on public.crm_commercial_alerts;
create trigger trg_crm_alerts_touch_updated_at
before update on public.crm_commercial_alerts
for each row execute function public.crm_touch_updated_at();

create table if not exists public.crm_commercial_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  setting_key text not null,
  setting_value jsonb not null default '{}'::jsonb,
  description text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_active boolean not null default true,
  unique (organization_id, setting_key)
);

drop trigger if exists trg_crm_settings_touch_updated_at on public.crm_commercial_settings;
create trigger trg_crm_settings_touch_updated_at
before update on public.crm_commercial_settings
for each row execute function public.crm_touch_updated_at();

create table if not exists public.crm_commercial_catalogs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  catalog_type text not null,
  code text not null,
  label text not null,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_active boolean not null default true,
  unique (organization_id, catalog_type, code)
);

create index if not exists idx_crm_catalogs_org_type
  on public.crm_commercial_catalogs (organization_id, catalog_type, sort_order, label);

drop trigger if exists trg_crm_catalogs_touch_updated_at on public.crm_commercial_catalogs;
create trigger trg_crm_catalogs_touch_updated_at
before update on public.crm_commercial_catalogs
for each row execute function public.crm_touch_updated_at();

create table if not exists public.crm_customer_profitability_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  snapshot_month date not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  salesperson_id uuid references public.salespeople(id) on delete set null,
  channel text,
  route_name text,
  gross_sales numeric(14,2) not null default 0,
  discounts numeric(14,2) not null default 0,
  returns_amount numeric(14,2) not null default 0,
  credit_notes numeric(14,2) not null default 0,
  net_sales numeric(14,2) not null default 0,
  estimated_product_cost numeric(14,2) not null default 0,
  estimated_logistics_cost numeric(14,2) not null default 0,
  claim_cost numeric(14,2) not null default 0,
  gross_margin numeric(14,2) not null default 0,
  net_margin numeric(14,2) not null default 0,
  gross_margin_pct numeric(8,4) not null default 0,
  net_margin_pct numeric(8,4) not null default 0,
  avg_ticket numeric(14,2) not null default 0,
  purchased_volume numeric(14,4) not null default 0,
  purchase_frequency numeric(14,4) not null default 0,
  classification text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_active boolean not null default true,
  unique (organization_id, snapshot_month, client_id)
);

create index if not exists idx_crm_profitability_snapshot_month
  on public.crm_customer_profitability_snapshots (organization_id, snapshot_month desc, client_id);

drop trigger if exists trg_crm_profitability_snapshots_touch_updated_at on public.crm_customer_profitability_snapshots;
create trigger trg_crm_profitability_snapshots_touch_updated_at
before update on public.crm_customer_profitability_snapshots
for each row execute function public.crm_touch_updated_at();

create table if not exists public.crm_customer_profitability_details (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  snapshot_id uuid not null references public.crm_customer_profitability_snapshots(id) on delete cascade,
  detail_type text not null,
  reference_id uuid,
  reference_label text,
  product_id uuid references public.product_presentations(id) on delete set null,
  category text,
  route_name text,
  gross_sales numeric(14,2) not null default 0,
  net_sales numeric(14,2) not null default 0,
  estimated_cost numeric(14,2) not null default 0,
  logistics_cost numeric(14,2) not null default 0,
  claim_cost numeric(14,2) not null default 0,
  net_margin numeric(14,2) not null default 0,
  net_margin_pct numeric(8,4) not null default 0,
  volume numeric(14,4) not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_active boolean not null default true
);

create index if not exists idx_crm_profitability_details_snapshot
  on public.crm_customer_profitability_details (organization_id, snapshot_id, detail_type);

drop trigger if exists trg_crm_profitability_details_touch_updated_at on public.crm_customer_profitability_details;
create trigger trg_crm_profitability_details_touch_updated_at
before update on public.crm_customer_profitability_details
for each row execute function public.crm_touch_updated_at();

create table if not exists public.crm_customer_segments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  segment_code text not null,
  segment_label text not null,
  abc_class text,
  strategic_score numeric(10,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_active boolean not null default true,
  unique (organization_id, client_id, segment_code)
);

drop trigger if exists trg_crm_customer_segments_touch_updated_at on public.crm_customer_segments;
create trigger trg_crm_customer_segments_touch_updated_at
before update on public.crm_customer_segments
for each row execute function public.crm_touch_updated_at();

create table if not exists public.crm_customer_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  prospect_id uuid references public.prospects(id) on delete cascade,
  recommendation_type text not null,
  recommendation_text text not null,
  source_alert_id uuid references public.crm_commercial_alerts(id) on delete set null,
  priority text not null default 'media' check (priority in ('baja', 'media', 'alta', 'critica')),
  status text not null default 'nueva' check (status in ('nueva', 'en_revision', 'aplicada', 'descartada')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_active boolean not null default true
);

drop trigger if exists trg_crm_customer_recommendations_touch_updated_at on public.crm_customer_recommendations;
create trigger trg_crm_customer_recommendations_touch_updated_at
before update on public.crm_customer_recommendations
for each row execute function public.crm_touch_updated_at();

alter table public.prospects enable row level security;
alter table public.crm_followups enable row level security;
alter table public.crm_commercial_alerts enable row level security;
alter table public.crm_commercial_settings enable row level security;
alter table public.crm_commercial_catalogs enable row level security;
alter table public.crm_customer_profitability_snapshots enable row level security;
alter table public.crm_customer_profitability_details enable row level security;
alter table public.crm_customer_segments enable row level security;
alter table public.crm_customer_recommendations enable row level security;

drop policy if exists org_prospects_all_v2 on public.prospects;
create policy org_prospects_all_v2 on public.prospects
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_crm_followups_all on public.crm_followups;
create policy org_crm_followups_all on public.crm_followups
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_crm_commercial_alerts_all on public.crm_commercial_alerts;
create policy org_crm_commercial_alerts_all on public.crm_commercial_alerts
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_crm_commercial_settings_all on public.crm_commercial_settings;
create policy org_crm_commercial_settings_all on public.crm_commercial_settings
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_crm_commercial_catalogs_all on public.crm_commercial_catalogs;
create policy org_crm_commercial_catalogs_all on public.crm_commercial_catalogs
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_crm_profitability_snapshots_all on public.crm_customer_profitability_snapshots;
create policy org_crm_profitability_snapshots_all on public.crm_customer_profitability_snapshots
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_crm_profitability_details_all on public.crm_customer_profitability_details;
create policy org_crm_profitability_details_all on public.crm_customer_profitability_details
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_crm_customer_segments_all on public.crm_customer_segments;
create policy org_crm_customer_segments_all on public.crm_customer_segments
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_crm_customer_recommendations_all on public.crm_customer_recommendations;
create policy org_crm_customer_recommendations_all on public.crm_customer_recommendations
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

insert into public.crm_commercial_catalogs (organization_id, catalog_type, code, label, sort_order)
select
  o.id,
  seed.catalog_type,
  seed.code,
  seed.label,
  seed.sort_order
from public.organizations o
cross join (
  values
    ('prospect_status', 'nuevo', 'Nuevo', 10),
    ('prospect_status', 'contactado', 'Contactado', 20),
    ('prospect_status', 'interesado', 'Interesado', 30),
    ('prospect_status', 'cotizacion_enviada', 'Cotizacion enviada', 40),
    ('prospect_status', 'negociacion', 'Negociacion', 50),
    ('prospect_status', 'prueba_producto', 'Prueba de producto', 60),
    ('prospect_status', 'aprobado', 'Aprobado', 70),
    ('prospect_status', 'convertido', 'Convertido a cliente', 80),
    ('prospect_status', 'perdido', 'Perdido', 90),
    ('prospect_status', 'sin_respuesta', 'Sin respuesta', 100),
    ('prospect_status', 'pausado', 'Pausado', 110),
    ('followup_type', 'llamada', 'Llamada', 10),
    ('followup_type', 'whatsapp', 'WhatsApp', 20),
    ('followup_type', 'correo', 'Correo', 30),
    ('followup_type', 'visita', 'Visita', 40),
    ('followup_type', 'reunion', 'Reunion', 50),
    ('followup_type', 'envio_muestra', 'Envio de muestra', 60),
    ('followup_type', 'seguimiento_cotizacion', 'Seguimiento de cotizacion', 70),
    ('followup_type', 'seguimiento_pago', 'Seguimiento de pago', 80),
    ('followup_type', 'reclamo', 'Reclamo', 90),
    ('followup_type', 'renovacion_precio', 'Renovacion de precio', 100),
    ('followup_type', 'reactivacion_cliente', 'Reactivacion de cliente', 110),
    ('followup_type', 'otro', 'Otro', 120),
    ('alert_type', 'cliente_inactivo', 'Cliente inactivo', 10),
    ('alert_type', 'caida_volumen', 'Caida de volumen', 20),
    ('alert_type', 'margen_bajo', 'Margen bajo', 30),
    ('alert_type', 'rentabilidad_negativa', 'Rentabilidad negativa', 40),
    ('alert_type', 'mora_alta', 'Mora alta', 50),
    ('alert_type', 'reclamos_recurrentes', 'Reclamos recurrentes', 60),
    ('alert_type', 'prospecto_sin_seguimiento', 'Prospecto sin seguimiento', 70),
    ('alert_type', 'cotizacion_sin_seguimiento', 'Cotizacion sin seguimiento', 80)
) as seed(catalog_type, code, label, sort_order)
on conflict (organization_id, catalog_type, code) do nothing;

insert into public.crm_commercial_settings (organization_id, setting_key, setting_value, description)
select
  o.id,
  seed.setting_key,
  seed.setting_value,
  seed.description
from public.organizations o
cross join (
  values
    ('commercial_rules', '{"inactive_days":21,"volume_drop_pct":35,"min_margin_pct":0.12,"target_margin_pct":0.2,"max_days_without_prospect_followup":7,"max_days_without_quote_followup":5,"strategic_amount_min":5000,"strategic_volume_min":1000,"late_days_alert":15,"late_days_block":30,"claim_threshold":3}'::jsonb, 'Reglas base del modulo comercial'),
    ('commercial_permissions', '{"admin":["*"],"gerencia":["dashboard","prospects","followups","profitability","intelligence","settings"],"comercial":["dashboard","prospects","followups","intelligence"],"vendedor":["dashboard","prospects","followups"],"cobros":["dashboard","intelligence"],"logistica":["dashboard","intelligence"],"solo_lectura":["dashboard"]}'::jsonb, 'Permisos sugeridos por rol')
) as seed(setting_key, setting_value, description)
on conflict (organization_id, setting_key) do nothing;

create or replace function public.crm_complete_followup(
  p_followup_id uuid,
  p_result text,
  p_next_action text default null,
  p_next_scheduled_at timestamptz default null
) returns public.crm_followups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_followup public.crm_followups;
begin
  update public.crm_followups
     set status = 'realizado',
         result = p_result,
         next_action = coalesce(p_next_action, next_action),
         completed_at = now(),
         updated_by = auth.uid()
   where id = p_followup_id
     and organization_id = public.get_my_profile_org()
  returning * into v_followup;

  if v_followup.id is null then
    raise exception 'Seguimiento no encontrado';
  end if;

  if p_next_scheduled_at is not null then
    insert into public.crm_followups (
      organization_id,
      client_id,
      prospect_id,
      quote_id,
      followup_type,
      responsible_id,
      scheduled_at,
      priority,
      status,
      notes,
      auto_created,
      parent_followup_id,
      created_by,
      updated_by
    ) values (
      v_followup.organization_id,
      v_followup.client_id,
      v_followup.prospect_id,
      v_followup.quote_id,
      v_followup.followup_type,
      v_followup.responsible_id,
      p_next_scheduled_at,
      v_followup.priority,
      'pendiente',
      p_next_action,
      true,
      v_followup.id,
      auth.uid(),
      auth.uid()
    );
  end if;

  return v_followup;
end;
$$;

grant all on table public.crm_followups to anon;
grant all on table public.crm_followups to authenticated;
grant all on table public.crm_followups to service_role;
grant all on table public.crm_commercial_alerts to anon;
grant all on table public.crm_commercial_alerts to authenticated;
grant all on table public.crm_commercial_alerts to service_role;
grant all on table public.crm_commercial_settings to anon;
grant all on table public.crm_commercial_settings to authenticated;
grant all on table public.crm_commercial_settings to service_role;
grant all on table public.crm_commercial_catalogs to anon;
grant all on table public.crm_commercial_catalogs to authenticated;
grant all on table public.crm_commercial_catalogs to service_role;
grant all on table public.crm_customer_profitability_snapshots to anon;
grant all on table public.crm_customer_profitability_snapshots to authenticated;
grant all on table public.crm_customer_profitability_snapshots to service_role;
grant all on table public.crm_customer_profitability_details to anon;
grant all on table public.crm_customer_profitability_details to authenticated;
grant all on table public.crm_customer_profitability_details to service_role;
grant all on table public.crm_customer_segments to anon;
grant all on table public.crm_customer_segments to authenticated;
grant all on table public.crm_customer_segments to service_role;
grant all on table public.crm_customer_recommendations to anon;
grant all on table public.crm_customer_recommendations to authenticated;
grant all on table public.crm_customer_recommendations to service_role;

grant execute on function public.crm_complete_followup(uuid, text, text, timestamptz) to anon;
grant execute on function public.crm_complete_followup(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.crm_complete_followup(uuid, text, text, timestamptz) to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'crm_followups'
  ) then
    alter publication supabase_realtime add table public.crm_followups;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'crm_commercial_alerts'
  ) then
    alter publication supabase_realtime add table public.crm_commercial_alerts;
  end if;
end
$$;
