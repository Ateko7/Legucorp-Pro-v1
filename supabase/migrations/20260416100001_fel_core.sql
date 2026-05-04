-- FEL (Facturación Electrónica Guatemala) core module.
-- Genérico y transversal: soporta pedidos regulares, intercompany y exportación.
-- También cierra el gap de relieve de inventario al hacer packing (pre-existente).

-- ============================================================
-- 1. Certificadores FEL (InfilePlus, Megaprint, FACE, etc.)
-- ============================================================
create table if not exists public.fel_certificadores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nombre text not null,
  adapter_key text not null check (adapter_key in ('infile', 'megaprint', 'face', 'mock')),
  endpoint text not null,
  credentials_vault_ref text not null,
  ambiente text not null default 'sandbox' check (ambiente in ('sandbox', 'produccion')),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, nombre)
);

create unique index if not exists uq_fel_certificadores_default
  on public.fel_certificadores (organization_id)
  where is_default and is_active;

-- ============================================================
-- 2. fel_documents — documento fiscal polimórfico
-- ============================================================
create table if not exists public.fel_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- Identificación fiscal
  tipo_documento text not null check (tipo_documento in ('FACT','FCAM','FESP','NCRE','NDEB','NABN','RECI','FACA','FAPE')),
  serie text,
  numero text,
  fecha_emision timestamptz not null default now(),

  -- Emisor / Receptor
  emisor_nit text not null,
  emisor_nombre text,
  receptor_nit text,
  receptor_nombre text,
  receptor_direccion text,
  receptor_email text,

  -- Totales
  moneda text not null default 'GTQ',
  tipo_cambio numeric(14,6),
  subtotal numeric(14,4) not null default 0,
  descuento numeric(14,4) not null default 0,
  iva numeric(14,4) not null default 0,
  otros_impuestos numeric(14,4) not null default 0,
  total numeric(14,4) not null default 0,
  es_exportacion boolean not null default false,

  -- FEL / DTE
  certificador_id uuid references public.fel_certificadores(id) on delete set null,
  dte_uuid text,
  numero_autorizacion text,
  xml_firmado_url text,
  cafe_pdf_url text,
  fecha_certificacion timestamptz,
  estado_fel text not null default 'pending'
    check (estado_fel in ('draft','pending','certifying','certified','rejected','annulled','cancelled')),
  fel_error_json jsonb,
  intentos_certificacion integer not null default 0,

  -- Fuente polimórfica (de dónde viene el documento)
  source_type text not null check (source_type in ('order','intercompany_shipment_ack','manual','export_legacy')),
  source_id uuid,

  -- Relación con otro documento FEL (notas de crédito/débito/anulación)
  related_fel_document_id uuid references public.fel_documents(id) on delete set null,

  -- Contabilidad
  journal_entry_id uuid,

  -- Auditoría
  notas text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, tipo_documento, serie, numero)
);

create index if not exists idx_fel_documents_org_estado on public.fel_documents(organization_id, estado_fel, fecha_emision desc);
create index if not exists idx_fel_documents_source on public.fel_documents(source_type, source_id);
create index if not exists idx_fel_documents_dte_uuid on public.fel_documents(dte_uuid) where dte_uuid is not null;

-- ============================================================
-- 3. fel_document_lines
-- ============================================================
create table if not exists public.fel_document_lines (
  id uuid primary key default gen_random_uuid(),
  fel_document_id uuid not null references public.fel_documents(id) on delete cascade,
  line_no integer not null,
  descripcion text not null,
  codigo_producto text,
  cantidad numeric(14,4) not null,
  unidad_medida text not null default 'UNI',
  precio_unitario numeric(14,6) not null,
  descuento numeric(14,4) not null default 0,
  subtotal numeric(14,4) not null,
  iva numeric(14,4) not null default 0,
  total_linea numeric(14,4) not null,
  bien_o_servicio text not null default 'B' check (bien_o_servicio in ('B','S')),

  -- Enlace a origen
  source_line_type text check (source_line_type in ('order_item','intercompany_receipt_lot','manual')),
  source_line_id uuid,

  created_at timestamptz not null default now(),
  unique (fel_document_id, line_no)
);

create index if not exists idx_fel_document_lines_doc on public.fel_document_lines(fel_document_id);
create index if not exists idx_fel_document_lines_source on public.fel_document_lines(source_line_type, source_line_id);

-- ============================================================
-- 4. Extensiones a orders
-- ============================================================
alter table public.orders
  add column if not exists tipo_pedido text not null default 'regular'
    check (tipo_pedido in ('regular','intercompany','exportacion')),
  add column if not exists intercompany_partner_id uuid, -- FK added in next migration
  add column if not exists fel_document_id uuid references public.fel_documents(id) on delete set null;

