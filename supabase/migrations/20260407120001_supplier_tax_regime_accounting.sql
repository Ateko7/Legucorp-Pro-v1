alter table public.suppliers
  add column if not exists tax_regime text
  check (tax_regime in ('pequeno_contribuyente', 'pagos_trimestrales', 'sujeto_a_retencion'));

update public.suppliers
set tax_regime = coalesce(nullif(tax_regime, ''), 'pagos_trimestrales')
where coalesce(tax_regime, '') = '';

alter table public.supplier_accounts_payable
  add column if not exists invoice_tax_regime text
  check (invoice_tax_regime in ('pequeno_contribuyente', 'pagos_trimestrales', 'sujeto_a_retencion')),
  add column if not exists invoice_subtotal_amount numeric default 0,
  add column if not exists invoice_iva_rate numeric default 0,
  add column if not exists invoice_iva_amount numeric default 0,
  add column if not exists invoice_total_amount numeric default 0,
  add column if not exists withholding_rate numeric default 0,
  add column if not exists withholding_amount numeric default 0,
  add column if not exists net_payable_amount numeric default 0,
  add column if not exists invoice_journal_entry_id uuid;

update public.supplier_accounts_payable
set invoice_subtotal_amount = coalesce(invoice_subtotal_amount, payable_amount, 0),
    invoice_iva_rate = coalesce(invoice_iva_rate, 0),
    invoice_iva_amount = coalesce(invoice_iva_amount, 0),
    invoice_total_amount = coalesce(invoice_total_amount, payable_amount, 0),
    withholding_rate = coalesce(withholding_rate, 0),
    withholding_amount = coalesce(withholding_amount, 0),
    net_payable_amount = coalesce(net_payable_amount, payable_amount, 0)
where invoice_subtotal_amount is null
   or invoice_iva_rate is null
   or invoice_iva_amount is null
   or invoice_total_amount is null
   or withholding_rate is null
   or withholding_amount is null
   or net_payable_amount is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'supplier_accounts_payable_invoice_journal_entry_id_fkey'
  ) then
    alter table public.supplier_accounts_payable
      add constraint supplier_accounts_payable_invoice_journal_entry_id_fkey
      foreign key (invoice_journal_entry_id) references public.journal_entries(id);
  end if;
end $$;

create index if not exists idx_suppliers_tax_regime
  on public.suppliers (organization_id, tax_regime);

create index if not exists idx_supplier_accounts_payable_invoice_journal_entry
  on public.supplier_accounts_payable (invoice_journal_entry_id);
