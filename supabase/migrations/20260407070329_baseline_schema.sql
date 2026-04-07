


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."app_role_type" AS ENUM (
    'admin_1',
    'admin_2',
    'gerente_general',
    'gerente_operaciones',
    'produccion',
    'compras',
    'logistica',
    'inocuidad_calidad',
    'contabilidad',
    'recepcion',
    'bodega',
    'ventas'
);


ALTER TYPE "public"."app_role_type" OWNER TO "postgres";


CREATE TYPE "public"."material_category" AS ENUM (
    'materia_prima_vegetal',
    'material_empaque',
    'insumo_proceso',
    'producto_granel',
    'quimico_sanitizante',
    'otros'
);


ALTER TYPE "public"."material_category" OWNER TO "postgres";


CREATE TYPE "public"."process_stage_type" AS ENUM (
    'deshoje',
    'lavado',
    'secado'
);


ALTER TYPE "public"."process_stage_type" OWNER TO "postgres";


CREATE TYPE "public"."reception_status" AS ENUM (
    'recibido',
    'liberado',
    'rechazado'
);


ALTER TYPE "public"."reception_status" OWNER TO "postgres";


CREATE TYPE "public"."record_status" AS ENUM (
    'activo',
    'inactivo'
);


ALTER TYPE "public"."record_status" OWNER TO "postgres";


CREATE TYPE "public"."sku_category" AS ENUM (
    'empacado',
    'granel'
);


ALTER TYPE "public"."sku_category" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'Admin',
    'Gerente General',
    'Gerente de Operaciones',
    'Producción',
    'Compras',
    'Logística',
    'Inocuidad',
    'Contabilidad',
    'Recepción',
    'Bodega',
    'Ventas'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."before_insert_material_reception"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.internal_lot is null or trim(new.internal_lot) = '' then
    new.internal_lot := public.generate_material_reception_lot(
      new.organization_id,
      new.material_id,
      new.received_date
    );
  end if;

  new.quantity_rejected := greatest(
    coalesce(new.quantity_received, 0) - coalesce(new.quantity_accepted, 0),
    0
  );

  new.status := 'recibido';

  new.real_cost := coalesce(new.unit_cost, 0) * coalesce(new.quantity_received, 0);

  return new;
end;
$$;


ALTER FUNCTION "public"."before_insert_material_reception"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."before_update_material_reception"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  new.quantity_rejected := greatest(
    coalesce(new.quantity_received, 0) - coalesce(new.quantity_accepted, 0),
    0
  );

  new.real_cost := coalesce(new.unit_cost, 0) * coalesce(new.quantity_received, 0);

  return new;
end;
$$;


