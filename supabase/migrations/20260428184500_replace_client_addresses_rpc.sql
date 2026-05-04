create or replace function public.replace_client_addresses(
  p_client_id uuid,
  p_addresses jsonb default '[]'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_org uuid;
  v_client_org uuid;
  v_item jsonb;
begin
  select public.get_my_profile_org() into v_profile_org;

  select organization_id
    into v_client_org
    from public.clients
   where id = p_client_id;

  if v_client_org is null then
    raise exception 'Cliente no encontrado';
  end if;

  if v_profile_org is distinct from v_client_org then
    raise exception 'No autorizado para actualizar direcciones de este cliente';
  end if;

  delete from public.client_addresses
   where client_id = p_client_id;

  for v_item in
    select value
      from jsonb_array_elements(coalesce(p_addresses, '[]'::jsonb))
  loop
    if coalesce(trim(v_item ->> 'address_line'), '') <> '' then
      insert into public.client_addresses (
        client_id,
        address_label,
        address_line,
        is_default
      ) values (
        p_client_id,
        nullif(trim(v_item ->> 'address_label'), ''),
        trim(v_item ->> 'address_line'),
        coalesce((v_item ->> 'is_default')::boolean, false)
      );
    end if;
  end loop;
end;
$$;

grant execute on function public.replace_client_addresses(uuid, jsonb) to authenticated;
grant execute on function public.replace_client_addresses(uuid, jsonb) to service_role;
