-- Enable RLS on legacy public tables that predate the newer org-scoped migrations.
-- Policies follow the current ERP model: authenticated users can work only inside
-- their profile organization; service_role keeps bypassing RLS for trusted functions.

do $$
declare
  v_table text;
  v_policy text;
  v_tables text[] := array[
    'accounting_accounts',
    'anticipos_empleado',
    'bank_accounts',
    'bank_movements',
    'bank_transfers',
    'cash_box_liquidations',
    'cash_box_movements',
    'cash_boxes',
    'cash_flow_categories',
    'cash_flow_manual_items',
    'cash_flow_projection_overrides',
    'cash_flow_scenarios',
    'cash_flow_settings',
    'cash_flow_simulations',
    'client_agreed_prices',
    'conceptos_nomina',
    'cost_centers',
    'empleado_salario_historial',
    'empleados',
    'expenses',
    'finished_inventory_lots',
    'incapacidades_empleado',
    'nomina_pago_detalle',
    'nomina_pagos',
    'nomina_periodos',
    'order_claims',
    'order_deliveries',
    'order_logistics',
    'packaging_run_inputs',
    'packaging_runs',
    'parametros_nomina',
    'prestamos_empleado',
    'prestamos_empleado_movimientos',
    'prospects',
    'provisiones_laborales',
    'quotes',
    'recipes',
    'salespeople',
    'supplier_accounts_payable',
    'supplier_payment_batches',
    'vacaciones_empleado',
    'vacaciones_saldos'
  ];
begin
  foreach v_table in array v_tables
  loop
    v_policy := 'org_' || v_table || '_all';

    execute format('alter table public.%I enable row level security', v_table);
    execute format('drop policy if exists %I on public.%I', v_policy, v_table);
    execute format(
      'create policy %I on public.%I
        using (organization_id = public.get_my_profile_org())
        with check (organization_id = public.get_my_profile_org())',
      v_policy,
      v_table
    );
  end loop;
end $$;

alter table public.order_delivery_items enable row level security;
drop policy if exists org_order_delivery_items_all on public.order_delivery_items;
create policy org_order_delivery_items_all on public.order_delivery_items
  using (exists (
    select 1
      from public.order_deliveries d
      where d.id = order_delivery_items.delivery_id
        and d.organization_id = public.get_my_profile_org()
  ))
  with check (exists (
    select 1
      from public.order_deliveries d
      where d.id = order_delivery_items.delivery_id
        and d.organization_id = public.get_my_profile_org()
  ));

alter table public.quote_items enable row level security;
drop policy if exists org_quote_items_all on public.quote_items;
create policy org_quote_items_all on public.quote_items
  using (exists (
    select 1
      from public.quotes q
      where q.id = quote_items.quote_id
        and q.organization_id = public.get_my_profile_org()
  ))
  with check (exists (
    select 1
      from public.quotes q
      where q.id = quote_items.quote_id
        and q.organization_id = public.get_my_profile_org()
  ));

alter table public.recipe_items enable row level security;
drop policy if exists org_recipe_items_all on public.recipe_items;
create policy org_recipe_items_all on public.recipe_items
  using (exists (
    select 1
      from public.recipes r
      where r.id = recipe_items.recipe_id
        and r.organization_id = public.get_my_profile_org()
  ))
  with check (exists (
    select 1
      from public.recipes r
      where r.id = recipe_items.recipe_id
        and r.organization_id = public.get_my_profile_org()
  ));