ALTER FUNCTION "public"."before_update_material_reception"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calcular_merma_fn"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.merma_calculada := NEW.cantidad_entrada - NEW.cantidad_salida;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."calcular_merma_fn"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_admin_onboarding"("p_org_name" "text", "p_full_name" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_org_id uuid;
  v_inv_code text;
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if trim(coalesce(p_org_name, '')) = '' then
    raise exception 'El nombre de la empresa es obligatorio';
  end if;

  if exists (
    select 1
    from public.organizations
    where lower(name) = lower(trim(p_org_name))
  ) then
    raise exception 'Ya existe una empresa con ese nombre';
  end if;

  if exists (
    select 1
    from public.profiles
    where id = v_user_id
      and organization_id is not null
  ) then
    raise exception 'Este usuario ya pertenece a una empresa';
  end if;

  select email into v_email
  from auth.users
  where id = v_user_id;

  v_inv_code := public.generate_invitation_code();

  insert into public.organizations (
    name,
    invitation_code,
    created_by
  )
  values (
    trim(p_org_name),
    v_inv_code,
    v_user_id
  )
  returning id into v_org_id;

  insert into public.profiles (
    id,
    organization_id,
    full_name,
    email,
    is_active,
    is_admin
  )
  values (
    v_user_id,
    v_org_id,
    nullif(trim(coalesce(p_full_name, '')), ''),
    v_email,
    true,
    true
  )
  on conflict (id) do update
  set
    organization_id = excluded.organization_id,
    full_name = excluded.full_name,
    email = excluded.email,
    is_active = true,
    is_admin = true,
    updated_at = now();

  insert into public.user_roles (
    user_id,
    organization_id,
    role,
    assigned_by
  )
  values (
    v_user_id,
    v_org_id,
    'admin_1',
    v_user_id
  )
  on conflict (user_id, organization_id, role) do nothing;

  return jsonb_build_object(
    'organization_id', v_org_id,
    'organization_name', trim(p_org_name),
    'invitation_code', v_inv_code,
    'role', 'admin_1'
  );
end;
$$;


ALTER FUNCTION "public"."complete_admin_onboarding"("p_org_name" "text", "p_full_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_invited_onboarding"("p_invitation_code" "text", "p_full_name" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_inv public.organization_invitations%rowtype;
begin
  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if trim(coalesce(p_invitation_code, '')) = '' then
    raise exception 'El código de invitación es obligatorio';
  end if;

  if exists (
    select 1
    from public.profiles
    where id = v_user_id
      and organization_id is not null
  ) then
    raise exception 'Este usuario ya pertenece a una empresa';
  end if;

  select *
  into v_inv
  from public.organization_invitations
  where invitation_code = upper(trim(p_invitation_code))
    and used = false
    and (expires_at is null or expires_at > now())
  order by created_at desc
  limit 1;

  if v_inv.id is null then
    raise exception 'Código de invitación inválido o vencido';
  end if;

  select email into v_email
  from auth.users
  where id = v_user_id;

  if v_inv.email is not null
     and trim(v_inv.email) <> ''
     and lower(v_inv.email) <> lower(v_email) then
    raise exception 'Este código fue creado para otro correo';
  end if;

  insert into public.profiles (
    id,
    organization_id,
    full_name,
    email,
    is_active,
    is_admin
  )
  values (
    v_user_id,
    v_inv.organization_id,
    nullif(trim(coalesce(p_full_name, '')), ''),
    v_email,
    true,
    v_inv.is_admin
  )
  on conflict (id) do update
  set
    organization_id = excluded.organization_id,
    full_name = excluded.full_name,
    email = excluded.email,
    is_active = true,
    is_admin = excluded.is_admin,
    updated_at = now();

  insert into public.user_roles (
    user_id,
    organization_id,
    role,
    assigned_by
  )
  values (
    v_user_id,
    v_inv.organization_id,
    v_inv.role,
    v_inv.created_by
  )
  on conflict (user_id, organization_id, role) do nothing;

  update public.organization_invitations
  set
    used = true,
    updated_at = now()
  where id = v_inv.id;

  return jsonb_build_object(
    'organization_id', v_inv.organization_id,
    'role', v_inv.role,
    'is_admin', v_inv.is_admin
  );
end;
$$;


ALTER FUNCTION "public"."complete_invited_onboarding"("p_invitation_code" "text", "p_full_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_operator_onboarding"("p_invitation_code" "text", "p_full_name" "text" DEFAULT NULL::"text") RETURNS TABLE("profile_id" "uuid", "organization_id" "uuid", "empleado_id" "uuid", "role" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid;
  v_org public.organizations%rowtype;
  v_existing_profile public.profiles%rowtype;
  v_empleado_id uuid;
  v_full_name text;
  v_codigo_empleado text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'No hay usuario autenticado';
  end if;

  select *
  into v_org
  from public.organizations
  where upper(coalesce(operator_invitation_code, '')) = upper(trim(p_invitation_code))
  limit 1;

  if v_org.id is null then
    raise exception 'El codigo de operario es invalido';
  end if;

  select *
  into v_existing_profile
  from public.profiles
  where id = v_user_id;

  v_full_name := nullif(trim(p_full_name), '');
  v_full_name := coalesce(v_full_name, v_existing_profile.full_name, 'Operario');
  v_codigo_empleado := public.generate_employee_code(v_org.id);

  insert into public.empleados (
    organization_id,
    codigo_empleado,
    nombres,
    apellidos,
    fecha_ingreso,
    puesto,
    departamento,
    tipo_contrato,
    tipo_pago,
    tipo_empleado,
    salario_base_actual,
    bonificacion_incentivo_actual,
    afiliado_igss,
    correo,
    estado_laboral
  )
  values (
    v_org.id,
    v_codigo_empleado,
    v_full_name,
    '',
    current_date,
    'Operario',
    'Operaciones',
    'indefinido',
    'quincenal',
    'operario',
    0,
    250,
    true,
    null,
    'activo'
  )
  returning id into v_empleado_id;

  insert into public.profiles (
    id,
    organization_id,
    role,
    empleado_id,
    full_name
  )
  values (
    v_user_id,
    v_org.id,
    'operario',
    v_empleado_id,
    v_full_name
  )
  on conflict (id) do update
  set organization_id = excluded.organization_id,
      role = 'operario',
      empleado_id = excluded.empleado_id,
      full_name = coalesce(excluded.full_name, public.profiles.full_name);

  update public.employee_biometrics
  set profile_id = v_user_id
  where empleado_id = v_empleado_id
    and biometric_type = 'face'
    and profile_id is distinct from v_user_id;

  return query
  select
    v_user_id,
    v_org.id,
    v_empleado_id,
    'operario'::text;
end;
$$;


ALTER FUNCTION "public"."complete_operator_onboarding"("p_invitation_code" "text", "p_full_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_operator_invitation"("p_empleado_id" "uuid", "p_expires_in_days" integer DEFAULT 14) RETURNS TABLE("invite_code" "text", "expires_at" timestamp with time zone, "empleado_id" "uuid", "organization_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_profile public.profiles%rowtype;
  v_empleado public.empleados%rowtype;
  v_code text;
  v_expires_at timestamptz;
begin
  select *
  into v_profile
  from public.profiles
  where id = auth.uid();

  if v_profile.id is null then
    raise exception 'No se encontró el perfil autenticado';
  end if;

  select *
  into v_empleado
  from public.empleados
  where id = p_empleado_id
    and organization_id = v_profile.organization_id;

  if v_empleado.id is null then
    raise exception 'El empleado no existe o no pertenece a tu organización';
  end if;

  if coalesce(v_empleado.tipo_empleado, '') <> 'operario' then
    raise exception 'Solo puedes generar códigos para empleados tipo operario';
  end if;

  update public.operator_invitations
  set revoked_at = now()
  where empleado_id = p_empleado_id
    and used_at is null
    and revoked_at is null;

  v_code := public.generate_operator_invite_code();
  v_expires_at := case
    when coalesce(p_expires_in_days, 0) <= 0 then null
    else now() + make_interval(days => p_expires_in_days)
  end;

  insert into public.operator_invitations (
    organization_id,
    empleado_id,
    invite_code,
    expires_at,
    created_by
  )
  values (
    v_profile.organization_id,
    p_empleado_id,
    v_code,
    v_expires_at,
    v_profile.id
  );

  return query
  select v_code, v_expires_at, p_empleado_id, v_profile.organization_id;
end;
$$;


ALTER FUNCTION "public"."create_operator_invitation"("p_empleado_id" "uuid", "p_expires_in_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."employee_has_active_biometric"("p_empleado_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select exists (
    select 1
    from public.employee_biometrics eb
    join public.profiles p
      on p.id = auth.uid()
     and p.organization_id = eb.organization_id
    where eb.empleado_id = p_empleado_id
      and eb.biometric_type = 'face'
      and eb.enrollment_status = 'active'
  );
$$;


ALTER FUNCTION "public"."employee_has_active_biometric"("p_empleado_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_employee_code"("p_organization_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_next integer;
  v_code text;
begin
  select coalesce(
    max(
      case
        when regexp_replace(coalesce(codigo_empleado, ''), '\D', '', 'g') <> ''
          then regexp_replace(codigo_empleado, '\D', '', 'g')::integer
        else null
      end
    ),
    0
  ) + 1
  into v_next
  from public.empleados
  where organization_id = p_organization_id;

  loop
    v_code := 'EMP-' || lpad(v_next::text, 3, '0');
    exit when not exists (
      select 1
      from public.empleados e
      where e.organization_id = p_organization_id
        and e.codigo_empleado = v_code
    );

    v_next := v_next + 1;
  end loop;

  return v_code;
end;
$$;


ALTER FUNCTION "public"."generate_employee_code"("p_organization_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_finished_goods_lot"("p_presentation_code" "text", "p_packing_date" "date") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return upper(trim(p_presentation_code))
    || '-'
    || lpad(extract(doy from p_packing_date)::text, 3, '0')
    || '-'
    || to_char(p_packing_date, 'YY');
end;
$$;


ALTER FUNCTION "public"."generate_finished_goods_lot"("p_presentation_code" "text", "p_packing_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_invitation_code"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_code text;
begin
  loop
    v_code := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
    exit when not exists (
      select 1
      from public.organizations
      where invitation_code = v_code
    );
  end loop;

  return v_code;
end;
$$;


ALTER FUNCTION "public"."generate_invitation_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_material_reception_lot"("p_organization_id" "uuid", "p_material_id" "uuid", "p_received_date" "date") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_code text;
  v_day_of_year text;
  v_week text;
  v_year text;
  v_base text;
  v_count integer;
  v_lot text;
begin
  select code
  into v_code
  from public.materials
  where id = p_material_id;

  if v_code is null then
    raise exception 'No se encontró el código de la materia prima';
  end if;

  v_day_of_year := lpad(extract(doy from p_received_date)::text, 3, '0');
  v_week := lpad(extract(week from p_received_date)::text, 2, '0');
  v_year := to_char(p_received_date, 'YY');

  v_base := upper(trim(v_code)) || '-' || v_day_of_year || '-' || v_week || '-' || v_year;

  select count(*) + 1
  into v_count
  from public.material_receptions mr
  where mr.organization_id = p_organization_id
    and mr.material_id = p_material_id
    and mr.received_date = p_received_date;

  v_lot := v_base || '-' || lpad(v_count::text, 2, '0');

  return v_lot;
end;
$$;


ALTER FUNCTION "public"."generate_material_reception_lot"("p_organization_id" "uuid", "p_material_id" "uuid", "p_received_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_operator_invite_code"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_code text;
begin
  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (
      select 1
      from public.operator_invitations oi
      where upper(oi.invite_code) = v_code
    );
  end loop;

  return v_code;
end;
$$;


ALTER FUNCTION "public"."generate_operator_invite_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_organization_operator_code"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_code text;
begin
  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (
      select 1
      from public.organizations o
      where upper(coalesce(o.operator_invitation_code, '')) = v_code
    );
  end loop;

  return v_code;
end;
$$;


ALTER FUNCTION "public"."generate_organization_operator_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_product_base_code"("p_organization_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count integer;
begin
  select count(*) + 1
  into v_count
  from public.product_bases
  where organization_id = p_organization_id;

  return 'PRD-' || lpad(v_count::text, 4, '0');
end;
$$;


ALTER FUNCTION "public"."generate_product_base_code"("p_organization_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_product_presentation_code"("p_organization_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count integer;
begin
  select count(*) + 1
  into v_count
  from public.product_presentations
  where organization_id = p_organization_id;

  return 'PRE-' || lpad(v_count::text, 4, '0');
end;
$$;


ALTER FUNCTION "public"."generate_product_presentation_code"("p_organization_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_purchase_order_number"("p_organization_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count integer;
  v_year text;
  v_number text;
begin
  v_year := to_char(current_date, 'YY');

  select count(*) + 1
  into v_count
  from public.purchase_orders
  where organization_id = p_organization_id
    and extract(year from created_at) = extract(year from current_date);

  v_number := 'OC-' || v_year || '-' || lpad(v_count::text, 4, '0');

  return v_number;
end;
$$;


ALTER FUNCTION "public"."generate_purchase_order_number"("p_organization_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_quote_number"("p_organization_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_year  text := to_char(now(), 'YYYY');
  v_count bigint;
BEGIN
  SELECT count(*) + 1 INTO v_count
  FROM quotes
  WHERE organization_id = p_organization_id
    AND to_char(created_at, 'YYYY') = v_year;
  RETURN 'COT-' || v_year || '-' || lpad(v_count::text, 4, '0');
END;
$$;


ALTER FUNCTION "public"."generate_quote_number"("p_organization_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_sku_code"("p_organization_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count integer;
begin
  select count(*) + 1
  into v_count
  from public.skus
  where organization_id = p_organization_id;

  return 'SKU-' || lpad(v_count::text, 4, '0');
end;
$$;


ALTER FUNCTION "public"."generate_sku_code"("p_organization_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_profile_org"() RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_org_id uuid;
begin
  select organization_id
  into v_org_id
  from public.profiles
  where id = auth.uid()
  limit 1;

  return v_org_id;
end;
$$;


ALTER FUNCTION "public"."get_my_profile_org"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (new.id, new.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin_user"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_is_admin boolean;
begin
  select coalesce(is_admin, false)
  into v_is_admin
  from public.profiles
  where id = auth.uid()
  limit 1;

  return coalesce(v_is_admin, false);
end;
$$;


ALTER FUNCTION "public"."is_admin_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."release_material_reception"("p_reception_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_reception public.material_receptions%rowtype;
  v_material public.materials%rowtype;
begin
  select *
  into v_reception
  from public.material_receptions
  where id = p_reception_id;

  if v_reception.id is null then
    raise exception 'No se encontró la recepción';
  end if;

  if v_reception.organization_id <> public.get_my_profile_org() then
    raise exception 'No tienes acceso a esta recepción';
  end if;

  if v_reception.status = 'rechazado' then
    raise exception 'No se puede liberar un lote rechazado';
  end if;

  if v_reception.status = 'liberado' then
    raise exception 'Este lote ya fue liberado';
  end if;

  if coalesce(v_reception.quantity_accepted, 0) <= 0 then
    raise exception 'No se puede liberar un lote sin cantidad aceptada';
  end if;

  select *
  into v_material
  from public.materials
  where id = v_reception.material_id;

  if v_material.id is null then
    raise exception 'No se encontró la materia prima asociada';
  end if;

  update public.material_receptions
  set status = 'liberado',
      updated_at = now()
  where id = p_reception_id;

  if v_material.category = 'material_empaque' then
    insert into public.packaging_inventory_lots (
      organization_id,
      reception_id,
      supplier_id,
      material_id,
      internal_lot,
      supplier_lot,
      received_date,
      available_quantity,
      original_quantity,
      unit,
      unit_cost,
      total_cost,
      location,
      minimum_stock,
      alert_active,
      status,
      created_by
    )
    values (
      v_reception.organization_id,
      v_reception.id,
      v_reception.supplier_id,
      v_reception.material_id,
      v_reception.internal_lot,
      v_reception.supplier_lot,
      v_reception.received_date,
      v_reception.quantity_accepted,
      v_reception.quantity_accepted,
      v_reception.unit,
      v_reception.unit_cost,
      coalesce(v_reception.unit_cost, 0) * coalesce(v_reception.quantity_accepted, 0),
      null,
      coalesce(v_material.minimum_stock, 0),
      false,
      'disponible',
      auth.uid()
    )
    on conflict (reception_id) do nothing;

    update public.packaging_inventory_lots
    set alert_active = available_quantity <= minimum_stock
    where reception_id = v_reception.id;

  else
    insert into public.material_inventory_lots (
      organization_id,
      reception_id,
      supplier_id,
      material_id,
      internal_lot,
      supplier_lot,
      received_date,
      available_quantity,
      original_quantity,
      unit,
      unit_cost,
      total_cost,
      location,
      status,
      created_by
    )
    values (
      v_reception.organization_id,
      v_reception.id,
      v_reception.supplier_id,
      v_reception.material_id,
      v_reception.internal_lot,
      v_reception.supplier_lot,
      v_reception.received_date,
      v_reception.quantity_accepted,
      v_reception.quantity_accepted,
      v_reception.unit,
      v_reception.unit_cost,
      coalesce(v_reception.unit_cost, 0) * coalesce(v_reception.quantity_accepted, 0),
      null,
      'disponible',
      auth.uid()
    )
    on conflict (reception_id) do nothing;
  end if;

  return jsonb_build_object(
    'success', true,
    'reception_id', v_reception.id,
    'internal_lot', v_reception.internal_lot,
    'inventory_type',
    case
      when v_material.category = 'material_empaque' then 'packaging_inventory'
      else 'material_inventory'
    end
  );
end;
$$;


ALTER FUNCTION "public"."release_material_reception"("p_reception_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_employee_biometrics_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_employee_biometrics_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_operator_invitation_codes_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_operator_invitation_codes_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_orders_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


ALTER FUNCTION "public"."update_orders_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."accounting_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "account_type" "text" NOT NULL,
    "normal_balance" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "accounting_accounts_account_type_check" CHECK (("account_type" = ANY (ARRAY['activo'::"text", 'pasivo'::"text", 'patrimonio'::"text", 'ingreso'::"text", 'egreso'::"text", 'costo'::"text"]))),
    CONSTRAINT "accounting_accounts_normal_balance_check" CHECK (("normal_balance" = ANY (ARRAY['debito'::"text", 'credito'::"text"])))
);


ALTER TABLE "public"."accounting_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."anticipos_empleado" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "empleado_id" "uuid" NOT NULL,
    "fecha" "date" NOT NULL,
    "monto" numeric(12,2) NOT NULL,
    "periodo_id" "uuid",
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "observaciones" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "anticipos_empleado_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'aplicado'::"text", 'liquidado'::"text"])))
);


ALTER TABLE "public"."anticipos_empleado" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid",
    "actor_user_id" "uuid",
    "table_name" "text" NOT NULL,
    "record_id" "text" NOT NULL,
    "action" "text" NOT NULL,
    "old_data" "jsonb",
    "new_data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cierres_detalle_sku" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cierre_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "tipo_periodo" "text" NOT NULL,
    "product_presentation_id" "uuid",
    "sku_code" "text",
    "sku_nombre" "text",
    "produccion_unidades" numeric DEFAULT 0,
    "produccion_libras" numeric DEFAULT 0,
    "ventas_unidades" numeric DEFAULT 0,
    "ventas_monto" numeric DEFAULT 0,
    "costo_total" numeric DEFAULT 0,
    "costo_unitario" numeric DEFAULT 0,
    "margen" numeric DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."cierres_detalle_sku" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cierres_eventos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cierre_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "tipo_periodo" "text" NOT NULL,
    "tipo_evento" "text" NOT NULL,
    "descripcion" "text" NOT NULL,
    "severidad" "text" NOT NULL,
    "referencia_tipo" "text",
    "referencia_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "cierres_eventos_severidad_check" CHECK (("severidad" = ANY (ARRAY['info'::"text", 'warning'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."cierres_eventos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cierres_operativos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "tipo_periodo" "text" NOT NULL,
    "fecha_inicio" "date" NOT NULL,
    "fecha_fin" "date" NOT NULL,
    "fecha_referencia" "date" NOT NULL,
    "estado" "text" DEFAULT 'borrador'::"text" NOT NULL,
    "libras_producidas" numeric DEFAULT 0,
    "unidades_producidas" numeric DEFAULT 0,
    "total_runs" integer DEFAULT 0,
    "merma_libras" numeric DEFAULT 0,
    "merma_porcentaje" numeric DEFAULT 0,
    "total_pedidos" integer DEFAULT 0,
    "pedidos_despachados" integer DEFAULT 0,
    "pedidos_pendientes" integer DEFAULT 0,
    "ventas_total" numeric DEFAULT 0,
    "costo_mp" numeric DEFAULT 0,
    "costo_empaque_mat" numeric DEFAULT 0,
    "costo_laboral" numeric DEFAULT 0,
    "costo_gastos" numeric DEFAULT 0,
    "costo_total" numeric DEFAULT 0,
    "costo_por_libra" numeric,
    "utilidad_bruta" numeric DEFAULT 0,
    "margen_bruto" numeric DEFAULT 0,
    "inspecciones_total" integer DEFAULT 0,
    "inspecciones_rechazadas" integer DEFAULT 0,
    "inspecciones_retenidas" integer DEFAULT 0,
    "tasa_rechazo" numeric DEFAULT 0,
    "reclamos_total" integer DEFAULT 0,
    "lotes_bloqueados" integer DEFAULT 0,
    "resumen_por_sku" "jsonb" DEFAULT '[]'::"jsonb",
    "resumen_alertas" "jsonb" DEFAULT '[]'::"jsonb",
    "observaciones" "text",
    "responsable_cierre_id" "uuid",
    "fecha_cierre" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "cierres_operativos_estado_check" CHECK (("estado" = ANY (ARRAY['borrador'::"text", 'calculado'::"text", 'revisado'::"text", 'cerrado'::"text"]))),
    CONSTRAINT "cierres_operativos_tipo_periodo_check" CHECK (("tipo_periodo" = ANY (ARRAY['diario'::"text", 'semanal'::"text", 'mensual'::"text"])))
);


ALTER TABLE "public"."cierres_operativos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_addresses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "address_label" "text",
    "address_line" "text" NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_addresses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_agreed_prices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "product_presentation_id" "uuid" NOT NULL,
    "agreed_price" numeric(14,4) NOT NULL,
    "valid_from" "date" DEFAULT CURRENT_DATE NOT NULL,
    "valid_until" "date",
    "origin_quote_id" "uuid",
    "is_active" boolean DEFAULT true NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_agreed_prices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "commercial_name" "text" NOT NULL,
    "legal_name" "text",
    "nit" "text",
    "main_address" "text",
    "credit_days" integer DEFAULT 0 NOT NULL,
    "main_contact" "text",
    "phone" "text",
    "email" "text",
    "channel" "text",
    "delivery_conditions" "text",
    "status" "public"."record_status" DEFAULT 'activo'::"public"."record_status" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "salesperson_id" "uuid",
    "es_exportacion" boolean DEFAULT false NOT NULL,
    "pais" "text",
    "moneda_default" "text" DEFAULT 'GTQ'::"text" NOT NULL,
    "facturar_por_sombrilla" boolean DEFAULT false NOT NULL,
    CONSTRAINT "clients_credit_days_check" CHECK (("credit_days" >= 0))
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conceptos_nomina" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "codigo" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "tipo" "text" NOT NULL,
    "naturaleza" "text" NOT NULL,
    "afecta_neto" boolean DEFAULT true NOT NULL,
    "afecta_costo_empresa" boolean DEFAULT false NOT NULL,
    "afecta_base_igss" boolean DEFAULT false NOT NULL,
    "orden_visual" integer DEFAULT 0 NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "conceptos_nomina_naturaleza_check" CHECK (("naturaleza" = ANY (ARRAY['fijo'::"text", 'variable'::"text", 'calculado'::"text", 'manual'::"text"]))),
    CONSTRAINT "conceptos_nomina_tipo_check" CHECK (("tipo" = ANY (ARRAY['ingreso'::"text", 'descuento'::"text", 'aporte_patronal'::"text", 'provision'::"text", 'pago'::"text", 'ajuste'::"text"])))
);


ALTER TABLE "public"."conceptos_nomina" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."configuracion_jornada" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "nombre" "text" DEFAULT 'Jornada Estándar'::"text" NOT NULL,
    "lunes_viernes_horas" numeric(4,2) DEFAULT 9 NOT NULL,
    "sabado_horas" numeric(4,2) DEFAULT 4 NOT NULL,
    "domingo_laboral" boolean DEFAULT false NOT NULL,
    "domingo_horas" numeric(4,2) DEFAULT 0 NOT NULL,
    "hora_inicio_lv" time without time zone DEFAULT '08:00:00'::time without time zone NOT NULL,
    "hora_fin_lv" time without time zone DEFAULT '17:00:00'::time without time zone NOT NULL,
    "hora_inicio_sab" time without time zone DEFAULT '08:00:00'::time without time zone NOT NULL,
    "hora_fin_sab" time without time zone DEFAULT '12:00:00'::time without time zone NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."configuracion_jornada" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."configuracion_muestreo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "probabilidad_base" numeric(5,3) DEFAULT 0.400 NOT NULL,
    "peso_reclamos" numeric(5,3) DEFAULT 0.100 NOT NULL,
    "peso_no_conformidades" numeric(5,3) DEFAULT 0.050 NOT NULL,
    "ajuste_rechazo" numeric(5,3) DEFAULT 0.300 NOT NULL,
    "ajuste_observacion" numeric(5,3) DEFAULT 0.150 NOT NULL,
    "ajuste_limpio" numeric(5,3) DEFAULT 0.100 NOT NULL,
    "probabilidad_maxima" numeric(5,3) DEFAULT 0.900 NOT NULL,
    "probabilidad_minima" numeric(5,3) DEFAULT 0.100 NOT NULL,
    "ventana_resultados" integer DEFAULT 15 NOT NULL,
    "ventana_reclamos" integer DEFAULT 30 NOT NULL,
    "tamano_muestra_base" integer DEFAULT 5 NOT NULL,
    "umbral_vigilancia" numeric(5,3) DEFAULT 0.700 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."configuracion_muestreo" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cost_centers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "parent_id" "uuid"
);


ALTER TABLE "public"."cost_centers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_prices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "sku_id" "uuid" NOT NULL,
    "price" numeric(14,4) NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."customer_prices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."defectos_inspeccion" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "inspeccion_id" "uuid" NOT NULL,
    "tipo_defecto" "text" NOT NULL,
    "cantidad" integer DEFAULT 1 NOT NULL,
    "nivel" "text" DEFAULT 'menor'::"text",
    "descripcion" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "defectos_inspeccion_nivel_check" CHECK (("nivel" = ANY (ARRAY['menor'::"text", 'mayor'::"text", 'critico'::"text"])))
);


ALTER TABLE "public"."defectos_inspeccion" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."empleado_salario_historial" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "empleado_id" "uuid" NOT NULL,
    "fecha_inicio" "date" NOT NULL,
    "fecha_fin" "date",
    "salario_base" numeric(12,2) NOT NULL,
    "bonificacion_incentivo" numeric(12,2) DEFAULT 250 NOT NULL,
    "afiliado_igss" boolean DEFAULT true NOT NULL,
    "tipo_pago" "text" DEFAULT 'mensual'::"text" NOT NULL,
    "observaciones" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."empleado_salario_historial" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."empleados" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "codigo_empleado" "text" NOT NULL,
    "nombres" "text" NOT NULL,
    "apellidos" "text" NOT NULL,
    "nombre_completo" "text" GENERATED ALWAYS AS ((("nombres" || ' '::"text") || "apellidos")) STORED,
    "dpi" "text",
    "nit" "text",
    "igss_numero" "text",
    "fecha_nacimiento" "date",
    "fecha_ingreso" "date" NOT NULL,
    "fecha_baja" "date",
    "estado_laboral" "text" DEFAULT 'activo'::"text" NOT NULL,
    "puesto" "text",
    "departamento" "text",
    "centro_costo_id" "uuid",
    "tipo_contrato" "text" DEFAULT 'indefinido'::"text",
    "tipo_pago" "text" DEFAULT 'mensual'::"text" NOT NULL,
    "salario_base_actual" numeric(12,2) DEFAULT 0 NOT NULL,
    "bonificacion_incentivo_actual" numeric(12,2) DEFAULT 250 NOT NULL,
    "afiliado_igss" boolean DEFAULT true NOT NULL,
    "banco" "text",
    "tipo_cuenta_bancaria" "text",
    "cuenta_bancaria" "text",
    "correo" "text",
    "telefono" "text",
    "direccion" "text",
    "contacto_emergencia" "text",
    "observaciones" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tipo_empleado" "text" DEFAULT 'administrativo'::"text" NOT NULL,
    "sede_id" "uuid",
    CONSTRAINT "empleados_estado_laboral_check" CHECK (("estado_laboral" = ANY (ARRAY['activo'::"text", 'suspendido'::"text", 'baja'::"text"]))),
    CONSTRAINT "empleados_tipo_contrato_check" CHECK (("tipo_contrato" = ANY (ARRAY['indefinido'::"text", 'temporal'::"text", 'prueba'::"text", 'honorarios'::"text"]))),
    CONSTRAINT "empleados_tipo_cuenta_bancaria_check" CHECK ((("tipo_cuenta_bancaria" = ANY (ARRAY['monetaria'::"text", 'ahorro'::"text", 'planilla'::"text"])) OR ("tipo_cuenta_bancaria" IS NULL))),
    CONSTRAINT "empleados_tipo_empleado_check" CHECK (("tipo_empleado" = ANY (ARRAY['operario'::"text", 'administrativo'::"text", 'supervisor'::"text"]))),
    CONSTRAINT "empleados_tipo_pago_check" CHECK (("tipo_pago" = ANY (ARRAY['mensual'::"text", 'quincenal'::"text", 'semanal'::"text"])))
);


ALTER TABLE "public"."empleados" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employee_biometrics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "empleado_id" "uuid" NOT NULL,
    "profile_id" "uuid",
    "biometric_type" "text" DEFAULT 'face'::"text" NOT NULL,
    "enrollment_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "face_embedding" "jsonb",
    "embedding_version" "text",
    "enrollment_photo_url" "text",
    "last_verified_at" timestamp with time zone,
    "verification_score" numeric(8,5),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "employee_biometrics_status_check" CHECK (("enrollment_status" = ANY (ARRAY['active'::"text", 'inactive'::"text", 'revoked'::"text", 'pending'::"text"]))),
    CONSTRAINT "employee_biometrics_type_check" CHECK (("biometric_type" = 'face'::"text"))
);


ALTER TABLE "public"."employee_biometrics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expenses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "expense_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "description" "text" NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "cost_center_id" "uuid" NOT NULL,
    "expense_type" "text" DEFAULT 'administrativo'::"text" NOT NULL,
    "journal_entry_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source_order_id" "uuid",
    CONSTRAINT "expenses_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "expenses_expense_type_check" CHECK (("expense_type" = ANY (ARRAY['administrativo'::"text", 'produccion'::"text", 'logistica'::"text", 'comercial'::"text"])))
);


ALTER TABLE "public"."expenses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."facturas_exportacion" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "numero" "text",
    "fecha" "date" DEFAULT CURRENT_DATE NOT NULL,
    "client_id" "uuid",
    "moneda" "text" DEFAULT 'USD'::"text" NOT NULL,
    "tipo_cambio" numeric(10,4),
    "total_usd" numeric(14,4) DEFAULT 0 NOT NULL,
    "total_kg" numeric(14,4) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'borrador'::"text" NOT NULL,
    "observaciones" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "facturas_exportacion_status_check" CHECK (("status" = ANY (ARRAY['borrador'::"text", 'emitida'::"text", 'anulada'::"text"])))
);


ALTER TABLE "public"."facturas_exportacion" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."facturas_exportacion_desglose" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "factura_id" "uuid" NOT NULL,
    "linea_id" "uuid" NOT NULL,
    "order_item_id" "uuid",
    "product_presentation_id" "uuid",
    "cantidad" numeric(14,4),
    "unidad" "text",
    "peso_kg" numeric(14,4) DEFAULT 0 NOT NULL,
    "valor_usd" numeric(14,4) DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."facturas_exportacion_desglose" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."facturas_exportacion_lineas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "factura_id" "uuid" NOT NULL,
    "producto_sombrilla_id" "uuid",
    "descripcion_factura" "text",
    "total_kg" numeric(14,4) DEFAULT 0 NOT NULL,
    "precio_usd_kg" numeric(14,6) DEFAULT 0 NOT NULL,
    "total_usd" numeric(14,4) DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."facturas_exportacion_lineas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."finished_goods_inventory_lots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "packing_run_id" "uuid" NOT NULL,
    "product_presentation_id" "uuid" NOT NULL,
    "product_base_id" "uuid" NOT NULL,
    "internal_lot" "text" NOT NULL,
    "units_available" numeric(14,4) DEFAULT 0 NOT NULL,
    "units_original" numeric(14,4) DEFAULT 0 NOT NULL,
    "net_weight_per_unit" numeric(14,4) DEFAULT 0 NOT NULL,
    "weight_unit" "text" DEFAULT 'oz'::"text" NOT NULL,
    "accumulated_cost" numeric(14,4) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'disponible'::"text" NOT NULL,
    "location" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."finished_goods_inventory_lots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."finished_inventory_lots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "packaging_run_id" "uuid" NOT NULL,
    "product_presentation_id" "uuid" NOT NULL,
    "finished_lot_code" "text" NOT NULL,
    "available_quantity" numeric DEFAULT 0 NOT NULL,
    "original_quantity" numeric DEFAULT 0 NOT NULL,
    "unit" "text" DEFAULT 'unidad'::"text" NOT NULL,
    "total_cost" numeric DEFAULT 0 NOT NULL,
    "unit_cost" numeric DEFAULT 0 NOT NULL,
    "location" "text",
    "status" "text" DEFAULT 'disponible'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "production_date" "date",
    "expiration_date" "date",
    "storage_location" "text",
    "source_packaging_run_id" "uuid",
    "bloqueado_calidad" boolean DEFAULT false,
    "motivo_bloqueo_calidad" "text",
    "en_recall" boolean DEFAULT false NOT NULL,
    "recall_id" "uuid"
);


ALTER TABLE "public"."finished_inventory_lots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."incapacidades_empleado" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "empleado_id" "uuid" NOT NULL,
    "fecha_inicio" "date" NOT NULL,
    "fecha_fin" "date" NOT NULL,
    "dias" integer DEFAULT 1 NOT NULL,
    "tipo_incapacidad" "text" DEFAULT 'enfermedad_comun'::"text" NOT NULL,
    "entidad_respaldo" "text",
    "numero_documento" "text",
    "cubierto_por" "text" DEFAULT 'empresa'::"text" NOT NULL,
    "porcentaje_pagado_empresa" numeric(5,2) DEFAULT 100,
    "observaciones" "text",
    "estado" "text" DEFAULT 'activa'::"text" NOT NULL,
    "periodo_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "incapacidades_empleado_cubierto_por_check" CHECK (("cubierto_por" = ANY (ARRAY['empresa'::"text", 'igss'::"text", 'mixto'::"text"]))),
    CONSTRAINT "incapacidades_empleado_estado_check" CHECK (("estado" = ANY (ARRAY['activa'::"text", 'cerrada'::"text", 'aplicada'::"text"]))),
    CONSTRAINT "incapacidades_empleado_tipo_incapacidad_check" CHECK (("tipo_incapacidad" = ANY (ARRAY['enfermedad_comun'::"text", 'accidente_trabajo'::"text", 'maternidad'::"text", 'otro'::"text"])))
);


ALTER TABLE "public"."incapacidades_empleado" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inspecciones_calidad" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "fecha" "date" DEFAULT CURRENT_DATE NOT NULL,
    "product_presentation_id" "uuid" NOT NULL,
    "finished_lot_id" "uuid",
    "origen" "text" DEFAULT 'muestreo'::"text" NOT NULL,
    "tamano_muestra" integer DEFAULT 5 NOT NULL,
    "status" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "resultado" "text",
    "unidades_inspeccionadas" integer,
    "unidades_defectuosas" integer DEFAULT 0,
    "tasa_defectos" numeric(6,2),
    "observaciones" "text",
    "probabilidad_usada" numeric(5,3),
    "score_riesgo_usado" numeric(8,4),
    "lote_bloqueado" boolean DEFAULT false,
    "inspeccionado_por" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "inspecciones_calidad_origen_check" CHECK (("origen" = ANY (ARRAY['muestreo'::"text", 'manual'::"text", 'reclamo'::"text"]))),
    CONSTRAINT "inspecciones_calidad_resultado_check" CHECK (("resultado" = ANY (ARRAY['liberado'::"text", 'liberado_con_observacion'::"text", 'retenido'::"text", 'rechazado'::"text"]))),
    CONSTRAINT "inspecciones_calidad_status_check" CHECK (("status" = ANY (ARRAY['pendiente'::"text", 'en_proceso'::"text", 'completada'::"text", 'cancelada'::"text"])))
);


ALTER TABLE "public"."inspecciones_calidad" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."journal_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "entry_number" bigint NOT NULL,
    "entry_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "description" "text",
    "reference_type" "text",
    "reference_id" "uuid",
    "status" "text" DEFAULT 'confirmado'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "journal_entries_reference_type_check" CHECK (("reference_type" = ANY (ARRAY['venta'::"text", 'compra'::"text", 'ajuste'::"text", 'gasto'::"text", 'otro'::"text"]))),
    CONSTRAINT "journal_entries_status_check" CHECK (("status" = ANY (ARRAY['borrador'::"text", 'confirmado'::"text", 'anulado'::"text"])))
);


ALTER TABLE "public"."journal_entries" OWNER TO "postgres";


ALTER TABLE "public"."journal_entries" ALTER COLUMN "entry_number" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."journal_entries_entry_number_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."journal_entry_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "entry_id" "uuid" NOT NULL,
    "account_id" "uuid" NOT NULL,
    "cost_center_id" "uuid",
    "description" "text",
    "debit" numeric DEFAULT 0 NOT NULL,
    "credit" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."journal_entry_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kpi_costo_laboral_diario" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "fecha" "date" NOT NULL,
    "costo_laboral_total_dia" numeric(14,2) DEFAULT 0 NOT NULL,
    "libras_producidas_dia" numeric(12,4) DEFAULT 0 NOT NULL,
    "costo_mano_obra_por_libra" numeric(14,6),
    "total_colaboradores_marcados" integer DEFAULT 0 NOT NULL,
    "total_horas_trabajadas" numeric(8,2) DEFAULT 0 NOT NULL,
    "total_horas_extra_preliminares" numeric(8,2) DEFAULT 0 NOT NULL,
    "observacion_inconsistencia" "text",
    "ajuste_quincenal_aplicado" boolean DEFAULT false NOT NULL,
    "costo_final_recalculado" numeric(14,2),
    "runs_produccion" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."kpi_costo_laboral_diario" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."liquidaciones_empleado" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "empleado_id" "uuid" NOT NULL,
    "fecha_salida" "date" NOT NULL,
    "motivo_salida" "text" NOT NULL,
    "salario_base_referencia" numeric(12,2) NOT NULL,
    "bonificacion_incentivo_referencia" numeric(12,2) DEFAULT 0 NOT NULL,
    "dias_pendientes_mes" numeric(5,2) DEFAULT 0,
    "salario_dias_pendientes" numeric(12,2) DEFAULT 0,
    "aguinaldo_proporcional" numeric(12,2) DEFAULT 0,
    "bono14_proporcional" numeric(12,2) DEFAULT 0,
    "vacaciones_pendientes_dias" numeric(5,2) DEFAULT 0,
    "vacaciones_pendientes_monto" numeric(12,2) DEFAULT 0,
    "indemnizacion" numeric(12,2) DEFAULT 0,
    "otros_ingresos" numeric(12,2) DEFAULT 0,
    "otros_descuentos" numeric(12,2) DEFAULT 0,
    "prestamos_pendientes" numeric(12,2) DEFAULT 0,
    "total_liquidacion" numeric(12,2) DEFAULT 0,
    "observaciones" "text",
    "estado" "text" DEFAULT 'borrador'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "liquidaciones_empleado_estado_check" CHECK (("estado" = ANY (ARRAY['borrador'::"text", 'calculada'::"text", 'aprobada'::"text", 'pagada'::"text"]))),
    CONSTRAINT "liquidaciones_empleado_motivo_salida_check" CHECK (("motivo_salida" = ANY (ARRAY['renuncia'::"text", 'despido_justificado'::"text", 'despido_injustificado'::"text", 'mutuo_acuerdo'::"text", 'otro'::"text"])))
);


ALTER TABLE "public"."liquidaciones_empleado" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."marcaciones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "empleado_id" "uuid" NOT NULL,
    "fecha" "date" NOT NULL,
    "hora_entrada" time without time zone,
    "hora_salida" time without time zone,
    "horas_trabajadas" numeric(6,2),
    "horas_normales_teoricas_dia" numeric(4,2) DEFAULT 0 NOT NULL,
    "exceso_dia" numeric(6,2) DEFAULT 0 NOT NULL,
    "costo_dia_preliminar" numeric(12,2),
    "costo_extra_preliminar" numeric(12,2),
    "estado" "text" DEFAULT 'pendiente_revision'::"text" NOT NULL,
    "observaciones" "text",
    "registrado_por" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "sede_id" "uuid",
    "foto_entrada_url" "text",
    "foto_salida_url" "text",
    "latitud_entrada" numeric(10,7),
    "longitud_entrada" numeric(10,7),
    "latitud_salida" numeric(10,7),
    "longitud_salida" numeric(10,7),
    "distancia_entrada" integer,
    "validacion_geo_entrada" boolean DEFAULT false,
    "distancia_salida" integer,
    "validacion_geo_salida" boolean DEFAULT false,
    "costo_hora_base" numeric(12,4),
    "costo_total_preliminar_dia" numeric(12,2),
    CONSTRAINT "marcaciones_estado_check" CHECK (("estado" = ANY (ARRAY['completa'::"text", 'incompleta'::"text", 'pendiente_revision'::"text", 'aprobada'::"text"])))
);


ALTER TABLE "public"."marcaciones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."material_inventory_lots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "reception_id" "uuid" NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "material_id" "uuid" NOT NULL,
    "internal_lot" "text" NOT NULL,
    "supplier_lot" "text",
    "received_date" "date" NOT NULL,
    "available_quantity" numeric(14,4) NOT NULL,
    "original_quantity" numeric(14,4) NOT NULL,
    "unit" "text" NOT NULL,
    "unit_cost" numeric(14,4) DEFAULT 0 NOT NULL,
    "total_cost" numeric(14,4) DEFAULT 0 NOT NULL,
    "location" "text",
    "status" "text" DEFAULT 'disponible'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "en_recall" boolean DEFAULT false NOT NULL,
    "recall_id" "uuid",
    CONSTRAINT "material_inventory_lots_available_quantity_check" CHECK (("available_quantity" >= (0)::numeric)),
    CONSTRAINT "material_inventory_lots_original_quantity_check" CHECK (("original_quantity" >= (0)::numeric))
);


ALTER TABLE "public"."material_inventory_lots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."material_price_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "material_id" "uuid" NOT NULL,
    "price" numeric(14,4) NOT NULL,
    "valid_from" "date" DEFAULT CURRENT_DATE NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."material_price_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."material_process_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "source_inventory_lot_id" "uuid",
    "source_material_id" "uuid" NOT NULL,
    "start_stage" "public"."process_stage_type" NOT NULL,
    "current_stage" "public"."process_stage_type" NOT NULL,
    "source_internal_lot" "text" NOT NULL,
    "process_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "input_quantity" numeric(14,4) DEFAULT 0 NOT NULL,
    "input_unit" "text" NOT NULL,
    "status" "text" DEFAULT 'en_proceso'::"text" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source_output_id" "uuid",
    CONSTRAINT "material_process_runs_status_check" CHECK (("status" = ANY (ARRAY['en_proceso'::"text", 'completado'::"text", 'cancelado'::"text"])))
);


ALTER TABLE "public"."material_process_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."material_process_stage_outputs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "process_run_id" "uuid" NOT NULL,
    "stage" "public"."process_stage_type" NOT NULL,
    "output_type" "text" DEFAULT 'unico'::"text" NOT NULL,
    "output_lot_code" "text" NOT NULL,
    "material_id" "uuid" NOT NULL,
    "input_quantity" numeric(14,4) DEFAULT 0 NOT NULL,
    "output_quantity" numeric(14,4) DEFAULT 0 NOT NULL,
    "waste_quantity" numeric(14,4) DEFAULT 0 NOT NULL,
    "waste_percentage" numeric(10,4) DEFAULT 0 NOT NULL,
    "unit" "text" NOT NULL,
    "cost_addition" numeric(14,4) DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source_output_id" "uuid",
    "was_used" boolean DEFAULT false NOT NULL,
    "used_at" timestamp with time zone,
    "used_by_run_id" "uuid",
    "sent_to_processed_inventory" boolean DEFAULT false NOT NULL,
    "sent_to_processed_inventory_at" timestamp with time zone
);


ALTER TABLE "public"."material_process_stage_outputs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."material_receptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "purchase_order_id" "uuid",
    "purchase_order_item_id" "uuid",
    "supplier_id" "uuid" NOT NULL,
    "material_id" "uuid" NOT NULL,
    "internal_lot" "text" NOT NULL,
    "supplier_lot" "text",
    "received_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "quantity_received" numeric(14,4) NOT NULL,
    "quantity_accepted" numeric(14,4) DEFAULT 0 NOT NULL,
    "quantity_rejected" numeric(14,4) DEFAULT 0 NOT NULL,
    "unit" "text" NOT NULL,
    "quality_notes" "text",
    "status" "public"."reception_status" DEFAULT 'recibido'::"public"."reception_status" NOT NULL,
    "unit_cost" numeric(14,4) DEFAULT 0 NOT NULL,
    "real_cost" numeric(14,4) DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "material_receptions_quantity_accepted_check" CHECK (("quantity_accepted" >= (0)::numeric)),
    CONSTRAINT "material_receptions_quantity_received_check" CHECK (("quantity_received" >= (0)::numeric)),
    CONSTRAINT "material_receptions_quantity_rejected_check" CHECK (("quantity_rejected" >= (0)::numeric))
);


ALTER TABLE "public"."material_receptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."materials" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "common_name" "text" NOT NULL,
    "category" "public"."material_category" NOT NULL,
    "base_unit" "text" NOT NULL,
    "purchase_presentation" "text",
    "preferred_supplier_id" "uuid",
    "estimated_cost" numeric(14,4) DEFAULT 0 NOT NULL,
    "shelf_life_days" integer,
    "requires_lot" boolean DEFAULT true NOT NULL,
    "requires_temperature" boolean DEFAULT false NOT NULL,
    "minimum_stock" numeric(14,4) DEFAULT 0 NOT NULL,
    "status" "public"."record_status" DEFAULT 'activo'::"public"."record_status" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."materials" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nomina_detalle" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "periodo_id" "uuid" NOT NULL,
    "empleado_id" "uuid" NOT NULL,
    "salario_base_periodo" numeric(12,2) DEFAULT 0 NOT NULL,
    "bonificacion_incentivo_periodo" numeric(12,2) DEFAULT 0 NOT NULL,
    "dias_trabajados" numeric(5,2) DEFAULT 30 NOT NULL,
    "total_ingresos" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_descuentos" numeric(12,2) DEFAULT 0 NOT NULL,
    "neto_pagar" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_aportes_patronales" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_provisiones" numeric(12,2) DEFAULT 0 NOT NULL,
    "costo_total_empresa" numeric(12,2) DEFAULT 0 NOT NULL,
    "estado" "text" DEFAULT 'borrador'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "valor_hora" numeric(12,4),
    "horas_teoricas" numeric(8,2),
    "horas_trabajadas" numeric(8,2),
    "horas_normales_pagadas" numeric(8,2),
    "horas_extra" numeric(8,2),
    "pago_horas_normales" numeric(12,2),
    "pago_horas_extra" numeric(12,2),
    CONSTRAINT "nomina_detalle_estado_check" CHECK (("estado" = ANY (ARRAY['borrador'::"text", 'calculado'::"text", 'aprobado'::"text", 'pagado'::"text"])))
);


ALTER TABLE "public"."nomina_detalle" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nomina_detalle_conceptos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "nomina_detalle_id" "uuid" NOT NULL,
    "concepto_id" "uuid" NOT NULL,
    "nombre_concepto" "text" NOT NULL,
    "tipo_concepto" "text" NOT NULL,
    "monto" numeric(12,2) DEFAULT 0 NOT NULL,
    "calculado_automaticamente" boolean DEFAULT true NOT NULL,
    "observaciones" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."nomina_detalle_conceptos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nomina_pago_detalle" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "nomina_pago_id" "uuid" NOT NULL,
    "empleado_id" "uuid" NOT NULL,
    "nomina_detalle_id" "uuid",
    "banco_destino" "text",
    "cuenta_destino" "text",
    "monto" numeric(12,2) DEFAULT 0 NOT NULL,
    "referencia" "text",
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "nomina_pago_detalle_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'procesado'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."nomina_pago_detalle" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nomina_pagos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "periodo_id" "uuid" NOT NULL,
    "fecha_pago" "date" NOT NULL,
    "banco_origen" "text",
    "cuenta_origen" "text",
    "monto_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "observaciones" "text",
    "archivo_generado_url" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "nomina_pagos_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'preparado'::"text", 'enviado'::"text", 'pagado'::"text", 'conciliado'::"text"])))
);


ALTER TABLE "public"."nomina_pagos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nomina_periodos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "fecha_inicio" "date" NOT NULL,
    "fecha_fin" "date" NOT NULL,
    "tipo_periodo" "text" NOT NULL,
    "estado" "text" DEFAULT 'borrador'::"text" NOT NULL,
    "fecha_pago" "date",
    "journal_entry_id" "uuid",
    "observaciones" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "horas_teoricas" numeric(8,2),
    "dias_normales" integer,
    "sabados" integer,
    CONSTRAINT "nomina_periodos_estado_check" CHECK (("estado" = ANY (ARRAY['borrador'::"text", 'calculado'::"text", 'revisado'::"text", 'aprobado'::"text", 'pagado'::"text", 'contabilizado'::"text", 'cerrado'::"text"]))),
    CONSTRAINT "nomina_periodos_tipo_periodo_check" CHECK (("tipo_periodo" = ANY (ARRAY['semanal'::"text", 'quincenal'::"text", 'mensual'::"text"])))
);


ALTER TABLE "public"."nomina_periodos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."operator_invitation_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "empleado_id" "uuid" NOT NULL,
    "invite_code" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "expires_at" timestamp with time zone,
    "used_at" timestamp with time zone,
    "used_by_profile_id" "uuid",
    "created_by" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "operator_invitation_codes_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'used'::"text", 'revoked'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."operator_invitation_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."operator_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "empleado_id" "uuid" NOT NULL,
    "invite_code" "text" NOT NULL,
    "expires_at" timestamp with time zone,
    "used_at" timestamp with time zone,
    "used_by" "uuid",
    "revoked_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."operator_invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_claims" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "claim_type" "text" NOT NULL,
    "status" "text" DEFAULT 'abierto'::"text" NOT NULL,
    "description" "text",
    "amount" numeric DEFAULT 0,
    "cost_amount" numeric DEFAULT 0,
    "resolution_type" "text",
    "resolution_notes" "text",
    "sale_loss" numeric DEFAULT 0,
    "credit_note_value" numeric DEFAULT 0,
    "replacement_order_id" "uuid",
    "created_by" "uuid",
    "resolved_by" "uuid",
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "order_claims_claim_type_check" CHECK (("claim_type" = ANY (ARRAY['calidad'::"text", 'problema_entrega'::"text", 'cantidad'::"text"]))),
    CONSTRAINT "order_claims_resolution_type_check" CHECK (("resolution_type" = ANY (ARRAY['refacturacion'::"text", 'nota_credito'::"text", 'reposicion'::"text"]))),
    CONSTRAINT "order_claims_status_check" CHECK (("status" = ANY (ARRAY['abierto'::"text", 'cerrado'::"text"])))
);


ALTER TABLE "public"."order_claims" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_deliveries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "is_partial" boolean DEFAULT false,
    "delivery_photo_url" "text",
    "notes" "text",
    "delivered_by" "uuid",
    "delivered_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."order_deliveries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_delivery_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "delivery_id" "uuid" NOT NULL,
    "order_item_id" "uuid" NOT NULL,
    "quantity_delivered" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."order_delivery_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "product_presentation_id" "uuid" NOT NULL,
    "quantity" numeric NOT NULL,
    "unit_price" numeric NOT NULL,
    "subtotal" numeric NOT NULL,
    "quantity_packed" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "quantity_delivered" numeric DEFAULT 0
);


