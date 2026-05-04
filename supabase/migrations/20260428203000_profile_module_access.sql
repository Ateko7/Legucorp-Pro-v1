alter table public.profiles
  add column if not exists erp_access_mode text not null default 'full'
    check (erp_access_mode in ('full', 'limited')),
  add column if not exists erp_allowed_modules text[] not null default '{}';

update public.profiles
set
  erp_access_mode = coalesce(erp_access_mode, 'full'),
  erp_allowed_modules = coalesce(erp_allowed_modules, '{}')
where erp_access_mode is null
   or erp_allowed_modules is null;
