-- Supabase security advisor: fix Security Definer View warnings.
-- security_invoker makes these views run with the querying user's permissions,
-- so underlying table RLS policies are respected.

create or replace view public.v_costo_laboral_diario
with (security_invoker = true)
as
select
  organization_id,
  fecha,
  sum(coalesce(costo_total_preliminar_dia, coalesce(costo_dia_preliminar, 0::numeric) + coalesce(costo_extra_preliminar, 0::numeric))) as costo_laboral_total,
  sum(coalesce(horas_trabajadas, 0::numeric)) as total_horas_trabajadas,
  sum(coalesce(exceso_dia, 0::numeric)) as total_horas_extra,
  count(*) as total_colaboradores,
  count(*) filter (where hora_salida is null and estado = 'incompleta') as sin_salida
from public.marcaciones
where estado = any (array['completa'::text, 'aprobada'::text, 'pendiente_revision'::text])
group by organization_id, fecha;

create or replace view public.v_produccion_diaria
with (security_invoker = true)
as
select
  organization_id,
  run_date as fecha,
  sum(coalesce(packed_weight_lb, 0::numeric)) as libras_producidas,
  sum(coalesce(quantity_produced, 0::numeric)) as unidades_producidas,
  count(*) as total_runs
from public.packaging_runs
where status = any (array['completed'::text, 'completado'::text])
group by organization_id, run_date;

create or replace view public.v_reclamos_calidad_sku
with (security_invoker = true)
as
select
  oc.organization_id,
  oi.product_presentation_id,
  date(oc.created_at) as fecha,
  oc.id as reclamo_id
from public.order_claims oc
join public.order_items oi on oi.order_id = oc.order_id
where oc.claim_type = 'calidad'
  and oc.status <> 'anulado';

revoke all on table public.v_costo_laboral_diario from anon;
revoke all on table public.v_produccion_diaria from anon;
revoke all on table public.v_reclamos_calidad_sku from anon;

grant select on table public.v_costo_laboral_diario to authenticated;
grant select on table public.v_produccion_diaria to authenticated;
grant select on table public.v_reclamos_calidad_sku to authenticated;
grant select on table public.v_costo_laboral_diario to service_role;
grant select on table public.v_produccion_diaria to service_role;
grant select on table public.v_reclamos_calidad_sku to service_role;