ALTER TABLE "public"."order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_logistics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "truck" "text",
    "route" "text",
    "driver_name" "text",
    "notes" "text",
    "assigned_by" "uuid",
    "assigned_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."order_logistics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_packings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "order_item_id" "uuid" NOT NULL,
    "finished_inventory_lot_id" "uuid" NOT NULL,
    "quantity_packed" numeric NOT NULL,
    "packed_by" "uuid",
    "packed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."order_packings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "order_number" bigint NOT NULL,
    "client_id" "uuid" NOT NULL,
    "channel" "text" DEFAULT 'manual'::"text" NOT NULL,
    "channel_reference" "text",
    "delivery_date" "date" NOT NULL,
    "status" "text" DEFAULT 'confirmado'::"text" NOT NULL,
    "notes" "text",
    "total" numeric DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_replacement" boolean DEFAULT false,
    "is_invoiceable" boolean DEFAULT true,
    "replacement_for_order_id" "uuid",
    "iva_rate" numeric DEFAULT 0.12,
    "collected_at" timestamp with time zone,
    "cost_center_id" "uuid",
    "moneda" "text" DEFAULT 'GTQ'::"text" NOT NULL,
    "tipo_cambio" numeric(10,4),
    "es_exportacion" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


ALTER TABLE "public"."orders" ALTER COLUMN "order_number" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."orders_order_number_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."organization_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "email" "text",
    "invitation_code" "text" NOT NULL,
    "role" "public"."app_role_type" NOT NULL,
    "is_admin" boolean DEFAULT false NOT NULL,
    "used" boolean DEFAULT false NOT NULL,
    "expires_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."organization_invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "invitation_code" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "address" "text",
    "phone" "text",
    "email" "text",
    "rtn" "text",
    "city" "text",
    "country" "text" DEFAULT 'Guatemala'::"text",
    "operator_invitation_code" "text"
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."packaging_inventory_lots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "reception_id" "uuid" NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "material_id" "uuid" NOT NULL,
    "internal_lot" "text" NOT NULL,
    "supplier_lot" "text",
    "received_date" "date" NOT NULL,
    "available_quantity" numeric(14,4) NOT NULL,
    "original_quantity" numeric(14,4) NOT NULL,
    "unit" "text" NOT NULL,
    "unit_cost" numeric(14,4) DEFAULT 0 NOT NULL,
    "total_cost" numeric(14,4) DEFAULT 0 NOT NULL,
    "location" "text",
    "minimum_stock" numeric(14,4) DEFAULT 0 NOT NULL,
    "alert_active" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'disponible'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "packaging_inventory_lots_available_quantity_check" CHECK (("available_quantity" >= (0)::numeric)),
    CONSTRAINT "packaging_inventory_lots_original_quantity_check" CHECK (("original_quantity" >= (0)::numeric))
);


ALTER TABLE "public"."packaging_inventory_lots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."packaging_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "product_presentation_id" "uuid" NOT NULL,
    "run_date" "date" NOT NULL,
    "quantity_to_pack" numeric NOT NULL,
    "finished_lot_code" "text" NOT NULL,
    "notes" "text",
    "status" "text" DEFAULT 'en_proceso'::"text" NOT NULL,
    "selected_lots" "jsonb",
    "packaging_run_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "packaging_orders_status_check" CHECK (("status" = ANY (ARRAY['en_proceso'::"text", 'completado'::"text", 'cancelado'::"text"])))
);


ALTER TABLE "public"."packaging_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."packaging_run_inputs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "packaging_run_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "input_type" "text" NOT NULL,
    "source_lot_id" "uuid" NOT NULL,
    "material_id" "uuid" NOT NULL,
    "quantity_used" numeric DEFAULT 0 NOT NULL,
    "unit" "text" NOT NULL,
    "unit_cost" numeric DEFAULT 0 NOT NULL,
    "total_cost" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "packaging_run_inputs_input_type_check" CHECK (("input_type" = ANY (ARRAY['procesado'::"text", 'empaque'::"text"])))
);


ALTER TABLE "public"."packaging_run_inputs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."packaging_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "product_presentation_id" "uuid" NOT NULL,
    "run_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "finished_lot_code" "text" NOT NULL,
    "quantity_produced" numeric DEFAULT 0 NOT NULL,
    "unit" "text" DEFAULT 'unidad'::"text" NOT NULL,
    "status" "text" DEFAULT 'completado'::"text" NOT NULL,
    "notes" "text",
    "total_cost" numeric DEFAULT 0 NOT NULL,
    "unit_cost" numeric DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "total_input_weight_lb" numeric DEFAULT 0 NOT NULL,
    "packed_weight_lb" numeric DEFAULT 0 NOT NULL,
    "waste_weight_lb" numeric DEFAULT 0 NOT NULL,
    "waste_percentage" numeric DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."packaging_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."packing_run_inputs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "packing_run_id" "uuid" NOT NULL,
    "processed_inventory_lot_id" "uuid" NOT NULL,
    "material_id" "uuid" NOT NULL,
    "consumed_quantity" numeric(14,4) DEFAULT 0 NOT NULL,
    "unit" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."packing_run_inputs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."packing_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "product_presentation_id" "uuid" NOT NULL,
    "product_base_id" "uuid" NOT NULL,
    "packing_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "units_packed" numeric(14,4) DEFAULT 0 NOT NULL,
    "net_weight_per_unit" numeric(14,4) DEFAULT 0 NOT NULL,
    "weight_unit" "text" DEFAULT 'oz'::"text" NOT NULL,
    "total_input_weight" numeric(14,4) DEFAULT 0 NOT NULL,
    "waste_weight" numeric(14,4) DEFAULT 0 NOT NULL,
    "waste_percentage" numeric(10,4) DEFAULT 0 NOT NULL,
    "packaging_material_id" "uuid",
    "packaging_quantity_total" numeric(14,4) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'empacado'::"text" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."packing_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."parametros_nomina" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "vigencia_desde" "date" NOT NULL,
    "vigencia_hasta" "date",
    "porcentaje_igss_laboral" numeric(6,4) DEFAULT 0.0483 NOT NULL,
    "porcentaje_igss_patronal" numeric(6,4) DEFAULT 0.1267 NOT NULL,
    "monto_bonificacion_incentivo" numeric(12,2) DEFAULT 250 NOT NULL,
    "provision_aguinaldo_pct" numeric(6,4) DEFAULT 0.0833 NOT NULL,
    "provision_bono14_pct" numeric(6,4) DEFAULT 0.0833 NOT NULL,
    "provision_pasivo_laboral_pct" numeric(6,4) DEFAULT 0.0833 NOT NULL,
    "provision_vacaciones_pct" numeric(6,4) DEFAULT 0.0417 NOT NULL,
    "porcentaje_subsidio_incapacidad" numeric(6,4) DEFAULT 0.6700,
    "dias_vacaciones_anuales" integer DEFAULT 15 NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "salario_minimo" numeric(12,2) DEFAULT 0
);


