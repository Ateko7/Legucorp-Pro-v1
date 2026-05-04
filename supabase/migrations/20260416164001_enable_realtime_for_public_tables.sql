-- Enable Supabase Realtime for every public application table.
-- Internal schemas (auth/storage/realtime/vault/etc.) are intentionally excluded.

do $$
declare
  v_table record;
begin
  for v_table in
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not exists (
        select 1
        from pg_publication_tables pt
        where pt.pubname = 'supabase_realtime'
          and pt.schemaname = 'public'
          and pt.tablename = c.relname
      )
    order by c.relname
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', v_table.table_name);
    exception
      when duplicate_object then
        null;
    end;
  end loop;
end $$;
