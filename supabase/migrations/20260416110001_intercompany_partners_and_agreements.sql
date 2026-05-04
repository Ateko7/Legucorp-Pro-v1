-- Intercompany partners + price agreements (cost-plus).
-- Cierra las FKs diferidas de la migración anterior (orders.intercompany_partner_id,
-- clients.intercompany_partner_id, finished_inventory_lots.in_transit_to_partner_id).

-- ============================================================
-- 1. intercompany_partners
-- ============================================================
create table if not exists public.intercompany_partners (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- Identificación
  codigo text not null,                     -- código corto (e.g. "ERP2")
  nombre text not null,                     -- nombre comercial
  tax_id text not null,                     -- NIT de la entidad contraparte
  partner_org_id uuid,                      -- UUID de la organización del otro Supabase

  -- Bridge / conectividad
  endpoint_url text,                        -- URL del Edge Function receive del partner
  public_key text,                          -- clave pública del partner (para verificar firmas)
  shared_secret_vault_ref text,             -- referencia en Supabase Vault (nunca el secreto)

  -- Defaults comerciales
  currency text not null default 'GTQ',
  default_payment_terms integer not null default 30,
  default_client_id uuid references public.clients(id) on delete set null,
  default_fel_tipo_documento text not null default 'FACT'
    check (default_fel_tipo_documento in ('FACT','FCAM','FESP','FACA','FAPE')),

  -- Estado
  is_active boolean not null default true,
  notas text,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, codigo)
);

create index if not exists idx_intercompany_partners_org_active
  on public.intercompany_partners(organization_id, is_active);

-- ============================================================
-- 2. Cerrar las FKs diferidas de la migración 100001
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_intercompany_partner_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_intercompany_partner_id_fkey
      foreign key (intercompany_partner_id)
      references public.intercompany_partners(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_intercompany_partner_id_fkey'
  ) then
    alter table public.clients
      add constraint clients_intercompany_partner_id_fkey
      foreign key (intercompany_partner_id)
      references public.intercompany_partners(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'finished_inventory_lots_in_transit_partner_fkey'
  ) then
    alter table public.finished_inventory_lots
      add constraint finished_inventory_lots_in_transit_partner_fkey
      foreign key (in_transit_to_partner_id)
      references public.intercompany_partners(id)
      on delete set null;
  end if;
end $$;

-- ============================================================
-- 3. intercompany_price_agreements (cost-plus)
-- ============================================================
create table if not exists public.intercompany_price_agreements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  partner_id uuid not null references public.intercompany_partners(id) on delete cascade,

  -- Scope
  scope_type text not null check (scope_type in ('sku','product','category','global')),
  sku_id uuid,                              -- FK a skus si existe (scope 'sku')
  product_base_id uuid,                     -- FK a product_bases (scope 'product')
  category text,                            -- texto libre (scope 'category')

  -- Método (hoy solo cost_plus; extensible a CUP, resale, APA)
  method text not null default 'cost_plus' check (method in ('cost_plus','cup','resale','apa')),
  markup_pct numeric(9,4) not null check (markup_pct >= 0),

  currency text not null default 'GTQ',

  -- Vigencia
  valid_from date not null,
  valid_to date,

  -- Documentación de TP study
  tp_study_ref text,
  tp_study_url text,

  -- Aprobación
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  is_active boolean not null default true,

  notas text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (
    (scope_type = 'sku' and sku_id is not null) or
    (scope_type = 'product' and product_base_id is not null) or
    (scope_type = 'category' and category is not null) or
    (scope_type = 'global')
  )
);

create index if not exists idx_intercompany_agreements_lookup
  on public.intercompany_price_agreements(partner_id, scope_type, valid_from, valid_to)
  where is_active;

-- ============================================================
-- 4. Trigger updated_at
-- ============================================================
drop trigger if exists trg_intercompany_partners_touch on public.intercompany_partners;
create trigger trg_intercompany_partners_touch
  before update on public.intercompany_partners
  for each row execute function public.trg_touch_updated_at();

drop trigger if exists trg_intercompany_agreements_touch on public.intercompany_price_agreements;
create trigger trg_intercompany_agreements_touch
  before update on public.intercompany_price_agreements
  for each row execute function public.trg_touch_updated_at();

-- ============================================================
-- 5. Auto-crear cliente interno al insertar partner
-- ============================================================
create or replace function public.fn_intercompany_partner_ensure_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  if new.default_client_id is null then
    insert into public.clients (
      organization_id, commercial_name, legal_name, nit,
      status, moneda_default, is_intercompany, intercompany_partner_id
    ) values (
      new.organization_id,
      new.nombre,
      new.nombre,
      new.tax_id,
      'activo',
      new.currency,
      true,
      new.id
    )
    returning id into v_client_id;

    update public.intercompany_partners
      set default_client_id = v_client_id
      where id = new.id;
  else
    update public.clients
      set is_intercompany = true,
          intercompany_partner_id = new.id
      where id = new.default_client_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_intercompany_partner_ensure_client on public.intercompany_partners;
create trigger trg_intercompany_partner_ensure_client
  after insert or update of default_client_id on public.intercompany_partners
  for each row execute function public.fn_intercompany_partner_ensure_client();

-- ============================================================
-- 6. RLS
-- ============================================================
alter table public.intercompany_partners enable row level security;
alter table public.intercompany_price_agreements enable row level security;

drop policy if exists org_intercompany_partners_all on public.intercompany_partners;
create policy org_intercompany_partners_all on public.intercompany_partners
  using (organization_id = public.get_my_profile_org())
  with check (organization_id = public.get_my_profile_org());

drop policy if exists org_intercompany_agreements_all on public.intercompany_price_agreements;
create policy org_intercompany_agreements_all on public.intercompany_price_agreements
  using (organization_id = public.get_my_profile_org())
  with check (organization_id = public.get_my_profile_org());