ALTER TABLE "public"."parametros_nomina" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prestamos_empleado" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "empleado_id" "uuid" NOT NULL,
    "fecha_otorgado" "date" NOT NULL,
    "monto_total" numeric(12,2) NOT NULL,
    "saldo_actual" numeric(12,2) NOT NULL,
    "cuota_periodica" numeric(12,2) DEFAULT 0 NOT NULL,
    "tipo_descuento" "text" DEFAULT 'fijo'::"text" NOT NULL,
    "estado" "text" DEFAULT 'activo'::"text" NOT NULL,
    "observaciones" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "prestamos_empleado_estado_check" CHECK (("estado" = ANY (ARRAY['activo'::"text", 'saldado'::"text", 'cancelado'::"text"]))),
    CONSTRAINT "prestamos_empleado_tipo_descuento_check" CHECK (("tipo_descuento" = ANY (ARRAY['fijo'::"text", 'porcentaje'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."prestamos_empleado" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prestamos_empleado_movimientos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "prestamo_id" "uuid" NOT NULL,
    "periodo_id" "uuid",
    "fecha" "date" NOT NULL,
    "tipo_movimiento" "text" NOT NULL,
    "monto" numeric(12,2) NOT NULL,
    "saldo_resultante" numeric(12,2) NOT NULL,
    "observaciones" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "prestamos_empleado_movimientos_tipo_movimiento_check" CHECK (("tipo_movimiento" = ANY (ARRAY['desembolso'::"text", 'descuento_nomina'::"text", 'ajuste'::"text", 'pago_manual'::"text"])))
);


ALTER TABLE "public"."prestamos_empleado_movimientos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."processed_inventory_lots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "process_run_id" "uuid" NOT NULL,
    "source_output_id" "uuid" NOT NULL,
    "material_id" "uuid" NOT NULL,
    "processed_stage" "public"."process_stage_type" NOT NULL,
    "processed_type" "text" DEFAULT 'unico'::"text" NOT NULL,
    "internal_lot" "text" NOT NULL,
    "available_quantity" numeric(14,4) DEFAULT 0 NOT NULL,
    "original_quantity" numeric(14,4) DEFAULT 0 NOT NULL,
    "unit" "text" NOT NULL,
    "accumulated_cost" numeric(14,4) DEFAULT 0 NOT NULL,
    "location" "text",
    "status" "text" DEFAULT 'disponible'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reserved_quantity" numeric DEFAULT 0 NOT NULL,
    "minimum_stock" numeric DEFAULT 0 NOT NULL,
    "source_inventory_lot_id" "uuid",
    "process_waste_percentage" numeric DEFAULT 0 NOT NULL,
    "accepted_supplier_waste_percentage" numeric DEFAULT 0 NOT NULL,
    "supplier_discount_amount" numeric DEFAULT 0 NOT NULL,
    "payable_amount" numeric DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."processed_inventory_lots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_base_recipe_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "product_base_id" "uuid" NOT NULL,
    "recipe_snapshot" "jsonb" NOT NULL,
    "changed_by" "uuid",
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."product_base_recipe_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_base_recipes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "product_base_id" "uuid" NOT NULL,
    "material_id" "uuid" NOT NULL,
    "percentage" numeric(7,4) NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "product_base_recipes_percentage_check" CHECK ((("percentage" >= (0)::numeric) AND ("percentage" <= (100)::numeric)))
);


ALTER TABLE "public"."product_base_recipes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_bases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "common_name" "text" NOT NULL,
    "category" "text",
    "status" "public"."record_status" DEFAULT 'activo'::"public"."record_status" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."product_bases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_presentations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "product_base_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "net_weight" numeric(14,4) DEFAULT 0 NOT NULL,
    "unit" "text" DEFAULT 'oz'::"text" NOT NULL,
    "shelf_life_days" integer DEFAULT 0 NOT NULL,
    "suggested_price" numeric(14,4) DEFAULT 0 NOT NULL,
    "standard_cost" numeric(14,4) DEFAULT 0 NOT NULL,
    "packaging_material_id" "uuid",
    "packaging_quantity" numeric(14,4) DEFAULT 1 NOT NULL,
    "status" "public"."record_status" DEFAULT 'activo'::"public"."record_status" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "min_profitable_price" numeric(14,4),
    "volume_low_threshold" integer DEFAULT 50,
    "volume_high_threshold" integer DEFAULT 200,
    "producto_sombrilla_id" "uuid",
    "peso_neto_kg" numeric(10,4),
    "barcode" "text"
);


ALTER TABLE "public"."product_presentations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."productos_sombrilla" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "codigo" "text",
    "codigo_arancelario" "text",
    "unidad_facturacion" "text" DEFAULT 'kg'::"text" NOT NULL,
    "descripcion_factura" "text",
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."productos_sombrilla" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "organization_id" "uuid",
    "full_name" "text",
    "email" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "is_admin" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "role" "text" DEFAULT 'admin'::"text",
    "empleado_id" "uuid",
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'operario'::"text", 'supervisor'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prospects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "commercial_name" "text" NOT NULL,
    "legal_name" "text",
    "contact_name" "text",
    "email" "text",
    "phone" "text",
    "nit" "text",
    "commercial_address" "text",
    "delivery_address" "text",
    "channel" "text" DEFAULT 'directo'::"text",
    "country" "text" DEFAULT 'Guatemala'::"text",
    "preferred_currency" "text" DEFAULT 'GTQ'::"text",
    "payment_terms" "text",
    "logistics_notes" "text",
    "commercial_notes" "text",
    "credit_days" integer DEFAULT 0,
    "status" "text" DEFAULT 'activo'::"text" NOT NULL,
    "converted_client_id" "uuid",
    "converted_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "prospects_status_check" CHECK (("status" = ANY (ARRAY['activo'::"text", 'convertido'::"text", 'descartado'::"text"])))
);


ALTER TABLE "public"."prospects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."provisiones_laborales" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "empleado_id" "uuid" NOT NULL,
    "periodo_id" "uuid" NOT NULL,
    "provision_aguinaldo" numeric(12,2) DEFAULT 0 NOT NULL,
    "provision_bono14" numeric(12,2) DEFAULT 0 NOT NULL,
    "provision_pasivo_laboral" numeric(12,2) DEFAULT 0 NOT NULL,
    "provision_vacaciones" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_provisionado_periodo" numeric(12,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."provisiones_laborales" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "purchase_order_id" "uuid" NOT NULL,
    "material_id" "uuid" NOT NULL,
    "quantity" numeric(14,4) NOT NULL,
    "unit" "text" NOT NULL,
    "unit_cost" numeric(14,4) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "purchase_order_items_quantity_check" CHECK (("quantity" > (0)::numeric))
);


ALTER TABLE "public"."purchase_order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "order_number" "text" NOT NULL,
    "delivery_date" "date",
    "status" "text" DEFAULT 'abierta'::"text" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payment_status" "text" DEFAULT 'pendiente'::"text",
    "paid_at" timestamp with time zone,
    "cost_center_id" "uuid",
    CONSTRAINT "purchase_orders_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['pendiente'::"text", 'pagado'::"text"])))
);


ALTER TABLE "public"."purchase_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quote_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "quote_id" "uuid" NOT NULL,
    "product_presentation_id" "uuid" NOT NULL,
    "estimated_volume" integer DEFAULT 1 NOT NULL,
    "unit" "text" DEFAULT 'unidad'::"text" NOT NULL,
    "ref_price" numeric(14,4) DEFAULT 0 NOT NULL,
    "min_price" numeric(14,4) DEFAULT 0 NOT NULL,
    "volume_class" "text" DEFAULT 'medio'::"text" NOT NULL,
    "rule_applied" "text",
    "adjustment_pct" numeric(6,2) DEFAULT 0 NOT NULL,
    "suggested_price" numeric(14,4) DEFAULT 0 NOT NULL,
    "price_note" "text",
    "final_price" numeric(14,4) DEFAULT 0 NOT NULL,
    "subtotal" numeric(14,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."quote_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quotes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "quote_number" "text" NOT NULL,
    "client_id" "uuid",
    "prospect_id" "uuid",
    "quote_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "valid_until" "date" NOT NULL,
    "currency" "text" DEFAULT 'GTQ'::"text" NOT NULL,
    "growth_opportunity" "text" DEFAULT 'media'::"text" NOT NULL,
    "estimated_frequency" "text" DEFAULT 'mensual'::"text",
    "commercial_notes" "text",
    "auto_note" "text",
    "status" "text" DEFAULT 'borrador'::"text" NOT NULL,
    "converted_order_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "quotes_client_or_prospect" CHECK ((("client_id" IS NOT NULL) OR ("prospect_id" IS NOT NULL))),
    CONSTRAINT "quotes_estimated_frequency_check" CHECK (("estimated_frequency" = ANY (ARRAY['semanal'::"text", 'quincenal'::"text", 'mensual'::"text", 'trimestral'::"text", 'eventual'::"text"]))),
    CONSTRAINT "quotes_growth_opportunity_check" CHECK (("growth_opportunity" = ANY (ARRAY['baja'::"text", 'media'::"text", 'alta'::"text"]))),
    CONSTRAINT "quotes_status_check" CHECK (("status" = ANY (ARRAY['borrador'::"text", 'emitida'::"text", 'aceptada'::"text", 'rechazada'::"text", 'vencida'::"text", 'convertida'::"text"])))
);


ALTER TABLE "public"."quotes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recalls" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "numero" "text",
    "tipo" "text" NOT NULL,
    "motivo" "text" NOT NULL,
    "descripcion" "text",
    "lote_origen_id" "uuid",
    "lote_origen_tipo" "text",
    "lote_origen_codigo" "text",
    "status" "text" DEFAULT 'activo'::"text" NOT NULL,
    "afectados_clientes" integer DEFAULT 0,
    "afectados_ordenes" integer DEFAULT 0,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "recalls_status_check" CHECK (("status" = ANY (ARRAY['activo'::"text", 'resuelto'::"text", 'cerrado'::"text"]))),
    CONSTRAINT "recalls_tipo_check" CHECK (("tipo" = ANY (ARRAY['materia_prima'::"text", 'lote_terminado'::"text"])))
);


ALTER TABLE "public"."recalls" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recipe_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recipe_id" "uuid",
    "material_id" "uuid",
    "percentage" numeric(5,2),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."recipe_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recipes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "sku_id" "uuid" NOT NULL,
    "version" integer DEFAULT 1,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."recipes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "role" "public"."app_role_type" NOT NULL,
    "module_key" "text" NOT NULL,
    "can_view" boolean DEFAULT false NOT NULL,
    "can_create" boolean DEFAULT false NOT NULL,
    "can_edit" boolean DEFAULT false NOT NULL,
    "can_delete" boolean DEFAULT false NOT NULL,
    "can_approve" boolean DEFAULT false NOT NULL,
    "can_export" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."role_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."salespeople" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text",
    "email" "text",
    "commission_pct" numeric(5,4) DEFAULT 0.04 NOT NULL,
    "status" "text" DEFAULT 'activo'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "salespeople_status_check" CHECK (("status" = ANY (ARRAY['activo'::"text", 'inactivo'::"text"])))
);


ALTER TABLE "public"."salespeople" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sedes_trabajo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "descripcion" "text",
    "direccion" "text",
    "latitud" numeric(10,7) NOT NULL,
    "longitud" numeric(10,7) NOT NULL,
    "radio_metros" integer DEFAULT 100 NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sedes_trabajo" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sku_riesgo_calculado" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "product_presentation_id" "uuid" NOT NULL,
    "fecha" "date" DEFAULT CURRENT_DATE NOT NULL,
    "score_riesgo" numeric(8,4) DEFAULT 0 NOT NULL,
    "probabilidad_final" numeric(5,3) DEFAULT 0.400 NOT NULL,
    "reclamos_usados" integer DEFAULT 0,
    "no_conformidades_usadas" integer DEFAULT 0,
    "resultados_usados" integer DEFAULT 0,
    "ultimo_resultado" "text",
    "ajuste_resultado" numeric(5,3) DEFAULT 0,
    "seleccionado" boolean DEFAULT false,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sku_riesgo_calculado" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."skus" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "common_name" "text" NOT NULL,
    "category" "public"."sku_category" NOT NULL,
    "net_weight" numeric(14,4) DEFAULT 0 NOT NULL,
    "unit" "text" NOT NULL,
    "shelf_life_days" integer DEFAULT 0 NOT NULL,
    "suggested_price" numeric(14,4) DEFAULT 0 NOT NULL,
    "standard_cost" numeric(14,4) DEFAULT 0 NOT NULL,
    "packaging_cost" numeric(14,4) DEFAULT 0 NOT NULL,
    "status" "public"."record_status" DEFAULT 'activo'::"public"."record_status" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "packaging_material_id" "uuid"
);


ALTER TABLE "public"."skus" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supplier_accounts_payable" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "source_type" "text" DEFAULT 'material_process'::"text" NOT NULL,
    "source_inventory_lot_id" "uuid",
    "processed_inventory_lot_id" "uuid",
    "output_id" "uuid",
    "description" "text",
    "original_amount" numeric DEFAULT 0 NOT NULL,
    "accepted_supplier_waste_percentage" numeric DEFAULT 0 NOT NULL,
    "supplier_discount_amount" numeric DEFAULT 0 NOT NULL,
    "payable_amount" numeric DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."supplier_accounts_payable" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supplier_materials" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "material_id" "uuid" NOT NULL,
    "supplier_product_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."supplier_materials" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."suppliers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "nit" "text",
    "phone" "text",
    "email" "text",
    "contact_name" "text",
    "payment_days" integer DEFAULT 0 NOT NULL,
    "status" "public"."record_status" DEFAULT 'activo'::"public"."record_status" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "suppliers_payment_days_check" CHECK (("payment_days" >= 0))
);


ALTER TABLE "public"."suppliers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "role" "public"."app_role_type" NOT NULL,
    "assigned_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_costo_laboral_diario" AS
 SELECT "organization_id",
    "fecha",
    "sum"(COALESCE("costo_total_preliminar_dia", (COALESCE("costo_dia_preliminar", (0)::numeric) + COALESCE("costo_extra_preliminar", (0)::numeric)))) AS "costo_laboral_total",
    "sum"(COALESCE("horas_trabajadas", (0)::numeric)) AS "total_horas_trabajadas",
    "sum"(COALESCE("exceso_dia", (0)::numeric)) AS "total_horas_extra",
    "count"(*) AS "total_colaboradores",
    "count"(*) FILTER (WHERE (("hora_salida" IS NULL) AND ("estado" = 'incompleta'::"text"))) AS "sin_salida"
   FROM "public"."marcaciones"
  WHERE ("estado" = ANY (ARRAY['completa'::"text", 'aprobada'::"text", 'pendiente_revision'::"text"]))
  GROUP BY "organization_id", "fecha";


ALTER VIEW "public"."v_costo_laboral_diario" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_produccion_diaria" AS
 SELECT "organization_id",
    "run_date" AS "fecha",
    "sum"(COALESCE("packed_weight_lb", (0)::numeric)) AS "libras_producidas",
    "sum"(COALESCE("quantity_produced", (0)::numeric)) AS "unidades_producidas",
    "count"(*) AS "total_runs"
   FROM "public"."packaging_runs"
  WHERE ("status" = ANY (ARRAY['completed'::"text", 'completado'::"text"]))
  GROUP BY "organization_id", "run_date";


ALTER VIEW "public"."v_produccion_diaria" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_reclamos_calidad_sku" AS
 SELECT "oc"."organization_id",
    "oi"."product_presentation_id",
    "date"("oc"."created_at") AS "fecha",
    "oc"."id" AS "reclamo_id"
   FROM ("public"."order_claims" "oc"
     JOIN "public"."order_items" "oi" ON (("oi"."order_id" = "oc"."order_id")))
  WHERE (("oc"."claim_type" = 'calidad'::"text") AND ("oc"."status" <> 'anulado'::"text"));


ALTER VIEW "public"."v_reclamos_calidad_sku" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vacaciones_empleado" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "empleado_id" "uuid" NOT NULL,
    "fecha_inicio" "date" NOT NULL,
    "fecha_fin" "date" NOT NULL,
    "dias_tomados" numeric(5,2) DEFAULT 0 NOT NULL,
    "estado" "text" DEFAULT 'solicitada'::"text" NOT NULL,
    "periodo_id" "uuid",
    "observaciones" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "vacaciones_empleado_estado_check" CHECK (("estado" = ANY (ARRAY['solicitada'::"text", 'aprobada'::"text", 'rechazada'::"text", 'pagada'::"text", 'aplicada'::"text"])))
);


ALTER TABLE "public"."vacaciones_empleado" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vacaciones_saldos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "empleado_id" "uuid" NOT NULL,
    "dias_ganados" numeric(6,2) DEFAULT 0 NOT NULL,
    "dias_tomados" numeric(6,2) DEFAULT 0 NOT NULL,
    "dias_disponibles" numeric(6,2) GENERATED ALWAYS AS (("dias_ganados" - "dias_tomados")) STORED,
    "fecha_corte" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vacaciones_saldos" OWNER TO "postgres";


ALTER TABLE ONLY "public"."accounting_accounts"
    ADD CONSTRAINT "accounting_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."anticipos_empleado"
    ADD CONSTRAINT "anticipos_empleado_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cierres_detalle_sku"
    ADD CONSTRAINT "cierres_detalle_sku_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cierres_eventos"
    ADD CONSTRAINT "cierres_eventos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cierres_operativos"
    ADD CONSTRAINT "cierres_operativos_organization_id_tipo_periodo_fecha_inici_key" UNIQUE ("organization_id", "tipo_periodo", "fecha_inicio", "fecha_fin");



ALTER TABLE ONLY "public"."cierres_operativos"
    ADD CONSTRAINT "cierres_operativos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_addresses"
    ADD CONSTRAINT "client_addresses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_agreed_prices"
    ADD CONSTRAINT "client_agreed_prices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conceptos_nomina"
    ADD CONSTRAINT "conceptos_nomina_organization_id_codigo_key" UNIQUE ("organization_id", "codigo");



ALTER TABLE ONLY "public"."conceptos_nomina"
    ADD CONSTRAINT "conceptos_nomina_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."configuracion_jornada"
    ADD CONSTRAINT "configuracion_jornada_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."configuracion_muestreo"
    ADD CONSTRAINT "configuracion_muestreo_organization_id_key" UNIQUE ("organization_id");



ALTER TABLE ONLY "public"."configuracion_muestreo"
    ADD CONSTRAINT "configuracion_muestreo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cost_centers"
    ADD CONSTRAINT "cost_centers_code_org_unique" UNIQUE ("code", "organization_id");



ALTER TABLE ONLY "public"."cost_centers"
    ADD CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_prices"
    ADD CONSTRAINT "customer_prices_client_id_sku_id_key" UNIQUE ("client_id", "sku_id");



ALTER TABLE ONLY "public"."customer_prices"
    ADD CONSTRAINT "customer_prices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."defectos_inspeccion"
    ADD CONSTRAINT "defectos_inspeccion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."empleado_salario_historial"
    ADD CONSTRAINT "empleado_salario_historial_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."empleados"
    ADD CONSTRAINT "empleados_organization_id_codigo_empleado_key" UNIQUE ("organization_id", "codigo_empleado");



ALTER TABLE ONLY "public"."empleados"
    ADD CONSTRAINT "empleados_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employee_biometrics"
    ADD CONSTRAINT "employee_biometrics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."facturas_exportacion_desglose"
    ADD CONSTRAINT "facturas_exportacion_desglose_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."facturas_exportacion_lineas"
    ADD CONSTRAINT "facturas_exportacion_lineas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."facturas_exportacion"
    ADD CONSTRAINT "facturas_exportacion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."finished_goods_inventory_lots"
    ADD CONSTRAINT "finished_goods_inventory_lots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."finished_inventory_lots"
    ADD CONSTRAINT "finished_inventory_lots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."incapacidades_empleado"
    ADD CONSTRAINT "incapacidades_empleado_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inspecciones_calidad"
    ADD CONSTRAINT "inspecciones_calidad_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."journal_entries"
    ADD CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."journal_entry_lines"
    ADD CONSTRAINT "journal_entry_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kpi_costo_laboral_diario"
    ADD CONSTRAINT "kpi_costo_laboral_diario_organization_id_fecha_key" UNIQUE ("organization_id", "fecha");



ALTER TABLE ONLY "public"."kpi_costo_laboral_diario"
    ADD CONSTRAINT "kpi_costo_laboral_diario_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."liquidaciones_empleado"
    ADD CONSTRAINT "liquidaciones_empleado_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."marcaciones"
    ADD CONSTRAINT "marcaciones_empleado_id_fecha_key" UNIQUE ("empleado_id", "fecha");



ALTER TABLE ONLY "public"."marcaciones"
    ADD CONSTRAINT "marcaciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."material_inventory_lots"
    ADD CONSTRAINT "material_inventory_lots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."material_inventory_lots"
    ADD CONSTRAINT "material_inventory_lots_reception_id_key" UNIQUE ("reception_id");



ALTER TABLE ONLY "public"."material_price_history"
    ADD CONSTRAINT "material_price_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."material_process_runs"
    ADD CONSTRAINT "material_process_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."material_process_stage_outputs"
    ADD CONSTRAINT "material_process_stage_outputs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."material_receptions"
    ADD CONSTRAINT "material_receptions_organization_id_internal_lot_key" UNIQUE ("organization_id", "internal_lot");



ALTER TABLE ONLY "public"."material_receptions"
    ADD CONSTRAINT "material_receptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."materials"
    ADD CONSTRAINT "materials_organization_id_code_key" UNIQUE ("organization_id", "code");



ALTER TABLE ONLY "public"."materials"
    ADD CONSTRAINT "materials_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nomina_detalle_conceptos"
    ADD CONSTRAINT "nomina_detalle_conceptos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nomina_detalle"
    ADD CONSTRAINT "nomina_detalle_periodo_id_empleado_id_key" UNIQUE ("periodo_id", "empleado_id");



ALTER TABLE ONLY "public"."nomina_detalle"
    ADD CONSTRAINT "nomina_detalle_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nomina_pago_detalle"
    ADD CONSTRAINT "nomina_pago_detalle_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nomina_pagos"
    ADD CONSTRAINT "nomina_pagos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nomina_periodos"
    ADD CONSTRAINT "nomina_periodos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."operator_invitation_codes"
    ADD CONSTRAINT "operator_invitation_codes_invite_code_key" UNIQUE ("invite_code");



ALTER TABLE ONLY "public"."operator_invitation_codes"
    ADD CONSTRAINT "operator_invitation_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."operator_invitations"
    ADD CONSTRAINT "operator_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_claims"
    ADD CONSTRAINT "order_claims_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_deliveries"
    ADD CONSTRAINT "order_deliveries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_delivery_items"
    ADD CONSTRAINT "order_delivery_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_logistics"
    ADD CONSTRAINT "order_logistics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_packings"
    ADD CONSTRAINT "order_packings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_invitations"
    ADD CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_invitation_code_key" UNIQUE ("invitation_code");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."packaging_inventory_lots"
    ADD CONSTRAINT "packaging_inventory_lots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."packaging_inventory_lots"
    ADD CONSTRAINT "packaging_inventory_lots_reception_id_key" UNIQUE ("reception_id");



ALTER TABLE ONLY "public"."packaging_orders"
    ADD CONSTRAINT "packaging_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."packaging_run_inputs"
    ADD CONSTRAINT "packaging_run_inputs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."packaging_runs"
    ADD CONSTRAINT "packaging_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."packing_run_inputs"
    ADD CONSTRAINT "packing_run_inputs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."packing_runs"
    ADD CONSTRAINT "packing_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."parametros_nomina"
    ADD CONSTRAINT "parametros_nomina_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prestamos_empleado_movimientos"
    ADD CONSTRAINT "prestamos_empleado_movimientos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prestamos_empleado"
    ADD CONSTRAINT "prestamos_empleado_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."processed_inventory_lots"
    ADD CONSTRAINT "processed_inventory_lots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_base_recipe_history"
    ADD CONSTRAINT "product_base_recipe_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_base_recipes"
    ADD CONSTRAINT "product_base_recipes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_bases"
    ADD CONSTRAINT "product_bases_organization_id_code_key" UNIQUE ("organization_id", "code");



