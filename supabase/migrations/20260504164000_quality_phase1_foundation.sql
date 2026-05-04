alter table public.inspecciones_calidad
  alter column product_presentation_id drop not null;

alter table public.inspecciones_calidad
  add column if not exists inspection_stage text not null default 'empaque_final',
  add column if not exists spec_template_id uuid,
  add column if not exists source_reception_id uuid,
  add column if not exists source_process_output_id uuid,
  add column if not exists source_processed_lot_id uuid,
  add column if not exists resultado_sugerido text,
  add column if not exists resultado_automatico text,
  add column if not exists override_reason text,
  add column if not exists override_by uuid;

alter table public.inspecciones_calidad
  drop constraint if exists inspecciones_calidad_inspection_stage_check;

alter table public.inspecciones_calidad
  add constraint inspecciones_calidad_inspection_stage_check
  check (inspection_stage = any (array['recepcion_mp'::text, 'proceso'::text, 'empaque_final'::text]));

alter table public.inspecciones_calidad
  drop constraint if exists inspecciones_calidad_resultado_sugerido_check;

alter table public.inspecciones_calidad
  add constraint inspecciones_calidad_resultado_sugerido_check
  check (
    resultado_sugerido is null
    or resultado_sugerido = any (array['liberado'::text, 'liberado_con_observacion'::text, 'retenido'::text, 'rechazado'::text])
  );

alter table public.inspecciones_calidad
  drop constraint if exists inspecciones_calidad_resultado_automatico_check;

alter table public.inspecciones_calidad
  add constraint inspecciones_calidad_resultado_automatico_check
  check (
    resultado_automatico is null
    or resultado_automatico = any (array['liberado'::text, 'liberado_con_observacion'::text, 'retenido'::text, 'rechazado'::text])
  );

create table if not exists public.quality_spec_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  inspection_stage text not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quality_spec_templates_stage_check
    check (inspection_stage = any (array['recepcion_mp'::text, 'proceso'::text, 'empaque_final'::text]))
);

create table if not exists public.quality_spec_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id uuid not null references public.quality_spec_templates(id) on delete cascade,
  sort_order integer not null default 0,
  code text not null,
  label text not null,
  measurement_type text not null,
  unit text,
  min_value numeric(14,4),
  max_value numeric(14,4),
  expected_boolean boolean,
  allowed_values jsonb not null default '[]'::jsonb,
  defect_threshold integer,
  severity text not null default 'menor',
  decision_effect text not null default 'liberado_con_observacion',
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quality_spec_rules_measurement_type_check
    check (measurement_type = any (array['boolean'::text, 'numeric'::text, 'select'::text, 'defect_count'::text])),
  constraint quality_spec_rules_severity_check
    check (severity = any (array['menor'::text, 'mayor'::text, 'critico'::text])),
  constraint quality_spec_rules_decision_effect_check
    check (decision_effect = any (array['liberado_con_observacion'::text, 'retenido'::text, 'rechazado'::text]))
);

create table if not exists public.quality_inspection_measurements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  inspection_id uuid not null references public.inspecciones_calidad(id) on delete cascade,
  spec_rule_id uuid not null references public.quality_spec_rules(id) on delete restrict,
  rule_snapshot jsonb not null default '{}'::jsonb,
  actual_numeric numeric(14,4),
  actual_boolean boolean,
  actual_text text,
  actual_count integer,
  pass boolean not null default true,
  triggered_result text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quality_inspection_measurements_triggered_result_check
    check (
      triggered_result is null
      or triggered_result = any (array['liberado_con_observacion'::text, 'retenido'::text, 'rechazado'::text])
    )
);

create table if not exists public.quality_non_conformities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  inspection_id uuid references public.inspecciones_calidad(id) on delete set null,
  inspection_stage text not null,
  source_reception_id uuid references public.material_receptions(id) on delete set null,
  source_process_output_id uuid references public.material_process_stage_outputs(id) on delete set null,
  source_processed_lot_id uuid references public.processed_inventory_lots(id) on delete set null,
  finished_lot_id uuid references public.finished_inventory_lots(id) on delete set null,
  product_presentation_id uuid references public.product_presentations(id) on delete set null,
  title text not null,
  defect_detected text,
  severity text not null default 'menor',
  immediate_disposition text not null default 'segregar',
  status text not null default 'abierta',
  root_cause text,
  corrective_action text,
  preventive_action text,
  responsible_user_id uuid references public.profiles(id) on delete set null,
  due_date date,
  closed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quality_non_conformities_stage_check
    check (inspection_stage = any (array['recepcion_mp'::text, 'proceso'::text, 'empaque_final'::text])),
  constraint quality_non_conformities_severity_check
    check (severity = any (array['menor'::text, 'mayor'::text, 'critico'::text])),
  constraint quality_non_conformities_disposition_check
    check (
      immediate_disposition = any (
        array['retrabajo'::text, 'segregar'::text, 'devolver'::text, 'desechar'::text, 'liberar_con_excepcion'::text]
      )
    ),
  constraint quality_non_conformities_status_check
    check (
      status = any (
        array['abierta'::text, 'en_investigacion'::text, 'accion_en_curso'::text, 'cerrada'::text, 'vencida'::text]
      )
    )
);

