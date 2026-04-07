create or replace function public.complete_operator_onboarding(
  p_invitation_code text,
  p_full_name text default null
)
returns table (
  profile_id uuid,
  organization_id uuid,
  empleado_id uuid,
  role text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_org public.organizations%rowtype;
  v_existing_profile public.profiles%rowtype;
  v_empleado_id uuid;
  v_full_name text;
  v_codigo_empleado text;
  v_nombres text;
  v_apellidos text;
  v_auth_email text;
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

  if v_existing_profile.id is not null
     and v_existing_profile.organization_id = v_org.id
     and v_existing_profile.role = 'operario'
     and v_existing_profile.empleado_id is not null then
    return query
    select
      v_existing_profile.id,
      v_existing_profile.organization_id,
      v_existing_profile.empleado_id,
      v_existing_profile.role;
    return;
  end if;

  if v_existing_profile.id is not null
     and v_existing_profile.organization_id is not null
     and v_existing_profile.organization_id <> v_org.id then
    raise exception 'Este usuario ya está vinculado a otra organización';
  end if;

  select u.email
  into v_auth_email
  from auth.users u
  where u.id = v_user_id;

  v_full_name := nullif(trim(p_full_name), '');
  v_full_name := coalesce(v_full_name, v_existing_profile.full_name, 'Operario');
  v_nombres := trim(split_part(v_full_name, ' ', 1));
  v_apellidos := trim(substr(v_full_name, length(v_nombres) + 1));
  v_apellidos := nullif(v_apellidos, '');
  v_apellidos := coalesce(v_apellidos, 'Operario');
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
    v_nombres,
    v_apellidos,
    current_date,
    'Operario',
    'Operaciones',
    'indefinido',
    'quincenal',
    'operario',
    0,
    250,
    true,
    v_auth_email,
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
  where public.employee_biometrics.empleado_id = v_empleado_id
    and public.employee_biometrics.biometric_type = 'face'
    and public.employee_biometrics.profile_id is distinct from v_user_id;

  return query
  select
    v_user_id,
    v_org.id,
    v_empleado_id,
    'operario'::text;
end;
$$;

create or replace function public.create_operator_invitation(
  p_empleado_id uuid,
  p_expires_in_days integer default 14
)
returns table (
  invite_code text,
  expires_at timestamptz,
  empleado_id uuid,
  organization_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
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
  where public.operator_invitations.empleado_id = p_empleado_id
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