ALTER TABLE ONLY "public"."product_bases"
    ADD CONSTRAINT "product_bases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_presentations"
    ADD CONSTRAINT "product_presentations_organization_id_code_key" UNIQUE ("organization_id", "code");



ALTER TABLE ONLY "public"."product_presentations"
    ADD CONSTRAINT "product_presentations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."productos_sombrilla"
    ADD CONSTRAINT "productos_sombrilla_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prospects"
    ADD CONSTRAINT "prospects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provisiones_laborales"
    ADD CONSTRAINT "provisiones_laborales_periodo_id_empleado_id_key" UNIQUE ("periodo_id", "empleado_id");



ALTER TABLE ONLY "public"."provisiones_laborales"
    ADD CONSTRAINT "provisiones_laborales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_order_items"
    ADD CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_organization_id_order_number_key" UNIQUE ("organization_id", "order_number");



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quote_items"
    ADD CONSTRAINT "quote_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recalls"
    ADD CONSTRAINT "recalls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recipe_items"
    ADD CONSTRAINT "recipe_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recipes"
    ADD CONSTRAINT "recipes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_module_key_key" UNIQUE ("role", "module_key");



ALTER TABLE ONLY "public"."salespeople"
    ADD CONSTRAINT "salespeople_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sedes_trabajo"
    ADD CONSTRAINT "sedes_trabajo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sku_riesgo_calculado"
    ADD CONSTRAINT "sku_riesgo_calculado_organization_id_product_presentation_i_key" UNIQUE ("organization_id", "product_presentation_id", "fecha");



ALTER TABLE ONLY "public"."sku_riesgo_calculado"
    ADD CONSTRAINT "sku_riesgo_calculado_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."skus"
    ADD CONSTRAINT "skus_organization_id_code_key" UNIQUE ("organization_id", "code");



ALTER TABLE ONLY "public"."skus"
    ADD CONSTRAINT "skus_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_accounts_payable"
    ADD CONSTRAINT "supplier_accounts_payable_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_materials"
    ADD CONSTRAINT "supplier_materials_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_materials"
    ADD CONSTRAINT "supplier_materials_supplier_id_material_id_key" UNIQUE ("supplier_id", "material_id");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_organization_id_role_key" UNIQUE ("user_id", "organization_id", "role");



ALTER TABLE ONLY "public"."vacaciones_empleado"
    ADD CONSTRAINT "vacaciones_empleado_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vacaciones_saldos"
    ADD CONSTRAINT "vacaciones_saldos_pkey" PRIMARY KEY ("id");



CREATE INDEX "employee_biometrics_org_idx" ON "public"."employee_biometrics" USING "btree" ("organization_id", "empleado_id");



CREATE INDEX "employee_biometrics_profile_idx" ON "public"."employee_biometrics" USING "btree" ("profile_id");



CREATE UNIQUE INDEX "employee_biometrics_unique_active_face" ON "public"."employee_biometrics" USING "btree" ("empleado_id", "biometric_type") WHERE ("enrollment_status" = 'active'::"text");



CREATE UNIQUE INDEX "facturas_exportacion_order_idx" ON "public"."facturas_exportacion" USING "btree" ("organization_id", "order_id") WHERE ("status" <> 'anulada'::"text");



CREATE INDEX "idx_anticipos_empleado" ON "public"."anticipos_empleado" USING "btree" ("empleado_id");



CREATE INDEX "idx_audit_logs_org" ON "public"."audit_logs" USING "btree" ("organization_id");



CREATE INDEX "idx_audit_logs_table" ON "public"."audit_logs" USING "btree" ("table_name");