create table if not exists public.quality_corrective_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  non_conformity_id uuid not null references public.quality_non_conformities(id) on delete cascade,
  action_type text not null,
  description text not null,
  responsible_user_id uuid references public.profiles(id) on delete set null,
  due_date date,
  status text not null default 'pendiente',
  completed_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quality_corrective_actions_type_check
    check (action_type = any (array['correctiva'::text, 'preventiva'::text])),
  constraint quality_corrective_actions_status_check
    check (status = any (array['pendiente'::text, 'en_curso'::text, 'completada'::text, 'vencida'::text]))
);

alter table public.inspecciones_calidad
  add constraint inspecciones_calidad_spec_template_id_fkey
  foreign key (spec_template_id) references public.quality_spec_templates(id) on delete set null;

alter table public.inspecciones_calidad
  add constraint inspecciones_calidad_source_reception_id_fkey
  foreign key (source_reception_id) references public.material_receptions(id) on delete set null;

alter table public.inspecciones_calidad
  add constraint inspecciones_calidad_source_process_output_id_fkey
  foreign key (source_process_output_id) references public.material_process_stage_outputs(id) on delete set null;

alter table public.inspecciones_calidad
  add constraint inspecciones_calidad_source_processed_lot_id_fkey
  foreign key (source_processed_lot_id) references public.processed_inventory_lots(id) on delete set null;

alter table public.inspecciones_calidad
  add constraint inspecciones_calidad_override_by_fkey
  foreign key (override_by) references public.profiles(id) on delete set null;

alter table public.material_inventory_lots
  add column if not exists bloqueado_calidad boolean not null default false,
  add column if not exists motivo_bloqueo_calidad text;

alter table public.material_process_stage_outputs
  add column if not exists bloqueado_calidad boolean not null default false,
  add column if not exists motivo_bloqueo_calidad text;

alter table public.processed_inventory_lots
  add column if not exists bloqueado_calidad boolean not null default false,
  add column if not exists motivo_bloqueo_calidad text;

create index if not exists idx_inspecciones_calidad_stage on public.inspecciones_calidad (organization_id, inspection_stage, fecha desc);
create index if not exists idx_inspecciones_calidad_sources on public.inspecciones_calidad (source_reception_id, source_process_output_id, source_processed_lot_id, finished_lot_id);
create index if not exists idx_quality_spec_templates_stage on public.quality_spec_templates (organization_id, inspection_stage, is_active);
create index if not exists idx_quality_spec_rules_template on public.quality_spec_rules (template_id, sort_order);
create index if not exists idx_quality_measurements_inspection on public.quality_inspection_measurements (inspection_id);
create index if not exists idx_quality_nc_status on public.quality_non_conformities (organization_id, status, due_date);
create index if not exists idx_material_inventory_lots_quality on public.material_inventory_lots (organization_id, bloqueado_calidad);
create index if not exists idx_material_process_outputs_quality on public.material_process_stage_outputs (organization_id, bloqueado_calidad);
create index if not exists idx_processed_inventory_lots_quality on public.processed_inventory_lots (organization_id, bloqueado_calidad);

create or replace trigger trg_quality_spec_templates_updated_at
before update on public.quality_spec_templates
for each row execute function public.set_updated_at();

create or replace trigger trg_quality_spec_rules_updated_at
before update on public.quality_spec_rules
for each row execute function public.set_updated_at();

create or replace trigger trg_quality_inspection_measurements_updated_at
before update on public.quality_inspection_measurements
for each row execute function public.set_updated_at();

create or replace trigger trg_quality_non_conformities_updated_at
before update on public.quality_non_conformities
for each row execute function public.set_updated_at();

create or replace trigger trg_quality_corrective_actions_updated_at
before update on public.quality_corrective_actions
for each row execute function public.set_updated_at();

alter table public.quality_spec_templates enable row level security;
alter table public.quality_spec_rules enable row level security;
alter table public.quality_inspection_measurements enable row level security;
alter table public.quality_non_conformities enable row level security;
alter table public.quality_corrective_actions enable row level security;

create policy quality_spec_templates_same_org_all on public.quality_spec_templates
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

create policy quality_spec_rules_same_org_all on public.quality_spec_rules
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

create policy quality_inspection_measurements_same_org_all on public.quality_inspection_measurements
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

create policy quality_non_conformities_same_org_all on public.quality_non_conformities
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

create policy quality_corrective_actions_same_org_all on public.quality_corrective_actions
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

alter publication supabase_realtime add table public.quality_spec_templates;
alter publication supabase_realtime add table public.quality_spec_rules;
alter publication supabase_realtime add table public.quality_inspection_measurements;
alter publication supabase_realtime add table public.quality_non_conformities;
alter publication supabase_realtime add table public.quality_corrective_actions;

grant all on table public.quality_spec_templates to anon, authenticated, service_role;
grant all on table public.quality_spec_rules to anon, authenticated, service_role;
grant all on table public.quality_inspection_measurements to anon, authenticated, service_role;
grant all on table public.quality_non_conformities to anon, authenticated, service_role;
grant all on table public.quality_corrective_actions to anon, authenticated, service_role;