create index if not exists idx_orders_tipo_pedido on public.orders(organization_id, tipo_pedido);
create index if not exists idx_orders_intercompany_partner on public.orders(intercompany_partner_id) where intercompany_partner_id is not null;
create index if not exists idx_orders_fel_document on public.orders(fel_document_id) where fel_document_id is not null;

-- Ampliar el estado (antes era texto libre, formalizamos los valores permitidos).
-- Nota: preservamos los valores históricos ya usados en producción.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_status_check'
  ) then
    alter table public.orders
      add constraint orders_status_check
      check (status in (
        'borrador','confirmado','empacado','despachado','facturado',
        'en_logistica','entregado','cobrado','cancelado','reclamado',
        'en_packing','listo_despacho','en_ruta'
      ));
  end if;
end $$;

-- ============================================================
-- 5. Extensiones a clients (partner ↔ client interno)
-- ============================================================
alter table public.clients
  add column if not exists intercompany_partner_id uuid, -- FK added in next migration
  add column if not exists is_intercompany boolean not null default false;

create index if not exists idx_clients_intercompany_partner
  on public.clients(intercompany_partner_id) where intercompany_partner_id is not null;

-- ============================================================
-- 6. Extensiones a finished_inventory_lots (estado de despacho)
-- ============================================================
alter table public.finished_inventory_lots
  add column if not exists shipping_status text not null default 'available'
    check (shipping_status in ('available','reserved','in_transit','shipped')),
  add column if not exists in_transit_to_partner_id uuid,
  add column if not exists in_transit_since timestamptz;

create index if not exists idx_finished_lots_shipping
  on public.finished_inventory_lots(organization_id, shipping_status)
  where shipping_status <> 'available';

-- ============================================================
-- 7. Trigger de relieve de inventario al hacer packing
-- (gap preexistente — se resuelve aquí porque FEL e intercompany lo requieren)
-- ============================================================
create or replace function public.trg_order_packing_relieve_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available numeric;
begin
  if tg_op = 'INSERT' then
    select available_quantity into v_available
      from public.finished_inventory_lots
      where id = new.finished_inventory_lot_id
      for update;

    if v_available is null then
      raise exception 'Lote % no existe', new.finished_inventory_lot_id;
    end if;

    if v_available < new.quantity_packed then
      raise exception 'Stock insuficiente en lote %: disponible %, requerido %',
        new.finished_inventory_lot_id, v_available, new.quantity_packed;
    end if;

    update public.finished_inventory_lots
      set available_quantity = available_quantity - new.quantity_packed,
          updated_at = now()
      where id = new.finished_inventory_lot_id;

    update public.order_items
      set quantity_packed = quantity_packed + new.quantity_packed
      where id = new.order_item_id;

    return new;
  elsif tg_op = 'DELETE' then
    update public.finished_inventory_lots
      set available_quantity = available_quantity + old.quantity_packed,
          updated_at = now()
      where id = old.finished_inventory_lot_id;

    update public.order_items
      set quantity_packed = greatest(0, quantity_packed - old.quantity_packed)
      where id = old.order_item_id;

    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_order_packings_relieve on public.order_packings;
create trigger trg_order_packings_relieve
  after insert or delete on public.order_packings
  for each row execute function public.trg_order_packing_relieve_inventory();

-- ============================================================
-- 8. Trigger updated_at para fel_documents y fel_certificadores
-- ============================================================
create or replace function public.trg_touch_updated_at()
returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_fel_documents_touch on public.fel_documents;
create trigger trg_fel_documents_touch
  before update on public.fel_documents
  for each row execute function public.trg_touch_updated_at();

drop trigger if exists trg_fel_certificadores_touch on public.fel_certificadores;
create trigger trg_fel_certificadores_touch
  before update on public.fel_certificadores
  for each row execute function public.trg_touch_updated_at();

-- ============================================================
-- 9. RLS
-- ============================================================
alter table public.fel_certificadores enable row level security;
alter table public.fel_documents enable row level security;
alter table public.fel_document_lines enable row level security;

drop policy if exists org_fel_certificadores_all on public.fel_certificadores;
create policy org_fel_certificadores_all on public.fel_certificadores
  using (organization_id = public.get_my_profile_org())
  with check (organization_id = public.get_my_profile_org());

drop policy if exists org_fel_documents_all on public.fel_documents;
create policy org_fel_documents_all on public.fel_documents
  using (organization_id = public.get_my_profile_org())
  with check (organization_id = public.get_my_profile_org());

drop policy if exists org_fel_document_lines_all on public.fel_document_lines;
create policy org_fel_document_lines_all on public.fel_document_lines
  using (
    exists (
      select 1 from public.fel_documents d
      where d.id = fel_document_lines.fel_document_id
        and d.organization_id = public.get_my_profile_org()
    )
  )
  with check (
    exists (
      select 1 from public.fel_documents d
      where d.id = fel_document_lines.fel_document_id
        and d.organization_id = public.get_my_profile_org()
    )
  );