CREATE INDEX "idx_cap_active" ON "public"."client_agreed_prices" USING "btree" ("client_id", "is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_cap_client" ON "public"."client_agreed_prices" USING "btree" ("client_id");



CREATE INDEX "idx_cierres_eventos_cierre" ON "public"."cierres_eventos" USING "btree" ("cierre_id");



CREATE INDEX "idx_cierres_org_tipo" ON "public"."cierres_operativos" USING "btree" ("organization_id", "tipo_periodo", "fecha_referencia" DESC);



CREATE INDEX "idx_cierres_sku_cierre" ON "public"."cierres_detalle_sku" USING "btree" ("cierre_id");



CREATE INDEX "idx_client_addresses_client" ON "public"."client_addresses" USING "btree" ("client_id");



CREATE INDEX "idx_clients_name" ON "public"."clients" USING "btree" ("organization_id", "commercial_name");



CREATE INDEX "idx_clients_org" ON "public"."clients" USING "btree" ("organization_id");



CREATE INDEX "idx_clients_salesperson" ON "public"."clients" USING "btree" ("salesperson_id");



CREATE INDEX "idx_cost_centers_parent" ON "public"."cost_centers" USING "btree" ("parent_id");



CREATE INDEX "idx_customer_prices_org" ON "public"."customer_prices" USING "btree" ("organization_id");



CREATE INDEX "idx_defectos_inspeccion" ON "public"."defectos_inspeccion" USING "btree" ("inspeccion_id");



CREATE INDEX "idx_empleados_estado" ON "public"."empleados" USING "btree" ("organization_id", "estado_laboral");



CREATE INDEX "idx_empleados_org" ON "public"."empleados" USING "btree" ("organization_id");



CREATE INDEX "idx_expenses_cc" ON "public"."expenses" USING "btree" ("cost_center_id");



CREATE INDEX "idx_expenses_org_date" ON "public"."expenses" USING "btree" ("organization_id", "expense_date" DESC);



CREATE INDEX "idx_expenses_source_order" ON "public"."expenses" USING "btree" ("source_order_id");



CREATE INDEX "idx_fact_desglose_factura" ON "public"."facturas_exportacion_desglose" USING "btree" ("factura_id");



CREATE INDEX "idx_fact_desglose_linea" ON "public"."facturas_exportacion_desglose" USING "btree" ("linea_id");



CREATE INDEX "idx_fact_lineas_factura" ON "public"."facturas_exportacion_lineas" USING "btree" ("factura_id");



CREATE INDEX "idx_facturas_exp_client" ON "public"."facturas_exportacion" USING "btree" ("client_id");



CREATE INDEX "idx_facturas_exp_order" ON "public"."facturas_exportacion" USING "btree" ("order_id");



CREATE INDEX "idx_facturas_exp_org" ON "public"."facturas_exportacion" USING "btree" ("organization_id");



CREATE INDEX "idx_fil_recall" ON "public"."finished_inventory_lots" USING "btree" ("recall_id");



CREATE INDEX "idx_finished_goods_inventory_lots_lot" ON "public"."finished_goods_inventory_lots" USING "btree" ("internal_lot");



CREATE INDEX "idx_finished_goods_inventory_lots_org" ON "public"."finished_goods_inventory_lots" USING "btree" ("organization_id");



CREATE INDEX "idx_finished_goods_inventory_lots_presentation" ON "public"."finished_goods_inventory_lots" USING "btree" ("product_presentation_id");



CREATE INDEX "idx_finished_inventory_lots_dates" ON "public"."finished_inventory_lots" USING "btree" ("production_date", "expiration_date");



CREATE INDEX "idx_finished_inventory_lots_org_status" ON "public"."finished_inventory_lots" USING "btree" ("organization_id", "status", "created_at" DESC);



CREATE INDEX "idx_incapacidades_empleado" ON "public"."incapacidades_empleado" USING "btree" ("empleado_id");



CREATE INDEX "idx_inspecciones_org_fecha" ON "public"."inspecciones_calidad" USING "btree" ("organization_id", "fecha");



CREATE INDEX "idx_inspecciones_sku" ON "public"."inspecciones_calidad" USING "btree" ("product_presentation_id");



CREATE INDEX "idx_kpi_costo_org_fecha" ON "public"."kpi_costo_laboral_diario" USING "btree" ("organization_id", "fecha" DESC);



CREATE INDEX "idx_liquidaciones_empleado" ON "public"."liquidaciones_empleado" USING "btree" ("empleado_id");



CREATE INDEX "idx_marcaciones_emp_fecha" ON "public"."marcaciones" USING "btree" ("empleado_id", "fecha");



CREATE INDEX "idx_marcaciones_estado" ON "public"."marcaciones" USING "btree" ("organization_id", "estado");



CREATE INDEX "idx_marcaciones_org_fecha" ON "public"."marcaciones" USING "btree" ("organization_id", "fecha");



CREATE INDEX "idx_material_inventory_lots_internal_lot" ON "public"."material_inventory_lots" USING "btree" ("internal_lot");



CREATE INDEX "idx_material_inventory_lots_material" ON "public"."material_inventory_lots" USING "btree" ("material_id");



CREATE INDEX "idx_material_inventory_lots_org" ON "public"."material_inventory_lots" USING "btree" ("organization_id");



CREATE INDEX "idx_material_inventory_lots_supplier" ON "public"."material_inventory_lots" USING "btree" ("supplier_id");



CREATE INDEX "idx_material_price_history_lookup" ON "public"."material_price_history" USING "btree" ("material_id", "supplier_id", "valid_from" DESC);



CREATE INDEX "idx_material_price_history_org" ON "public"."material_price_history" USING "btree" ("organization_id");



CREATE INDEX "idx_material_process_outputs_lot" ON "public"."material_process_stage_outputs" USING "btree" ("output_lot_code");



CREATE INDEX "idx_material_process_outputs_run" ON "public"."material_process_stage_outputs" USING "btree" ("process_run_id");



CREATE INDEX "idx_material_process_outputs_stage_used" ON "public"."material_process_stage_outputs" USING "btree" ("stage", "was_used", "sent_to_processed_inventory", "created_at" DESC);



CREATE INDEX "idx_material_process_runs_current_stage_status" ON "public"."material_process_runs" USING "btree" ("current_stage", "status", "created_at" DESC);



CREATE INDEX "idx_material_process_runs_org" ON "public"."material_process_runs" USING "btree" ("organization_id");



CREATE INDEX "idx_material_process_runs_source_lot" ON "public"."material_process_runs" USING "btree" ("source_inventory_lot_id");



CREATE INDEX "idx_material_receptions_material" ON "public"."material_receptions" USING "btree" ("material_id");



CREATE INDEX "idx_material_receptions_org" ON "public"."material_receptions" USING "btree" ("organization_id");



CREATE INDEX "idx_material_receptions_po" ON "public"."material_receptions" USING "btree" ("purchase_order_id");



CREATE INDEX "idx_material_receptions_po_item" ON "public"."material_receptions" USING "btree" ("purchase_order_item_id");



CREATE INDEX "idx_material_receptions_supplier" ON "public"."material_receptions" USING "btree" ("supplier_id");



CREATE INDEX "idx_materials_name" ON "public"."materials" USING "btree" ("organization_id", "common_name");



CREATE INDEX "idx_materials_org" ON "public"."materials" USING "btree" ("organization_id");



CREATE INDEX "idx_mil_recall" ON "public"."material_inventory_lots" USING "btree" ("recall_id");



CREATE INDEX "idx_nomina_detalle_empleado" ON "public"."nomina_detalle" USING "btree" ("empleado_id");



CREATE INDEX "idx_nomina_detalle_periodo" ON "public"."nomina_detalle" USING "btree" ("periodo_id");



CREATE INDEX "idx_nomina_pagos_periodo" ON "public"."nomina_pagos" USING "btree" ("periodo_id");



CREATE INDEX "idx_orders_cc" ON "public"."orders" USING "btree" ("cost_center_id");



CREATE INDEX "idx_org_invitations_code" ON "public"."organization_invitations" USING "btree" ("invitation_code");



CREATE INDEX "idx_org_invitations_org" ON "public"."organization_invitations" USING "btree" ("organization_id");



CREATE INDEX "idx_packaging_inventory_lots_internal_lot" ON "public"."packaging_inventory_lots" USING "btree" ("internal_lot");



CREATE INDEX "idx_packaging_inventory_lots_material" ON "public"."packaging_inventory_lots" USING "btree" ("material_id");



CREATE INDEX "idx_packaging_inventory_lots_org" ON "public"."packaging_inventory_lots" USING "btree" ("organization_id");



CREATE INDEX "idx_packaging_inventory_lots_supplier" ON "public"."packaging_inventory_lots" USING "btree" ("supplier_id");



CREATE INDEX "idx_packaging_orders_org_status" ON "public"."packaging_orders" USING "btree" ("organization_id", "status");



CREATE INDEX "idx_packaging_run_inputs_run" ON "public"."packaging_run_inputs" USING "btree" ("packaging_run_id", "input_type");



CREATE INDEX "idx_packaging_runs_org_date" ON "public"."packaging_runs" USING "btree" ("organization_id", "run_date" DESC);



CREATE INDEX "idx_packing_run_inputs_lot" ON "public"."packing_run_inputs" USING "btree" ("processed_inventory_lot_id");



CREATE INDEX "idx_packing_run_inputs_run" ON "public"."packing_run_inputs" USING "btree" ("packing_run_id");



CREATE INDEX "idx_packing_runs_org" ON "public"."packing_runs" USING "btree" ("organization_id");



CREATE INDEX "idx_packing_runs_presentation" ON "public"."packing_runs" USING "btree" ("product_presentation_id");



CREATE INDEX "idx_parametros_org" ON "public"."parametros_nomina" USING "btree" ("organization_id", "activo");



CREATE INDEX "idx_periodos_org" ON "public"."nomina_periodos" USING "btree" ("organization_id");



CREATE INDEX "idx_pp_sombrilla" ON "public"."product_presentations" USING "btree" ("producto_sombrilla_id");



CREATE INDEX "idx_prestamos_empleado" ON "public"."prestamos_empleado" USING "btree" ("empleado_id");



CREATE INDEX "idx_processed_inventory_lots_lot" ON "public"."processed_inventory_lots" USING "btree" ("internal_lot");



CREATE INDEX "idx_processed_inventory_lots_material" ON "public"."processed_inventory_lots" USING "btree" ("organization_id", "material_id", "created_at" DESC);



CREATE INDEX "idx_processed_inventory_lots_org" ON "public"."processed_inventory_lots" USING "btree" ("organization_id");



CREATE INDEX "idx_processed_inventory_lots_org_status" ON "public"."processed_inventory_lots" USING "btree" ("organization_id", "status", "created_at" DESC);



CREATE INDEX "idx_product_base_recipe_history_base" ON "public"."product_base_recipe_history" USING "btree" ("product_base_id");



CREATE INDEX "idx_product_base_recipes_base" ON "public"."product_base_recipes" USING "btree" ("product_base_id");



CREATE INDEX "idx_product_bases_name" ON "public"."product_bases" USING "btree" ("organization_id", "common_name");



CREATE INDEX "idx_product_bases_org" ON "public"."product_bases" USING "btree" ("organization_id");



CREATE INDEX "idx_product_presentations_base" ON "public"."product_presentations" USING "btree" ("product_base_id");



CREATE INDEX "idx_product_presentations_org" ON "public"."product_presentations" USING "btree" ("organization_id");



CREATE INDEX "idx_profiles_org" ON "public"."profiles" USING "btree" ("organization_id");



CREATE INDEX "idx_prospects_org" ON "public"."prospects" USING "btree" ("organization_id");



CREATE INDEX "idx_provisiones_empleado" ON "public"."provisiones_laborales" USING "btree" ("empleado_id");



CREATE INDEX "idx_provisiones_periodo" ON "public"."provisiones_laborales" USING "btree" ("periodo_id");



CREATE INDEX "idx_purchase_order_items_material" ON "public"."purchase_order_items" USING "btree" ("material_id");



CREATE INDEX "idx_purchase_order_items_material_unit" ON "public"."purchase_order_items" USING "btree" ("material_id", "unit");



CREATE INDEX "idx_purchase_order_items_po" ON "public"."purchase_order_items" USING "btree" ("purchase_order_id");



CREATE INDEX "idx_purchase_orders_cc" ON "public"."purchase_orders" USING "btree" ("cost_center_id");



CREATE INDEX "idx_purchase_orders_org" ON "public"."purchase_orders" USING "btree" ("organization_id");



CREATE INDEX "idx_purchase_orders_status" ON "public"."purchase_orders" USING "btree" ("status");



CREATE INDEX "idx_purchase_orders_supplier" ON "public"."purchase_orders" USING "btree" ("supplier_id");



CREATE INDEX "idx_quote_items_quote" ON "public"."quote_items" USING "btree" ("quote_id");



CREATE INDEX "idx_quotes_client" ON "public"."quotes" USING "btree" ("client_id");



CREATE INDEX "idx_quotes_org" ON "public"."quotes" USING "btree" ("organization_id");



CREATE INDEX "idx_quotes_prospect" ON "public"."quotes" USING "btree" ("prospect_id");



CREATE INDEX "idx_quotes_status" ON "public"."quotes" USING "btree" ("status");



CREATE INDEX "idx_recalls_org" ON "public"."recalls" USING "btree" ("organization_id");



CREATE INDEX "idx_salario_historial_emp" ON "public"."empleado_salario_historial" USING "btree" ("empleado_id");



CREATE INDEX "idx_salespeople_org" ON "public"."salespeople" USING "btree" ("organization_id");



CREATE INDEX "idx_sedes_org" ON "public"."sedes_trabajo" USING "btree" ("organization_id", "activo");



CREATE INDEX "idx_sku_riesgo_org_fecha" ON "public"."sku_riesgo_calculado" USING "btree" ("organization_id", "fecha");



CREATE INDEX "idx_skus_name" ON "public"."skus" USING "btree" ("organization_id", "common_name");



CREATE INDEX "idx_skus_org" ON "public"."skus" USING "btree" ("organization_id");



CREATE INDEX "idx_supplier_accounts_payable_supplier" ON "public"."supplier_accounts_payable" USING "btree" ("supplier_id", "status", "created_at" DESC);



CREATE INDEX "idx_suppliers_name" ON "public"."suppliers" USING "btree" ("organization_id", "name");



CREATE INDEX "idx_suppliers_org" ON "public"."suppliers" USING "btree" ("organization_id");



CREATE INDEX "idx_user_roles_org" ON "public"."user_roles" USING "btree" ("organization_id");



CREATE INDEX "idx_user_roles_user" ON "public"."user_roles" USING "btree" ("user_id");



CREATE INDEX "idx_vacaciones_empleado" ON "public"."vacaciones_empleado" USING "btree" ("empleado_id");



CREATE UNIQUE INDEX "operator_invitation_codes_active_employee_unique" ON "public"."operator_invitation_codes" USING "btree" ("empleado_id") WHERE ("status" = 'active'::"text");



CREATE INDEX "operator_invitation_codes_org_idx" ON "public"."operator_invitation_codes" USING "btree" ("organization_id", "empleado_id");



CREATE INDEX "operator_invitations_active_idx" ON "public"."operator_invitations" USING "btree" ("empleado_id", "expires_at") WHERE (("used_at" IS NULL) AND ("revoked_at" IS NULL));



CREATE UNIQUE INDEX "operator_invitations_invite_code_uidx" ON "public"."operator_invitations" USING "btree" ("upper"("invite_code"));



CREATE INDEX "operator_invitations_org_emp_idx" ON "public"."operator_invitations" USING "btree" ("organization_id", "empleado_id", "created_at" DESC);



CREATE UNIQUE INDEX "organizations_operator_invitation_code_uidx" ON "public"."organizations" USING "btree" ("upper"("operator_invitation_code")) WHERE ("operator_invitation_code" IS NOT NULL);



CREATE UNIQUE INDEX "productos_sombrilla_org_codigo_idx" ON "public"."productos_sombrilla" USING "btree" ("organization_id", "codigo") WHERE ("codigo" IS NOT NULL);



CREATE UNIQUE INDEX "profiles_empleado_id_unique" ON "public"."profiles" USING "btree" ("empleado_id") WHERE ("empleado_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_material_process_outputs_source_once" ON "public"."material_process_stage_outputs" USING "btree" ("source_output_id") WHERE ("source_output_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_processed_inventory_source_output_once" ON "public"."processed_inventory_lots" USING "btree" ("source_output_id");



CREATE OR REPLACE TRIGGER "orders_updated_at" BEFORE UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."update_orders_updated_at"();



CREATE OR REPLACE TRIGGER "trg_before_insert_material_reception" BEFORE INSERT ON "public"."material_receptions" FOR EACH ROW EXECUTE FUNCTION "public"."before_insert_material_reception"();



CREATE OR REPLACE TRIGGER "trg_before_update_material_reception" BEFORE UPDATE ON "public"."material_receptions" FOR EACH ROW EXECUTE FUNCTION "public"."before_update_material_reception"();



CREATE OR REPLACE TRIGGER "trg_client_addresses_updated_at" BEFORE UPDATE ON "public"."client_addresses" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_clients_updated_at" BEFORE UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_customer_prices_updated_at" BEFORE UPDATE ON "public"."customer_prices" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_employee_biometrics_updated_at" BEFORE UPDATE ON "public"."employee_biometrics" FOR EACH ROW EXECUTE FUNCTION "public"."set_employee_biometrics_updated_at"();



CREATE OR REPLACE TRIGGER "trg_finished_goods_inventory_lots_updated_at" BEFORE UPDATE ON "public"."finished_goods_inventory_lots" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_material_inventory_lots_updated_at" BEFORE UPDATE ON "public"."material_inventory_lots" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_material_process_runs_updated_at" BEFORE UPDATE ON "public"."material_process_runs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_material_receptions_updated_at" BEFORE UPDATE ON "public"."material_receptions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_materials_updated_at" BEFORE UPDATE ON "public"."materials" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_operator_invitation_codes_updated_at" BEFORE UPDATE ON "public"."operator_invitation_codes" FOR EACH ROW EXECUTE FUNCTION "public"."set_operator_invitation_codes_updated_at"();



CREATE OR REPLACE TRIGGER "trg_org_invitations_updated_at" BEFORE UPDATE ON "public"."organization_invitations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_organizations_updated_at" BEFORE UPDATE ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_packaging_inventory_lots_updated_at" BEFORE UPDATE ON "public"."packaging_inventory_lots" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_packing_runs_updated_at" BEFORE UPDATE ON "public"."packing_runs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_processed_inventory_lots_updated_at" BEFORE UPDATE ON "public"."processed_inventory_lots" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_product_base_recipes_updated_at" BEFORE UPDATE ON "public"."product_base_recipes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_product_bases_updated_at" BEFORE UPDATE ON "public"."product_bases" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_product_presentations_updated_at" BEFORE UPDATE ON "public"."product_presentations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_purchase_orders_updated_at" BEFORE UPDATE ON "public"."purchase_orders" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_role_permissions_updated_at" BEFORE UPDATE ON "public"."role_permissions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_skus_updated_at" BEFORE UPDATE ON "public"."skus" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_suppliers_updated_at" BEFORE UPDATE ON "public"."suppliers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_user_roles_updated_at" BEFORE UPDATE ON "public"."user_roles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."anticipos_empleado"
    ADD CONSTRAINT "anticipos_empleado_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."anticipos_empleado"
    ADD CONSTRAINT "anticipos_empleado_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "public"."empleados"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."anticipos_empleado"
    ADD CONSTRAINT "anticipos_empleado_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."anticipos_empleado"
    ADD CONSTRAINT "anticipos_empleado_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "public"."nomina_periodos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cierres_detalle_sku"
    ADD CONSTRAINT "cierres_detalle_sku_cierre_id_fkey" FOREIGN KEY ("cierre_id") REFERENCES "public"."cierres_operativos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cierres_eventos"
    ADD CONSTRAINT "cierres_eventos_cierre_id_fkey" FOREIGN KEY ("cierre_id") REFERENCES "public"."cierres_operativos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cierres_operativos"
    ADD CONSTRAINT "cierres_operativos_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."cierres_operativos"
    ADD CONSTRAINT "cierres_operativos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cierres_operativos"
    ADD CONSTRAINT "cierres_operativos_responsable_cierre_id_fkey" FOREIGN KEY ("responsable_cierre_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."client_addresses"
    ADD CONSTRAINT "client_addresses_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_agreed_prices"
    ADD CONSTRAINT "client_agreed_prices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_agreed_prices"
    ADD CONSTRAINT "client_agreed_prices_origin_quote_id_fkey" FOREIGN KEY ("origin_quote_id") REFERENCES "public"."quotes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_agreed_prices"
    ADD CONSTRAINT "client_agreed_prices_product_presentation_id_fkey" FOREIGN KEY ("product_presentation_id") REFERENCES "public"."product_presentations"("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_salesperson_id_fkey" FOREIGN KEY ("salesperson_id") REFERENCES "public"."salespeople"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conceptos_nomina"
    ADD CONSTRAINT "conceptos_nomina_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."configuracion_jornada"
    ADD CONSTRAINT "configuracion_jornada_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."configuracion_muestreo"
    ADD CONSTRAINT "configuracion_muestreo_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."cost_centers"
    ADD CONSTRAINT "cost_centers_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."cost_centers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_prices"
    ADD CONSTRAINT "customer_prices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_prices"
    ADD CONSTRAINT "customer_prices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_prices"
    ADD CONSTRAINT "customer_prices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_prices"
    ADD CONSTRAINT "customer_prices_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."defectos_inspeccion"
    ADD CONSTRAINT "defectos_inspeccion_inspeccion_id_fkey" FOREIGN KEY ("inspeccion_id") REFERENCES "public"."inspecciones_calidad"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."empleado_salario_historial"
    ADD CONSTRAINT "empleado_salario_historial_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."empleado_salario_historial"
    ADD CONSTRAINT "empleado_salario_historial_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "public"."empleados"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."empleado_salario_historial"
    ADD CONSTRAINT "empleado_salario_historial_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."empleados"
    ADD CONSTRAINT "empleados_centro_costo_id_fkey" FOREIGN KEY ("centro_costo_id") REFERENCES "public"."cost_centers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."empleados"
    ADD CONSTRAINT "empleados_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."empleados"
    ADD CONSTRAINT "empleados_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."empleados"
    ADD CONSTRAINT "empleados_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "public"."sedes_trabajo"("id");



ALTER TABLE ONLY "public"."employee_biometrics"
    ADD CONSTRAINT "employee_biometrics_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "public"."empleados"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_biometrics"
    ADD CONSTRAINT "employee_biometrics_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_source_order_id_fkey" FOREIGN KEY ("source_order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."facturas_exportacion"
    ADD CONSTRAINT "facturas_exportacion_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."facturas_exportacion"
    ADD CONSTRAINT "facturas_exportacion_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."facturas_exportacion_desglose"
    ADD CONSTRAINT "facturas_exportacion_desglose_factura_id_fkey" FOREIGN KEY ("factura_id") REFERENCES "public"."facturas_exportacion"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."facturas_exportacion_desglose"
    ADD CONSTRAINT "facturas_exportacion_desglose_linea_id_fkey" FOREIGN KEY ("linea_id") REFERENCES "public"."facturas_exportacion_lineas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."facturas_exportacion_desglose"
    ADD CONSTRAINT "facturas_exportacion_desglose_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."facturas_exportacion_desglose"
    ADD CONSTRAINT "facturas_exportacion_desglose_product_presentation_id_fkey" FOREIGN KEY ("product_presentation_id") REFERENCES "public"."product_presentations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."facturas_exportacion_lineas"
    ADD CONSTRAINT "facturas_exportacion_lineas_factura_id_fkey" FOREIGN KEY ("factura_id") REFERENCES "public"."facturas_exportacion"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."facturas_exportacion_lineas"
    ADD CONSTRAINT "facturas_exportacion_lineas_producto_sombrilla_id_fkey" FOREIGN KEY ("producto_sombrilla_id") REFERENCES "public"."productos_sombrilla"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."facturas_exportacion"
    ADD CONSTRAINT "facturas_exportacion_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."facturas_exportacion"
    ADD CONSTRAINT "facturas_exportacion_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."finished_goods_inventory_lots"
    ADD CONSTRAINT "finished_goods_inventory_lots_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."finished_goods_inventory_lots"
    ADD CONSTRAINT "finished_goods_inventory_lots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."finished_goods_inventory_lots"
    ADD CONSTRAINT "finished_goods_inventory_lots_packing_run_id_fkey" FOREIGN KEY ("packing_run_id") REFERENCES "public"."packing_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."finished_goods_inventory_lots"
    ADD CONSTRAINT "finished_goods_inventory_lots_product_base_id_fkey" FOREIGN KEY ("product_base_id") REFERENCES "public"."product_bases"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."finished_goods_inventory_lots"
    ADD CONSTRAINT "finished_goods_inventory_lots_product_presentation_id_fkey" FOREIGN KEY ("product_presentation_id") REFERENCES "public"."product_presentations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."finished_inventory_lots"
    ADD CONSTRAINT "finished_inventory_lots_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."finished_inventory_lots"
    ADD CONSTRAINT "finished_inventory_lots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."finished_inventory_lots"
    ADD CONSTRAINT "finished_inventory_lots_packaging_run_id_fkey" FOREIGN KEY ("packaging_run_id") REFERENCES "public"."packaging_runs"("id");



ALTER TABLE ONLY "public"."finished_inventory_lots"
    ADD CONSTRAINT "finished_inventory_lots_product_presentation_id_fkey" FOREIGN KEY ("product_presentation_id") REFERENCES "public"."product_presentations"("id");



ALTER TABLE ONLY "public"."finished_inventory_lots"
    ADD CONSTRAINT "finished_inventory_lots_recall_id_fkey" FOREIGN KEY ("recall_id") REFERENCES "public"."recalls"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."finished_inventory_lots"
    ADD CONSTRAINT "finished_inventory_lots_source_packaging_run_id_fkey" FOREIGN KEY ("source_packaging_run_id") REFERENCES "public"."packaging_runs"("id");



ALTER TABLE ONLY "public"."incapacidades_empleado"
    ADD CONSTRAINT "incapacidades_empleado_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."incapacidades_empleado"
    ADD CONSTRAINT "incapacidades_empleado_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "public"."empleados"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."incapacidades_empleado"
    ADD CONSTRAINT "incapacidades_empleado_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."incapacidades_empleado"
    ADD CONSTRAINT "incapacidades_empleado_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "public"."nomina_periodos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inspecciones_calidad"
    ADD CONSTRAINT "inspecciones_calidad_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."inspecciones_calidad"
    ADD CONSTRAINT "inspecciones_calidad_finished_lot_id_fkey" FOREIGN KEY ("finished_lot_id") REFERENCES "public"."finished_inventory_lots"("id");



ALTER TABLE ONLY "public"."inspecciones_calidad"
    ADD CONSTRAINT "inspecciones_calidad_inspeccionado_por_fkey" FOREIGN KEY ("inspeccionado_por") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."inspecciones_calidad"
    ADD CONSTRAINT "inspecciones_calidad_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."inspecciones_calidad"
    ADD CONSTRAINT "inspecciones_calidad_product_presentation_id_fkey" FOREIGN KEY ("product_presentation_id") REFERENCES "public"."product_presentations"("id");



ALTER TABLE ONLY "public"."journal_entries"
    ADD CONSTRAINT "journal_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."journal_entry_lines"
    ADD CONSTRAINT "journal_entry_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounting_accounts"("id");



ALTER TABLE ONLY "public"."journal_entry_lines"
    ADD CONSTRAINT "journal_entry_lines_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id");



ALTER TABLE ONLY "public"."journal_entry_lines"
    ADD CONSTRAINT "journal_entry_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kpi_costo_laboral_diario"
    ADD CONSTRAINT "kpi_costo_laboral_diario_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."liquidaciones_empleado"
    ADD CONSTRAINT "liquidaciones_empleado_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."liquidaciones_empleado"
    ADD CONSTRAINT "liquidaciones_empleado_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "public"."empleados"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."liquidaciones_empleado"
    ADD CONSTRAINT "liquidaciones_empleado_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."marcaciones"
    ADD CONSTRAINT "marcaciones_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "public"."empleados"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."marcaciones"
    ADD CONSTRAINT "marcaciones_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."marcaciones"
    ADD CONSTRAINT "marcaciones_registrado_por_fkey" FOREIGN KEY ("registrado_por") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."marcaciones"
    ADD CONSTRAINT "marcaciones_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "public"."sedes_trabajo"("id");



ALTER TABLE ONLY "public"."material_inventory_lots"
    ADD CONSTRAINT "material_inventory_lots_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."material_inventory_lots"
    ADD CONSTRAINT "material_inventory_lots_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."material_inventory_lots"
    ADD CONSTRAINT "material_inventory_lots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."material_inventory_lots"
    ADD CONSTRAINT "material_inventory_lots_recall_id_fkey" FOREIGN KEY ("recall_id") REFERENCES "public"."recalls"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."material_inventory_lots"
    ADD CONSTRAINT "material_inventory_lots_reception_id_fkey" FOREIGN KEY ("reception_id") REFERENCES "public"."material_receptions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."material_inventory_lots"
    ADD CONSTRAINT "material_inventory_lots_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."material_price_history"
    ADD CONSTRAINT "material_price_history_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."material_price_history"
    ADD CONSTRAINT "material_price_history_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."material_price_history"
    ADD CONSTRAINT "material_price_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."material_price_history"
    ADD CONSTRAINT "material_price_history_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."material_process_runs"
    ADD CONSTRAINT "material_process_runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."material_process_runs"
    ADD CONSTRAINT "material_process_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."material_process_runs"
    ADD CONSTRAINT "material_process_runs_source_inventory_lot_id_fkey" FOREIGN KEY ("source_inventory_lot_id") REFERENCES "public"."material_inventory_lots"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."material_process_runs"
    ADD CONSTRAINT "material_process_runs_source_material_id_fkey" FOREIGN KEY ("source_material_id") REFERENCES "public"."materials"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."material_process_runs"
    ADD CONSTRAINT "material_process_runs_source_output_id_fkey" FOREIGN KEY ("source_output_id") REFERENCES "public"."material_process_stage_outputs"("id");



ALTER TABLE ONLY "public"."material_process_stage_outputs"
    ADD CONSTRAINT "material_process_stage_outputs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."material_process_stage_outputs"
    ADD CONSTRAINT "material_process_stage_outputs_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."material_process_stage_outputs"
    ADD CONSTRAINT "material_process_stage_outputs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."material_process_stage_outputs"
    ADD CONSTRAINT "material_process_stage_outputs_process_run_id_fkey" FOREIGN KEY ("process_run_id") REFERENCES "public"."material_process_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."material_process_stage_outputs"
    ADD CONSTRAINT "material_process_stage_outputs_source_output_id_fkey" FOREIGN KEY ("source_output_id") REFERENCES "public"."material_process_stage_outputs"("id");



ALTER TABLE ONLY "public"."material_process_stage_outputs"
    ADD CONSTRAINT "material_process_stage_outputs_used_by_run_id_fkey" FOREIGN KEY ("used_by_run_id") REFERENCES "public"."material_process_runs"("id");



ALTER TABLE ONLY "public"."material_receptions"
    ADD CONSTRAINT "material_receptions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."material_receptions"
    ADD CONSTRAINT "material_receptions_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."material_receptions"
    ADD CONSTRAINT "material_receptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."material_receptions"
    ADD CONSTRAINT "material_receptions_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."material_receptions"
    ADD CONSTRAINT "material_receptions_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."material_receptions"
    ADD CONSTRAINT "material_receptions_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."materials"
    ADD CONSTRAINT "materials_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."materials"
    ADD CONSTRAINT "materials_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."materials"
    ADD CONSTRAINT "materials_preferred_supplier_id_fkey" FOREIGN KEY ("preferred_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."nomina_detalle_conceptos"
    ADD CONSTRAINT "nomina_detalle_conceptos_concepto_id_fkey" FOREIGN KEY ("concepto_id") REFERENCES "public"."conceptos_nomina"("id");



ALTER TABLE ONLY "public"."nomina_detalle_conceptos"
    ADD CONSTRAINT "nomina_detalle_conceptos_nomina_detalle_id_fkey" FOREIGN KEY ("nomina_detalle_id") REFERENCES "public"."nomina_detalle"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nomina_detalle_conceptos"
    ADD CONSTRAINT "nomina_detalle_conceptos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nomina_detalle"
    ADD CONSTRAINT "nomina_detalle_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "public"."empleados"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nomina_detalle"
    ADD CONSTRAINT "nomina_detalle_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nomina_detalle"
    ADD CONSTRAINT "nomina_detalle_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "public"."nomina_periodos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nomina_pago_detalle"
    ADD CONSTRAINT "nomina_pago_detalle_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "public"."empleados"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nomina_pago_detalle"
    ADD CONSTRAINT "nomina_pago_detalle_nomina_detalle_id_fkey" FOREIGN KEY ("nomina_detalle_id") REFERENCES "public"."nomina_detalle"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."nomina_pago_detalle"
    ADD CONSTRAINT "nomina_pago_detalle_nomina_pago_id_fkey" FOREIGN KEY ("nomina_pago_id") REFERENCES "public"."nomina_pagos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nomina_pago_detalle"
    ADD CONSTRAINT "nomina_pago_detalle_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nomina_pagos"
    ADD CONSTRAINT "nomina_pagos_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."nomina_pagos"
    ADD CONSTRAINT "nomina_pagos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nomina_pagos"
    ADD CONSTRAINT "nomina_pagos_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "public"."nomina_periodos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nomina_periodos"
    ADD CONSTRAINT "nomina_periodos_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."nomina_periodos"
    ADD CONSTRAINT "nomina_periodos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."operator_invitation_codes"
    ADD CONSTRAINT "operator_invitation_codes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."operator_invitation_codes"
    ADD CONSTRAINT "operator_invitation_codes_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "public"."empleados"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."operator_invitation_codes"
    ADD CONSTRAINT "operator_invitation_codes_used_by_profile_id_fkey" FOREIGN KEY ("used_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."operator_invitations"
    ADD CONSTRAINT "operator_invitations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."operator_invitations"
    ADD CONSTRAINT "operator_invitations_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "public"."empleados"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."operator_invitations"
    ADD CONSTRAINT "operator_invitations_used_by_fkey" FOREIGN KEY ("used_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."order_claims"
    ADD CONSTRAINT "order_claims_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."order_claims"
    ADD CONSTRAINT "order_claims_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_claims"
    ADD CONSTRAINT "order_claims_replacement_order_id_fkey" FOREIGN KEY ("replacement_order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."order_claims"
    ADD CONSTRAINT "order_claims_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."order_deliveries"
    ADD CONSTRAINT "order_deliveries_delivered_by_fkey" FOREIGN KEY ("delivered_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."order_deliveries"
    ADD CONSTRAINT "order_deliveries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_delivery_items"
    ADD CONSTRAINT "order_delivery_items_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "public"."order_deliveries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_delivery_items"
    ADD CONSTRAINT "order_delivery_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_product_presentation_id_fkey" FOREIGN KEY ("product_presentation_id") REFERENCES "public"."product_presentations"("id");



ALTER TABLE ONLY "public"."order_logistics"
    ADD CONSTRAINT "order_logistics_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."order_logistics"
    ADD CONSTRAINT "order_logistics_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_packings"
    ADD CONSTRAINT "order_packings_finished_inventory_lot_id_fkey" FOREIGN KEY ("finished_inventory_lot_id") REFERENCES "public"."finished_inventory_lots"("id");



ALTER TABLE ONLY "public"."order_packings"
    ADD CONSTRAINT "order_packings_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_packings"
    ADD CONSTRAINT "order_packings_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_packings"
    ADD CONSTRAINT "order_packings_packed_by_fkey" FOREIGN KEY ("packed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_replacement_for_order_id_fkey" FOREIGN KEY ("replacement_for_order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."organization_invitations"
    ADD CONSTRAINT "organization_invitations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."organization_invitations"
    ADD CONSTRAINT "organization_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."packaging_inventory_lots"
    ADD CONSTRAINT "packaging_inventory_lots_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."packaging_inventory_lots"
    ADD CONSTRAINT "packaging_inventory_lots_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."packaging_inventory_lots"
    ADD CONSTRAINT "packaging_inventory_lots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."packaging_inventory_lots"
    ADD CONSTRAINT "packaging_inventory_lots_reception_id_fkey" FOREIGN KEY ("reception_id") REFERENCES "public"."material_receptions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."packaging_inventory_lots"
    ADD CONSTRAINT "packaging_inventory_lots_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."packaging_orders"
    ADD CONSTRAINT "packaging_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."packaging_orders"
    ADD CONSTRAINT "packaging_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."packaging_orders"
    ADD CONSTRAINT "packaging_orders_packaging_run_id_fkey" FOREIGN KEY ("packaging_run_id") REFERENCES "public"."packaging_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."packaging_orders"
    ADD CONSTRAINT "packaging_orders_product_presentation_id_fkey" FOREIGN KEY ("product_presentation_id") REFERENCES "public"."product_presentations"("id");



ALTER TABLE ONLY "public"."packaging_run_inputs"
    ADD CONSTRAINT "packaging_run_inputs_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id");



ALTER TABLE ONLY "public"."packaging_run_inputs"
    ADD CONSTRAINT "packaging_run_inputs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."packaging_run_inputs"
    ADD CONSTRAINT "packaging_run_inputs_packaging_run_id_fkey" FOREIGN KEY ("packaging_run_id") REFERENCES "public"."packaging_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."packaging_runs"
    ADD CONSTRAINT "packaging_runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."packaging_runs"
    ADD CONSTRAINT "packaging_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."packaging_runs"
    ADD CONSTRAINT "packaging_runs_product_presentation_id_fkey" FOREIGN KEY ("product_presentation_id") REFERENCES "public"."product_presentations"("id");



ALTER TABLE ONLY "public"."packing_run_inputs"
    ADD CONSTRAINT "packing_run_inputs_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."packing_run_inputs"
    ADD CONSTRAINT "packing_run_inputs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."packing_run_inputs"
    ADD CONSTRAINT "packing_run_inputs_packing_run_id_fkey" FOREIGN KEY ("packing_run_id") REFERENCES "public"."packing_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."packing_run_inputs"
    ADD CONSTRAINT "packing_run_inputs_processed_inventory_lot_id_fkey" FOREIGN KEY ("processed_inventory_lot_id") REFERENCES "public"."processed_inventory_lots"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."packing_runs"
    ADD CONSTRAINT "packing_runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."packing_runs"
    ADD CONSTRAINT "packing_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."packing_runs"
    ADD CONSTRAINT "packing_runs_packaging_material_id_fkey" FOREIGN KEY ("packaging_material_id") REFERENCES "public"."materials"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."packing_runs"
    ADD CONSTRAINT "packing_runs_product_base_id_fkey" FOREIGN KEY ("product_base_id") REFERENCES "public"."product_bases"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."packing_runs"
    ADD CONSTRAINT "packing_runs_product_presentation_id_fkey" FOREIGN KEY ("product_presentation_id") REFERENCES "public"."product_presentations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."parametros_nomina"
    ADD CONSTRAINT "parametros_nomina_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."prestamos_empleado"
    ADD CONSTRAINT "prestamos_empleado_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."prestamos_empleado"
    ADD CONSTRAINT "prestamos_empleado_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "public"."empleados"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."prestamos_empleado_movimientos"
    ADD CONSTRAINT "prestamos_empleado_movimientos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."prestamos_empleado_movimientos"
    ADD CONSTRAINT "prestamos_empleado_movimientos_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "public"."nomina_periodos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."prestamos_empleado_movimientos"
    ADD CONSTRAINT "prestamos_empleado_movimientos_prestamo_id_fkey" FOREIGN KEY ("prestamo_id") REFERENCES "public"."prestamos_empleado"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."prestamos_empleado"
    ADD CONSTRAINT "prestamos_empleado_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."processed_inventory_lots"
    ADD CONSTRAINT "processed_inventory_lots_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."processed_inventory_lots"
    ADD CONSTRAINT "processed_inventory_lots_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."processed_inventory_lots"
    ADD CONSTRAINT "processed_inventory_lots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."processed_inventory_lots"
    ADD CONSTRAINT "processed_inventory_lots_process_run_id_fkey" FOREIGN KEY ("process_run_id") REFERENCES "public"."material_process_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."processed_inventory_lots"
    ADD CONSTRAINT "processed_inventory_lots_source_inventory_lot_id_fkey" FOREIGN KEY ("source_inventory_lot_id") REFERENCES "public"."material_inventory_lots"("id");



ALTER TABLE ONLY "public"."processed_inventory_lots"
    ADD CONSTRAINT "processed_inventory_lots_source_output_id_fkey" FOREIGN KEY ("source_output_id") REFERENCES "public"."material_process_stage_outputs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_base_recipe_history"
    ADD CONSTRAINT "product_base_recipe_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."product_base_recipe_history"
    ADD CONSTRAINT "product_base_recipe_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_base_recipe_history"
    ADD CONSTRAINT "product_base_recipe_history_product_base_id_fkey" FOREIGN KEY ("product_base_id") REFERENCES "public"."product_bases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_base_recipes"
    ADD CONSTRAINT "product_base_recipes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."product_base_recipes"
    ADD CONSTRAINT "product_base_recipes_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."product_base_recipes"
    ADD CONSTRAINT "product_base_recipes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_base_recipes"
    ADD CONSTRAINT "product_base_recipes_product_base_id_fkey" FOREIGN KEY ("product_base_id") REFERENCES "public"."product_bases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_bases"
    ADD CONSTRAINT "product_bases_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."product_bases"
    ADD CONSTRAINT "product_bases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_presentations"
    ADD CONSTRAINT "product_presentations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."product_presentations"
    ADD CONSTRAINT "product_presentations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_presentations"
    ADD CONSTRAINT "product_presentations_packaging_material_id_fkey" FOREIGN KEY ("packaging_material_id") REFERENCES "public"."materials"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."product_presentations"
    ADD CONSTRAINT "product_presentations_product_base_id_fkey" FOREIGN KEY ("product_base_id") REFERENCES "public"."product_bases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_presentations"
    ADD CONSTRAINT "product_presentations_producto_sombrilla_id_fkey" FOREIGN KEY ("producto_sombrilla_id") REFERENCES "public"."productos_sombrilla"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."productos_sombrilla"
    ADD CONSTRAINT "productos_sombrilla_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "public"."empleados"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."prospects"
    ADD CONSTRAINT "prospects_converted_client_id_fkey" FOREIGN KEY ("converted_client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."provisiones_laborales"
    ADD CONSTRAINT "provisiones_laborales_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "public"."empleados"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provisiones_laborales"
    ADD CONSTRAINT "provisiones_laborales_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provisiones_laborales"
    ADD CONSTRAINT "provisiones_laborales_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "public"."nomina_periodos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_order_items"
    ADD CONSTRAINT "purchase_order_items_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_order_items"
    ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."quote_items"
    ADD CONSTRAINT "quote_items_product_presentation_id_fkey" FOREIGN KEY ("product_presentation_id") REFERENCES "public"."product_presentations"("id");



ALTER TABLE ONLY "public"."quote_items"
    ADD CONSTRAINT "quote_items_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_converted_order_id_fkey" FOREIGN KEY ("converted_order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."recalls"
    ADD CONSTRAINT "recalls_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."recalls"
    ADD CONSTRAINT "recalls_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recipe_items"
    ADD CONSTRAINT "recipe_items_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id");



ALTER TABLE ONLY "public"."recipe_items"
    ADD CONSTRAINT "recipe_items_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recipes"
    ADD CONSTRAINT "recipes_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id");



ALTER TABLE ONLY "public"."salespeople"
    ADD CONSTRAINT "salespeople_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."salespeople"
    ADD CONSTRAINT "salespeople_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sedes_trabajo"
    ADD CONSTRAINT "sedes_trabajo_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sku_riesgo_calculado"
    ADD CONSTRAINT "sku_riesgo_calculado_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."sku_riesgo_calculado"
    ADD CONSTRAINT "sku_riesgo_calculado_product_presentation_id_fkey" FOREIGN KEY ("product_presentation_id") REFERENCES "public"."product_presentations"("id");



ALTER TABLE ONLY "public"."skus"
    ADD CONSTRAINT "skus_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."skus"
    ADD CONSTRAINT "skus_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."skus"
    ADD CONSTRAINT "skus_packaging_material_id_fkey" FOREIGN KEY ("packaging_material_id") REFERENCES "public"."materials"("id");



ALTER TABLE ONLY "public"."supplier_accounts_payable"
    ADD CONSTRAINT "supplier_accounts_payable_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."supplier_accounts_payable"
    ADD CONSTRAINT "supplier_accounts_payable_output_id_fkey" FOREIGN KEY ("output_id") REFERENCES "public"."material_process_stage_outputs"("id");



ALTER TABLE ONLY "public"."supplier_accounts_payable"
    ADD CONSTRAINT "supplier_accounts_payable_processed_inventory_lot_id_fkey" FOREIGN KEY ("processed_inventory_lot_id") REFERENCES "public"."processed_inventory_lots"("id");



ALTER TABLE ONLY "public"."supplier_accounts_payable"
    ADD CONSTRAINT "supplier_accounts_payable_source_inventory_lot_id_fkey" FOREIGN KEY ("source_inventory_lot_id") REFERENCES "public"."material_inventory_lots"("id");



ALTER TABLE ONLY "public"."supplier_accounts_payable"
    ADD CONSTRAINT "supplier_accounts_payable_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id");



ALTER TABLE ONLY "public"."supplier_materials"
    ADD CONSTRAINT "supplier_materials_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."supplier_materials"
    ADD CONSTRAINT "supplier_materials_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vacaciones_empleado"
    ADD CONSTRAINT "vacaciones_empleado_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."vacaciones_empleado"
    ADD CONSTRAINT "vacaciones_empleado_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "public"."empleados"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vacaciones_empleado"
    ADD CONSTRAINT "vacaciones_empleado_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vacaciones_empleado"
    ADD CONSTRAINT "vacaciones_empleado_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "public"."nomina_periodos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vacaciones_saldos"
    ADD CONSTRAINT "vacaciones_saldos_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "public"."empleados"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vacaciones_saldos"
    ADD CONSTRAINT "vacaciones_saldos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_logs_same_org_all" ON "public"."audit_logs" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."cierres_detalle_sku" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cierres_eventos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cierres_operativos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_addresses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_addresses_via_client" ON "public"."client_addresses" USING ((EXISTS ( SELECT 1
   FROM "public"."clients" "c"
  WHERE (("c"."id" = "client_addresses"."client_id") AND ("c"."organization_id" = "public"."get_my_profile_org"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."clients" "c"
  WHERE (("c"."id" = "client_addresses"."client_id") AND ("c"."organization_id" = "public"."get_my_profile_org"())))));



ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clients_same_org_all" ON "public"."clients" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."configuracion_jornada" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configuracion_muestreo" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_prices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customer_prices_same_org_all" ON "public"."customer_prices" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."defectos_inspeccion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_biometrics" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "employee_biometrics_delete_same_org" ON "public"."employee_biometrics" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."organization_id" = "employee_biometrics"."organization_id")))));



CREATE POLICY "employee_biometrics_insert_same_org" ON "public"."employee_biometrics" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."organization_id" = "employee_biometrics"."organization_id")))));



CREATE POLICY "employee_biometrics_select_same_org" ON "public"."employee_biometrics" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."organization_id" = "employee_biometrics"."organization_id")))));



