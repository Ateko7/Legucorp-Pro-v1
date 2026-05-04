-- Supabase security advisor: public buckets should not expose broad object listing.
-- Public object URLs keep working for these buckets; this only removes SELECT/list
-- access through the Storage API.

drop policy if exists "Delivery photos are public" on storage.objects;
drop policy if exists "allow_auth_read_marcaciones" on storage.objects;
drop policy if exists "bank_transfer_receipts_select_public" on storage.objects;
drop policy if exists "cash_box_documents_select_public" on storage.objects;
drop policy if exists "collection_receipts_select_public" on storage.objects;
drop policy if exists "expense_documents_select_public" on storage.objects;
drop policy if exists "logistics_route_documents_select_public" on storage.objects;
drop policy if exists "supplier_invoices_select_public" on storage.objects;
drop policy if exists "supplier_payment_receipts_select_public" on storage.objects;
