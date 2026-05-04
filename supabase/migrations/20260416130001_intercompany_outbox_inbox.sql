-- Intercompany bridge: transactional outbox + inbox.
-- Entrega garantizada, idempotente y auditable de eventos entre ERPs.

-- ============================================================
-- 1. Outbox (eventos salientes)
-- ============================================================
create table if not exists public.intercompany_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  partner_id uuid not null references public.intercompany_partners(id) on delete cascade,

  event_type text not null check (event_type in (
    'order_confirmed',
    'shipment_dispatched',
    'invoice_certified',
    'invoice_annulled',
    'fel_certify',
    'ping'
  )),
  aggregate_id uuid,                              -- id del recurso de dominio (order, fel_document, etc.)
  idempotency_key text not null unique,

  payload_json jsonb not null,
  schema_version integer not null default 1,
  signed_payload text,                            -- payload serializado + firma HMAC

  status text not null default 'pending'
    check (status in ('pending','sending','sent','acked','failed','cancelled')),
  retry_count integer not null default 0,
  max_retries integer not null default 10,
  next_retry_at timestamptz not null default now(),
  last_error text,

  sent_at timestamptz,
  acked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_intercompany_outbox_due
  on public.intercompany_outbox(status, next_retry_at)
  where status = 'pending';

create index if not exists idx_intercompany_outbox_partner
  on public.intercompany_outbox(partner_id, created_at desc);

-- ============================================================
-- 2. Inbox (eventos entrantes)
-- ============================================================
create table if not exists public.intercompany_inbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  partner_id uuid not null references public.intercompany_partners(id) on delete cascade,

  event_type text not null check (event_type in (
    'order_confirmed',
    'shipment_dispatched',
    'invoice_certified',
    'invoice_annulled',
    'lot_received_ack',
    'discrepancia',
    'ping'
  )),
  idempotency_key text not null unique,

  payload_json jsonb not null,
  schema_version integer not null default 1,
  signature_valid boolean not null default false,
  sender_nit text,

  status text not null default 'pending'
    check (status in ('pending','processing','processed','failed','skipped')),
  processing_error text,
  processed_at timestamptz,

  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_intercompany_inbox_pending
  on public.intercompany_inbox(status, received_at)
  where status = 'pending';

create index if not exists idx_intercompany_inbox_partner
  on public.intercompany_inbox(partner_id, received_at desc);

-- ============================================================
-- 3. Triggers updated_at
-- ============================================================
drop trigger if exists trg_intercompany_outbox_touch on public.intercompany_outbox;
create trigger trg_intercompany_outbox_touch
  before update on public.intercompany_outbox
  for each row execute function public.trg_touch_updated_at();

drop trigger if exists trg_intercompany_inbox_touch on public.intercompany_inbox;
create trigger trg_intercompany_inbox_touch
  before update on public.intercompany_inbox
  for each row execute function public.trg_touch_updated_at();

-- ============================================================
-- 4. Helper: enqueue_intercompany_event (llamado desde triggers/servicios)
-- ============================================================
create or replace function public.enqueue_intercompany_event(
  p_partner_id uuid,
  p_event_type text,
  p_aggregate_id uuid,
  p_payload jsonb,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_org uuid;
  v_key text;
begin
  select organization_id into v_org
    from public.intercompany_partners where id = p_partner_id;
  if v_org is null then
    raise exception 'Partner % no existe', p_partner_id;
  end if;

  v_key := coalesce(p_idempotency_key,
    p_event_type || ':' || coalesce(p_aggregate_id::text, gen_random_uuid()::text) || ':' || extract(epoch from now())::text
  );

  insert into public.intercompany_outbox (
    organization_id, partner_id, event_type, aggregate_id,
    idempotency_key, payload_json
  ) values (
    v_org, p_partner_id, p_event_type, p_aggregate_id,
    v_key, p_payload
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.enqueue_intercompany_event(uuid, text, uuid, jsonb, text)
  to authenticated, service_role;

-- ============================================================
-- 5. RLS — outbox/inbox son SOLO service_role (no accesible por authenticated directamente;
-- se expone a UI ops via vistas filtradas o RPC explícito).
-- Permitimos SELECT a usuarios de la org para vistas de monitoreo.
-- ============================================================
alter table public.intercompany_outbox enable row level security;
alter table public.intercompany_inbox enable row level security;

drop policy if exists org_intercompany_outbox_read on public.intercompany_outbox;
create policy org_intercompany_outbox_read on public.intercompany_outbox
  for select using (organization_id = public.get_my_profile_org());

drop policy if exists org_intercompany_inbox_read on public.intercompany_inbox;
create policy org_intercompany_inbox_read on public.intercompany_inbox
  for select using (organization_id = public.get_my_profile_org());

-- INSERT/UPDATE/DELETE quedan restringidos a service_role (sin políticas para authenticated).