CREATE POLICY "employee_biometrics_update_same_org" ON "public"."employee_biometrics" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."organization_id" = "employee_biometrics"."organization_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."organization_id" = "employee_biometrics"."organization_id")))));



ALTER TABLE "public"."facturas_exportacion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."facturas_exportacion_desglose" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."facturas_exportacion_lineas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."finished_goods_inventory_lots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "finished_goods_inventory_lots_same_org_all" ON "public"."finished_goods_inventory_lots" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."inspecciones_calidad" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invitations_same_org_all" ON "public"."organization_invitations" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."kpi_costo_laboral_diario" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."marcaciones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."material_inventory_lots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "material_inventory_lots_same_org_all" ON "public"."material_inventory_lots" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."material_price_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "material_price_history_same_org_all" ON "public"."material_price_history" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."material_process_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "material_process_runs_same_org_all" ON "public"."material_process_runs" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."material_process_stage_outputs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "material_process_stage_outputs_same_org_all" ON "public"."material_process_stage_outputs" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."material_receptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "material_receptions_same_org_all" ON "public"."material_receptions" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."materials" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "materials_same_org_all" ON "public"."materials" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."operator_invitation_codes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "operator_invitation_codes_delete_same_org" ON "public"."operator_invitation_codes" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."organization_id" = "operator_invitation_codes"."organization_id") AND (COALESCE("p"."role", ''::"text") <> 'operario'::"text")))));



CREATE POLICY "operator_invitation_codes_insert_same_org" ON "public"."operator_invitation_codes" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."organization_id" = "operator_invitation_codes"."organization_id") AND (COALESCE("p"."role", ''::"text") <> 'operario'::"text")))));



CREATE POLICY "operator_invitation_codes_select_same_org" ON "public"."operator_invitation_codes" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."organization_id" = "operator_invitation_codes"."organization_id") AND (COALESCE("p"."role", ''::"text") <> 'operario'::"text")))));



CREATE POLICY "operator_invitation_codes_update_same_org" ON "public"."operator_invitation_codes" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."organization_id" = "operator_invitation_codes"."organization_id") AND (COALESCE("p"."role", ''::"text") <> 'operario'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."organization_id" = "operator_invitation_codes"."organization_id") AND (COALESCE("p"."role", ''::"text") <> 'operario'::"text")))));



ALTER TABLE "public"."operator_invitations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "operator_invitations_delete_same_org" ON "public"."operator_invitations" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."organization_id" = "operator_invitations"."organization_id")))));



CREATE POLICY "operator_invitations_insert_same_org" ON "public"."operator_invitations" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."organization_id" = "operator_invitations"."organization_id")))));



CREATE POLICY "operator_invitations_select_same_org" ON "public"."operator_invitations" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."organization_id" = "operator_invitations"."organization_id")))));



