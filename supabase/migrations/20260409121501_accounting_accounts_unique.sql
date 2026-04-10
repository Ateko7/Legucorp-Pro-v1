create temporary table tmp_accounting_account_dedup_map on commit drop as
with ranked_accounts as (
  select
    id,
    organization_id,
    code,
    first_value(id) over (
      partition by organization_id, code
      order by created_at asc nulls last, id asc
    ) as keep_id,
    row_number() over (
      partition by organization_id, code
      order by created_at asc nulls last, id asc
    ) as rn
  from public.accounting_accounts
)
select id as duplicate_id, keep_id
from ranked_accounts
where rn > 1
  and id <> keep_id;

update public.journal_entry_lines jel
set account_id = m.keep_id
from tmp_accounting_account_dedup_map m
where jel.account_id = m.duplicate_id;

update public.bank_accounts ba
set accounting_account_id = m.keep_id
from tmp_accounting_account_dedup_map m
where ba.accounting_account_id = m.duplicate_id;

update public.cash_boxes cb
set accounting_account_id = m.keep_id
from tmp_accounting_account_dedup_map m
where cb.accounting_account_id = m.duplicate_id;

update public.accounting_accounts aa
set parent_id = m.keep_id
from tmp_accounting_account_dedup_map m
where aa.parent_id = m.duplicate_id;

delete from public.accounting_accounts a
using tmp_accounting_account_dedup_map m
where a.id = m.duplicate_id;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'accounting_accounts_org_code_key'
  ) then
    alter table public.accounting_accounts
      add constraint accounting_accounts_org_code_key
      unique (organization_id, code);
  end if;
end
$$;
