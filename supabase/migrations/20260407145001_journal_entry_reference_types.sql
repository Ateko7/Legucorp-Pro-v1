alter table public.journal_entries
  drop constraint if exists journal_entries_reference_type_check;

alter table public.journal_entries
  add constraint journal_entries_reference_type_check
  check (
    reference_type = any (
      array[
        'venta'::text,
        'compra'::text,
        'ajuste'::text,
        'gasto'::text,
        'otro'::text,
        'cxp_factura'::text,
        'comision'::text,
        'transferencia_bancaria'::text
      ]
    )
  );