CREATE POLICY "operator_invitations_update_same_org" ON "public"."operator_invitations" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."organization_id" = "operator_invitations"."organization_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."organization_id" = "operator_invitations"."organization_id")))));



ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_packings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "org_access" ON "public"."facturas_exportacion" USING (("organization_id" = ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "org_access" ON "public"."facturas_exportacion_desglose" USING (("factura_id" IN ( SELECT "facturas_exportacion"."id"
   FROM "public"."facturas_exportacion"
  WHERE ("facturas_exportacion"."organization_id" = ( SELECT "profiles"."organization_id"
           FROM "public"."profiles"
          WHERE ("profiles"."id" = "auth"."uid"()))))));



CREATE POLICY "org_access" ON "public"."facturas_exportacion_lineas" USING (("factura_id" IN ( SELECT "facturas_exportacion"."id"
   FROM "public"."facturas_exportacion"
  WHERE ("facturas_exportacion"."organization_id" = ( SELECT "profiles"."organization_id"
           FROM "public"."profiles"
          WHERE ("profiles"."id" = "auth"."uid"()))))));



CREATE POLICY "org_access" ON "public"."productos_sombrilla" USING (("organization_id" = ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "org_access" ON "public"."recalls" USING (("organization_id" = ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "org_access_cierres" ON "public"."cierres_operativos" USING (("organization_id" = ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "org_access_cierres_eventos" ON "public"."cierres_eventos" USING (("organization_id" = ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "org_access_cierres_sku" ON "public"."cierres_detalle_sku" USING (("organization_id" = ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "org_access_jornada" ON "public"."configuracion_jornada" USING (("organization_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "org_access_kpi_costo" ON "public"."kpi_costo_laboral_diario" USING (("organization_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "org_access_marcaciones" ON "public"."marcaciones" USING (("organization_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "org_access_sedes" ON "public"."sedes_trabajo" USING (("organization_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "org_configuracion_muestreo" ON "public"."configuracion_muestreo" USING (("organization_id" = ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "org_defectos_inspeccion" ON "public"."defectos_inspeccion" USING ((EXISTS ( SELECT 1
   FROM "public"."inspecciones_calidad" "ic"
  WHERE (("ic"."id" = "defectos_inspeccion"."inspeccion_id") AND ("ic"."organization_id" = ( SELECT "profiles"."organization_id"
           FROM "public"."profiles"
          WHERE ("profiles"."id" = "auth"."uid"())))))));



CREATE POLICY "org_inspecciones_calidad" ON "public"."inspecciones_calidad" USING (("organization_id" = ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "org_order_items" ON "public"."order_items" USING (("order_id" IN ( SELECT "orders"."id"
   FROM "public"."orders"
  WHERE ("orders"."organization_id" = ( SELECT "profiles"."organization_id"
           FROM "public"."profiles"
          WHERE ("profiles"."id" = "auth"."uid"()))))));



CREATE POLICY "org_order_items_insert" ON "public"."order_items" FOR INSERT WITH CHECK (("order_id" IN ( SELECT "orders"."id"
   FROM "public"."orders"
  WHERE ("orders"."organization_id" = ( SELECT "profiles"."organization_id"
           FROM "public"."profiles"
          WHERE ("profiles"."id" = "auth"."uid"()))))));



CREATE POLICY "org_order_items_update" ON "public"."order_items" FOR UPDATE USING (("order_id" IN ( SELECT "orders"."id"
   FROM "public"."orders"
  WHERE ("orders"."organization_id" = ( SELECT "profiles"."organization_id"
           FROM "public"."profiles"
          WHERE ("profiles"."id" = "auth"."uid"()))))));



CREATE POLICY "org_order_packings" ON "public"."order_packings" USING (("order_id" IN ( SELECT "orders"."id"
   FROM "public"."orders"
  WHERE ("orders"."organization_id" = ( SELECT "profiles"."organization_id"
           FROM "public"."profiles"
          WHERE ("profiles"."id" = "auth"."uid"()))))));



CREATE POLICY "org_order_packings_insert" ON "public"."order_packings" FOR INSERT WITH CHECK (("order_id" IN ( SELECT "orders"."id"
   FROM "public"."orders"
  WHERE ("orders"."organization_id" = ( SELECT "profiles"."organization_id"
           FROM "public"."profiles"
          WHERE ("profiles"."id" = "auth"."uid"()))))));



CREATE POLICY "org_orders" ON "public"."orders" USING (("organization_id" = ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "org_orders_insert" ON "public"."orders" FOR INSERT WITH CHECK (("organization_id" = ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "org_orders_update" ON "public"."orders" FOR UPDATE USING (("organization_id" = ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "org_select_own" ON "public"."organizations" FOR SELECT USING (("id" = "public"."get_my_profile_org"()));



CREATE POLICY "org_sku_riesgo_calculado" ON "public"."sku_riesgo_calculado" USING (("organization_id" = ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "org_update_own" ON "public"."organizations" FOR UPDATE USING (("id" = "public"."get_my_profile_org"())) WITH CHECK (("id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."organization_invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."packaging_inventory_lots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "packaging_inventory_lots_same_org_all" ON "public"."packaging_inventory_lots" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."packaging_orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "packaging_orders_org_access" ON "public"."packaging_orders" USING (("organization_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



ALTER TABLE "public"."packing_run_inputs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "packing_run_inputs_same_org_all" ON "public"."packing_run_inputs" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."packing_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "packing_runs_same_org_all" ON "public"."packing_runs" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."processed_inventory_lots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "processed_inventory_lots_same_org_all" ON "public"."processed_inventory_lots" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."product_base_recipe_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_base_recipe_history_same_org_all" ON "public"."product_base_recipe_history" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."product_base_recipes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_base_recipes_same_org_all" ON "public"."product_base_recipes" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."product_bases" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_bases_same_org_all" ON "public"."product_bases" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."product_presentations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_presentations_same_org_all" ON "public"."product_presentations" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."productos_sombrilla" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_insert_self" ON "public"."profiles" FOR INSERT WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "profiles_select_same_org" ON "public"."profiles" FOR SELECT USING (("organization_id" = "public"."get_my_profile_org"()));



CREATE POLICY "profiles_update_self_or_admin" ON "public"."profiles" FOR UPDATE USING ((("id" = "auth"."uid"()) OR "public"."is_admin_user"())) WITH CHECK ((("id" = "auth"."uid"()) OR "public"."is_admin_user"()));



ALTER TABLE "public"."purchase_order_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "purchase_order_items_via_po" ON "public"."purchase_order_items" USING ((EXISTS ( SELECT 1
   FROM "public"."purchase_orders" "po"
  WHERE (("po"."id" = "purchase_order_items"."purchase_order_id") AND ("po"."organization_id" = "public"."get_my_profile_org"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."purchase_orders" "po"
  WHERE (("po"."id" = "purchase_order_items"."purchase_order_id") AND ("po"."organization_id" = "public"."get_my_profile_org"())))));



ALTER TABLE "public"."purchase_orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "purchase_orders_same_org_all" ON "public"."purchase_orders" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."recalls" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "role_permissions_read_all_auth" ON "public"."role_permissions" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."sedes_trabajo" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sku_riesgo_calculado" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."skus" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "skus_same_org_all" ON "public"."skus" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."supplier_materials" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "supplier_materials_via_supplier" ON "public"."supplier_materials" USING ((EXISTS ( SELECT 1
   FROM "public"."suppliers" "s"
  WHERE (("s"."id" = "supplier_materials"."supplier_id") AND ("s"."organization_id" = "public"."get_my_profile_org"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."suppliers" "s"
  WHERE (("s"."id" = "supplier_materials"."supplier_id") AND ("s"."organization_id" = "public"."get_my_profile_org"())))));



ALTER TABLE "public"."suppliers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "suppliers_same_org_all" ON "public"."suppliers" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));



ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_roles_same_org_all" ON "public"."user_roles" USING (("organization_id" = "public"."get_my_profile_org"())) WITH CHECK (("organization_id" = "public"."get_my_profile_org"()));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."accounting_accounts";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."anticipos_empleado";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."audit_logs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."cierres_detalle_sku";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."cierres_eventos";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."cierres_operativos";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."client_addresses";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."client_agreed_prices";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."clients";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."conceptos_nomina";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."configuracion_jornada";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."configuracion_muestreo";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."cost_centers";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."customer_prices";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."defectos_inspeccion";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."empleado_salario_historial";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."empleados";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."expenses";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."facturas_exportacion";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."facturas_exportacion_desglose";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."facturas_exportacion_lineas";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."finished_goods_inventory_lots";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."finished_inventory_lots";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."incapacidades_empleado";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."inspecciones_calidad";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."journal_entries";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."journal_entry_lines";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."kpi_costo_laboral_diario";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."liquidaciones_empleado";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."marcaciones";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."material_inventory_lots";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."material_price_history";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."material_process_runs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."material_process_stage_outputs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."material_receptions";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."materials";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."nomina_detalle";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."nomina_detalle_conceptos";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."nomina_pago_detalle";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."nomina_pagos";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."nomina_periodos";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."order_claims";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."order_deliveries";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."order_delivery_items";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."order_items";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."order_logistics";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."order_packings";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."orders";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."organization_invitations";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."organizations";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."packaging_inventory_lots";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."packaging_orders";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."packaging_run_inputs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."packaging_runs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."packing_run_inputs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."packing_runs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."parametros_nomina";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."prestamos_empleado";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."prestamos_empleado_movimientos";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."processed_inventory_lots";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."product_base_recipe_history";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."product_base_recipes";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."product_bases";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."product_presentations";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."productos_sombrilla";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."profiles";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."prospects";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."provisiones_laborales";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."purchase_order_items";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."purchase_orders";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."quote_items";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."quotes";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."recalls";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."recipe_items";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."recipes";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."role_permissions";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."salespeople";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."sedes_trabajo";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."sku_riesgo_calculado";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."skus";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."supplier_accounts_payable";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."supplier_materials";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."suppliers";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."user_roles";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."vacaciones_empleado";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."vacaciones_saldos";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."before_insert_material_reception"() TO "anon";
GRANT ALL ON FUNCTION "public"."before_insert_material_reception"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."before_insert_material_reception"() TO "service_role";



GRANT ALL ON FUNCTION "public"."before_update_material_reception"() TO "anon";
GRANT ALL ON FUNCTION "public"."before_update_material_reception"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."before_update_material_reception"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calcular_merma_fn"() TO "anon";
GRANT ALL ON FUNCTION "public"."calcular_merma_fn"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calcular_merma_fn"() TO "service_role";



GRANT ALL ON FUNCTION "public"."complete_admin_onboarding"("p_org_name" "text", "p_full_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."complete_admin_onboarding"("p_org_name" "text", "p_full_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_admin_onboarding"("p_org_name" "text", "p_full_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."complete_invited_onboarding"("p_invitation_code" "text", "p_full_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."complete_invited_onboarding"("p_invitation_code" "text", "p_full_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_invited_onboarding"("p_invitation_code" "text", "p_full_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."complete_operator_onboarding"("p_invitation_code" "text", "p_full_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."complete_operator_onboarding"("p_invitation_code" "text", "p_full_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_operator_onboarding"("p_invitation_code" "text", "p_full_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_operator_invitation"("p_empleado_id" "uuid", "p_expires_in_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."create_operator_invitation"("p_empleado_id" "uuid", "p_expires_in_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_operator_invitation"("p_empleado_id" "uuid", "p_expires_in_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."employee_has_active_biometric"("p_empleado_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."employee_has_active_biometric"("p_empleado_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."employee_has_active_biometric"("p_empleado_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_employee_code"("p_organization_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_employee_code"("p_organization_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_employee_code"("p_organization_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_finished_goods_lot"("p_presentation_code" "text", "p_packing_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_finished_goods_lot"("p_presentation_code" "text", "p_packing_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_finished_goods_lot"("p_presentation_code" "text", "p_packing_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_invitation_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_invitation_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_invitation_code"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_material_reception_lot"("p_organization_id" "uuid", "p_material_id" "uuid", "p_received_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_material_reception_lot"("p_organization_id" "uuid", "p_material_id" "uuid", "p_received_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_material_reception_lot"("p_organization_id" "uuid", "p_material_id" "uuid", "p_received_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_operator_invite_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_operator_invite_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_operator_invite_code"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_organization_operator_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_organization_operator_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_organization_operator_code"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_product_base_code"("p_organization_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_product_base_code"("p_organization_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_product_base_code"("p_organization_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_product_presentation_code"("p_organization_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_product_presentation_code"("p_organization_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_product_presentation_code"("p_organization_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_purchase_order_number"("p_organization_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_purchase_order_number"("p_organization_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_purchase_order_number"("p_organization_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_quote_number"("p_organization_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_quote_number"("p_organization_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_quote_number"("p_organization_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_sku_code"("p_organization_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_sku_code"("p_organization_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_sku_code"("p_organization_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_profile_org"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_profile_org"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_profile_org"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_profile_org"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_admin_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."release_material_reception"("p_reception_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."release_material_reception"("p_reception_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."release_material_reception"("p_reception_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_employee_biometrics_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_employee_biometrics_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_employee_biometrics_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_operator_invitation_codes_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_operator_invitation_codes_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_operator_invitation_codes_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_orders_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_orders_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_orders_updated_at"() TO "service_role";


















GRANT ALL ON TABLE "public"."accounting_accounts" TO "anon";
GRANT ALL ON TABLE "public"."accounting_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."accounting_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."anticipos_empleado" TO "anon";
GRANT ALL ON TABLE "public"."anticipos_empleado" TO "authenticated";
GRANT ALL ON TABLE "public"."anticipos_empleado" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."cierres_detalle_sku" TO "anon";
GRANT ALL ON TABLE "public"."cierres_detalle_sku" TO "authenticated";
GRANT ALL ON TABLE "public"."cierres_detalle_sku" TO "service_role";



GRANT ALL ON TABLE "public"."cierres_eventos" TO "anon";
GRANT ALL ON TABLE "public"."cierres_eventos" TO "authenticated";
GRANT ALL ON TABLE "public"."cierres_eventos" TO "service_role";



GRANT ALL ON TABLE "public"."cierres_operativos" TO "anon";
GRANT ALL ON TABLE "public"."cierres_operativos" TO "authenticated";
GRANT ALL ON TABLE "public"."cierres_operativos" TO "service_role";



GRANT ALL ON TABLE "public"."client_addresses" TO "anon";
GRANT ALL ON TABLE "public"."client_addresses" TO "authenticated";
GRANT ALL ON TABLE "public"."client_addresses" TO "service_role";



GRANT ALL ON TABLE "public"."client_agreed_prices" TO "anon";
GRANT ALL ON TABLE "public"."client_agreed_prices" TO "authenticated";
GRANT ALL ON TABLE "public"."client_agreed_prices" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."conceptos_nomina" TO "anon";
GRANT ALL ON TABLE "public"."conceptos_nomina" TO "authenticated";
GRANT ALL ON TABLE "public"."conceptos_nomina" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_jornada" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_jornada" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_jornada" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_muestreo" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_muestreo" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_muestreo" TO "service_role";



GRANT ALL ON TABLE "public"."cost_centers" TO "anon";
GRANT ALL ON TABLE "public"."cost_centers" TO "authenticated";
GRANT ALL ON TABLE "public"."cost_centers" TO "service_role";



GRANT ALL ON TABLE "public"."customer_prices" TO "anon";
GRANT ALL ON TABLE "public"."customer_prices" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_prices" TO "service_role";



GRANT ALL ON TABLE "public"."defectos_inspeccion" TO "anon";
GRANT ALL ON TABLE "public"."defectos_inspeccion" TO "authenticated";
GRANT ALL ON TABLE "public"."defectos_inspeccion" TO "service_role";



GRANT ALL ON TABLE "public"."empleado_salario_historial" TO "anon";
GRANT ALL ON TABLE "public"."empleado_salario_historial" TO "authenticated";
GRANT ALL ON TABLE "public"."empleado_salario_historial" TO "service_role";



GRANT ALL ON TABLE "public"."empleados" TO "anon";
GRANT ALL ON TABLE "public"."empleados" TO "authenticated";
GRANT ALL ON TABLE "public"."empleados" TO "service_role";



GRANT ALL ON TABLE "public"."employee_biometrics" TO "anon";
GRANT ALL ON TABLE "public"."employee_biometrics" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_biometrics" TO "service_role";



GRANT ALL ON TABLE "public"."expenses" TO "anon";
GRANT ALL ON TABLE "public"."expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."expenses" TO "service_role";



GRANT ALL ON TABLE "public"."facturas_exportacion" TO "anon";
GRANT ALL ON TABLE "public"."facturas_exportacion" TO "authenticated";
GRANT ALL ON TABLE "public"."facturas_exportacion" TO "service_role";



GRANT ALL ON TABLE "public"."facturas_exportacion_desglose" TO "anon";
GRANT ALL ON TABLE "public"."facturas_exportacion_desglose" TO "authenticated";
GRANT ALL ON TABLE "public"."facturas_exportacion_desglose" TO "service_role";



GRANT ALL ON TABLE "public"."facturas_exportacion_lineas" TO "anon";
GRANT ALL ON TABLE "public"."facturas_exportacion_lineas" TO "authenticated";
GRANT ALL ON TABLE "public"."facturas_exportacion_lineas" TO "service_role";



GRANT ALL ON TABLE "public"."finished_goods_inventory_lots" TO "anon";
GRANT ALL ON TABLE "public"."finished_goods_inventory_lots" TO "authenticated";
GRANT ALL ON TABLE "public"."finished_goods_inventory_lots" TO "service_role";



GRANT ALL ON TABLE "public"."finished_inventory_lots" TO "anon";
GRANT ALL ON TABLE "public"."finished_inventory_lots" TO "authenticated";
GRANT ALL ON TABLE "public"."finished_inventory_lots" TO "service_role";



GRANT ALL ON TABLE "public"."incapacidades_empleado" TO "anon";
GRANT ALL ON TABLE "public"."incapacidades_empleado" TO "authenticated";
GRANT ALL ON TABLE "public"."incapacidades_empleado" TO "service_role";



GRANT ALL ON TABLE "public"."inspecciones_calidad" TO "anon";
GRANT ALL ON TABLE "public"."inspecciones_calidad" TO "authenticated";
GRANT ALL ON TABLE "public"."inspecciones_calidad" TO "service_role";



GRANT ALL ON TABLE "public"."journal_entries" TO "anon";
GRANT ALL ON TABLE "public"."journal_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."journal_entries" TO "service_role";



GRANT ALL ON SEQUENCE "public"."journal_entries_entry_number_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."journal_entries_entry_number_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."journal_entries_entry_number_seq" TO "service_role";



GRANT ALL ON TABLE "public"."journal_entry_lines" TO "anon";
GRANT ALL ON TABLE "public"."journal_entry_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."journal_entry_lines" TO "service_role";



GRANT ALL ON TABLE "public"."kpi_costo_laboral_diario" TO "anon";
GRANT ALL ON TABLE "public"."kpi_costo_laboral_diario" TO "authenticated";
GRANT ALL ON TABLE "public"."kpi_costo_laboral_diario" TO "service_role";



GRANT ALL ON TABLE "public"."liquidaciones_empleado" TO "anon";
GRANT ALL ON TABLE "public"."liquidaciones_empleado" TO "authenticated";
GRANT ALL ON TABLE "public"."liquidaciones_empleado" TO "service_role";



GRANT ALL ON TABLE "public"."marcaciones" TO "anon";
GRANT ALL ON TABLE "public"."marcaciones" TO "authenticated";
GRANT ALL ON TABLE "public"."marcaciones" TO "service_role";



GRANT ALL ON TABLE "public"."material_inventory_lots" TO "anon";
GRANT ALL ON TABLE "public"."material_inventory_lots" TO "authenticated";
GRANT ALL ON TABLE "public"."material_inventory_lots" TO "service_role";



GRANT ALL ON TABLE "public"."material_price_history" TO "anon";
GRANT ALL ON TABLE "public"."material_price_history" TO "authenticated";
GRANT ALL ON TABLE "public"."material_price_history" TO "service_role";



GRANT ALL ON TABLE "public"."material_process_runs" TO "anon";
GRANT ALL ON TABLE "public"."material_process_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."material_process_runs" TO "service_role";



GRANT ALL ON TABLE "public"."material_process_stage_outputs" TO "anon";
GRANT ALL ON TABLE "public"."material_process_stage_outputs" TO "authenticated";
GRANT ALL ON TABLE "public"."material_process_stage_outputs" TO "service_role";



GRANT ALL ON TABLE "public"."material_receptions" TO "anon";
GRANT ALL ON TABLE "public"."material_receptions" TO "authenticated";
GRANT ALL ON TABLE "public"."material_receptions" TO "service_role";



GRANT ALL ON TABLE "public"."materials" TO "anon";
GRANT ALL ON TABLE "public"."materials" TO "authenticated";
GRANT ALL ON TABLE "public"."materials" TO "service_role";



GRANT ALL ON TABLE "public"."nomina_detalle" TO "anon";
GRANT ALL ON TABLE "public"."nomina_detalle" TO "authenticated";
GRANT ALL ON TABLE "public"."nomina_detalle" TO "service_role";



GRANT ALL ON TABLE "public"."nomina_detalle_conceptos" TO "anon";
GRANT ALL ON TABLE "public"."nomina_detalle_conceptos" TO "authenticated";
GRANT ALL ON TABLE "public"."nomina_detalle_conceptos" TO "service_role";



GRANT ALL ON TABLE "public"."nomina_pago_detalle" TO "anon";
GRANT ALL ON TABLE "public"."nomina_pago_detalle" TO "authenticated";
GRANT ALL ON TABLE "public"."nomina_pago_detalle" TO "service_role";



GRANT ALL ON TABLE "public"."nomina_pagos" TO "anon";
GRANT ALL ON TABLE "public"."nomina_pagos" TO "authenticated";
GRANT ALL ON TABLE "public"."nomina_pagos" TO "service_role";



GRANT ALL ON TABLE "public"."nomina_periodos" TO "anon";
GRANT ALL ON TABLE "public"."nomina_periodos" TO "authenticated";
GRANT ALL ON TABLE "public"."nomina_periodos" TO "service_role";



GRANT ALL ON TABLE "public"."operator_invitation_codes" TO "anon";
GRANT ALL ON TABLE "public"."operator_invitation_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."operator_invitation_codes" TO "service_role";



GRANT ALL ON TABLE "public"."operator_invitations" TO "anon";
GRANT ALL ON TABLE "public"."operator_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."operator_invitations" TO "service_role";



GRANT ALL ON TABLE "public"."order_claims" TO "anon";
GRANT ALL ON TABLE "public"."order_claims" TO "authenticated";
GRANT ALL ON TABLE "public"."order_claims" TO "service_role";



GRANT ALL ON TABLE "public"."order_deliveries" TO "anon";
GRANT ALL ON TABLE "public"."order_deliveries" TO "authenticated";
GRANT ALL ON TABLE "public"."order_deliveries" TO "service_role";



GRANT ALL ON TABLE "public"."order_delivery_items" TO "anon";
GRANT ALL ON TABLE "public"."order_delivery_items" TO "authenticated";
GRANT ALL ON TABLE "public"."order_delivery_items" TO "service_role";



GRANT ALL ON TABLE "public"."order_items" TO "anon";
GRANT ALL ON TABLE "public"."order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."order_items" TO "service_role";



GRANT ALL ON TABLE "public"."order_logistics" TO "anon";
GRANT ALL ON TABLE "public"."order_logistics" TO "authenticated";
GRANT ALL ON TABLE "public"."order_logistics" TO "service_role";



GRANT ALL ON TABLE "public"."order_packings" TO "anon";
GRANT ALL ON TABLE "public"."order_packings" TO "authenticated";
GRANT ALL ON TABLE "public"."order_packings" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON SEQUENCE "public"."orders_order_number_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."orders_order_number_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."orders_order_number_seq" TO "service_role";



GRANT ALL ON TABLE "public"."organization_invitations" TO "anon";
GRANT ALL ON TABLE "public"."organization_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_invitations" TO "service_role";



GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT ALL ON TABLE "public"."packaging_inventory_lots" TO "anon";
GRANT ALL ON TABLE "public"."packaging_inventory_lots" TO "authenticated";
GRANT ALL ON TABLE "public"."packaging_inventory_lots" TO "service_role";



GRANT ALL ON TABLE "public"."packaging_orders" TO "anon";
GRANT ALL ON TABLE "public"."packaging_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."packaging_orders" TO "service_role";



GRANT ALL ON TABLE "public"."packaging_run_inputs" TO "anon";
GRANT ALL ON TABLE "public"."packaging_run_inputs" TO "authenticated";
GRANT ALL ON TABLE "public"."packaging_run_inputs" TO "service_role";



GRANT ALL ON TABLE "public"."packaging_runs" TO "anon";
GRANT ALL ON TABLE "public"."packaging_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."packaging_runs" TO "service_role";



GRANT ALL ON TABLE "public"."packing_run_inputs" TO "anon";
GRANT ALL ON TABLE "public"."packing_run_inputs" TO "authenticated";
GRANT ALL ON TABLE "public"."packing_run_inputs" TO "service_role";



GRANT ALL ON TABLE "public"."packing_runs" TO "anon";
GRANT ALL ON TABLE "public"."packing_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."packing_runs" TO "service_role";



GRANT ALL ON TABLE "public"."parametros_nomina" TO "anon";
GRANT ALL ON TABLE "public"."parametros_nomina" TO "authenticated";
GRANT ALL ON TABLE "public"."parametros_nomina" TO "service_role";



GRANT ALL ON TABLE "public"."prestamos_empleado" TO "anon";
GRANT ALL ON TABLE "public"."prestamos_empleado" TO "authenticated";
GRANT ALL ON TABLE "public"."prestamos_empleado" TO "service_role";



GRANT ALL ON TABLE "public"."prestamos_empleado_movimientos" TO "anon";
GRANT ALL ON TABLE "public"."prestamos_empleado_movimientos" TO "authenticated";
GRANT ALL ON TABLE "public"."prestamos_empleado_movimientos" TO "service_role";



GRANT ALL ON TABLE "public"."processed_inventory_lots" TO "anon";
GRANT ALL ON TABLE "public"."processed_inventory_lots" TO "authenticated";
GRANT ALL ON TABLE "public"."processed_inventory_lots" TO "service_role";



GRANT ALL ON TABLE "public"."product_base_recipe_history" TO "anon";
GRANT ALL ON TABLE "public"."product_base_recipe_history" TO "authenticated";
GRANT ALL ON TABLE "public"."product_base_recipe_history" TO "service_role";



GRANT ALL ON TABLE "public"."product_base_recipes" TO "anon";
GRANT ALL ON TABLE "public"."product_base_recipes" TO "authenticated";
GRANT ALL ON TABLE "public"."product_base_recipes" TO "service_role";



GRANT ALL ON TABLE "public"."product_bases" TO "anon";
GRANT ALL ON TABLE "public"."product_bases" TO "authenticated";
GRANT ALL ON TABLE "public"."product_bases" TO "service_role";



GRANT ALL ON TABLE "public"."product_presentations" TO "anon";
GRANT ALL ON TABLE "public"."product_presentations" TO "authenticated";
GRANT ALL ON TABLE "public"."product_presentations" TO "service_role";



GRANT ALL ON TABLE "public"."productos_sombrilla" TO "anon";
GRANT ALL ON TABLE "public"."productos_sombrilla" TO "authenticated";
GRANT ALL ON TABLE "public"."productos_sombrilla" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."prospects" TO "anon";
GRANT ALL ON TABLE "public"."prospects" TO "authenticated";
GRANT ALL ON TABLE "public"."prospects" TO "service_role";



GRANT ALL ON TABLE "public"."provisiones_laborales" TO "anon";
GRANT ALL ON TABLE "public"."provisiones_laborales" TO "authenticated";
GRANT ALL ON TABLE "public"."provisiones_laborales" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_order_items" TO "anon";
GRANT ALL ON TABLE "public"."purchase_order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_order_items" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_orders" TO "anon";
GRANT ALL ON TABLE "public"."purchase_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_orders" TO "service_role";



GRANT ALL ON TABLE "public"."quote_items" TO "anon";
GRANT ALL ON TABLE "public"."quote_items" TO "authenticated";
GRANT ALL ON TABLE "public"."quote_items" TO "service_role";



GRANT ALL ON TABLE "public"."quotes" TO "anon";
GRANT ALL ON TABLE "public"."quotes" TO "authenticated";
GRANT ALL ON TABLE "public"."quotes" TO "service_role";



GRANT ALL ON TABLE "public"."recalls" TO "anon";
GRANT ALL ON TABLE "public"."recalls" TO "authenticated";
GRANT ALL ON TABLE "public"."recalls" TO "service_role";



GRANT ALL ON TABLE "public"."recipe_items" TO "anon";
GRANT ALL ON TABLE "public"."recipe_items" TO "authenticated";
GRANT ALL ON TABLE "public"."recipe_items" TO "service_role";



GRANT ALL ON TABLE "public"."recipes" TO "anon";
GRANT ALL ON TABLE "public"."recipes" TO "authenticated";
GRANT ALL ON TABLE "public"."recipes" TO "service_role";



GRANT ALL ON TABLE "public"."role_permissions" TO "anon";
GRANT ALL ON TABLE "public"."role_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."role_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."salespeople" TO "anon";
GRANT ALL ON TABLE "public"."salespeople" TO "authenticated";
GRANT ALL ON TABLE "public"."salespeople" TO "service_role";



GRANT ALL ON TABLE "public"."sedes_trabajo" TO "anon";
GRANT ALL ON TABLE "public"."sedes_trabajo" TO "authenticated";
GRANT ALL ON TABLE "public"."sedes_trabajo" TO "service_role";



GRANT ALL ON TABLE "public"."sku_riesgo_calculado" TO "anon";
GRANT ALL ON TABLE "public"."sku_riesgo_calculado" TO "authenticated";
GRANT ALL ON TABLE "public"."sku_riesgo_calculado" TO "service_role";



GRANT ALL ON TABLE "public"."skus" TO "anon";
GRANT ALL ON TABLE "public"."skus" TO "authenticated";
GRANT ALL ON TABLE "public"."skus" TO "service_role";



GRANT ALL ON TABLE "public"."supplier_accounts_payable" TO "anon";
GRANT ALL ON TABLE "public"."supplier_accounts_payable" TO "authenticated";
GRANT ALL ON TABLE "public"."supplier_accounts_payable" TO "service_role";



GRANT ALL ON TABLE "public"."supplier_materials" TO "anon";
GRANT ALL ON TABLE "public"."supplier_materials" TO "authenticated";
GRANT ALL ON TABLE "public"."supplier_materials" TO "service_role";



GRANT ALL ON TABLE "public"."suppliers" TO "anon";
GRANT ALL ON TABLE "public"."suppliers" TO "authenticated";
GRANT ALL ON TABLE "public"."suppliers" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."v_costo_laboral_diario" TO "anon";
GRANT ALL ON TABLE "public"."v_costo_laboral_diario" TO "authenticated";
GRANT ALL ON TABLE "public"."v_costo_laboral_diario" TO "service_role";



GRANT ALL ON TABLE "public"."v_produccion_diaria" TO "anon";
GRANT ALL ON TABLE "public"."v_produccion_diaria" TO "authenticated";
GRANT ALL ON TABLE "public"."v_produccion_diaria" TO "service_role";



GRANT ALL ON TABLE "public"."v_reclamos_calidad_sku" TO "anon";
GRANT ALL ON TABLE "public"."v_reclamos_calidad_sku" TO "authenticated";
GRANT ALL ON TABLE "public"."v_reclamos_calidad_sku" TO "service_role";



GRANT ALL ON TABLE "public"."vacaciones_empleado" TO "anon";
GRANT ALL ON TABLE "public"."vacaciones_empleado" TO "authenticated";
GRANT ALL ON TABLE "public"."vacaciones_empleado" TO "service_role";



GRANT ALL ON TABLE "public"."vacaciones_saldos" TO "anon";
GRANT ALL ON TABLE "public"."vacaciones_saldos" TO "authenticated";
GRANT ALL ON TABLE "public"."vacaciones_saldos" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


  create policy "Auth users can upload delivery photos"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'delivery-photos'::text));



  create policy "Delivery photos are public"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'delivery-photos'::text));



  create policy "allow_auth_read_marcaciones"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using ((bucket_id = 'marcaciones-fotos'::text));



  create policy "allow_auth_update_marcaciones"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using ((bucket_id = 'marcaciones-fotos'::text));



  create policy "allow_auth_upload_marcaciones"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'marcaciones-fotos'::text));



