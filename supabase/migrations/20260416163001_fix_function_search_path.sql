-- Supabase security advisor: fix Function Search Path Mutable warnings.
-- Pin public functions to a deterministic search_path so object resolution does
-- not depend on the caller role/session.

alter function public.calcular_merma_fn() set search_path = public, extensions;
alter function public.employee_has_active_biometric(uuid) set search_path = public, extensions;
alter function public.generate_employee_code(uuid) set search_path = public, extensions;
alter function public.generate_intercompany_transaction_code(text, text) set search_path = public, extensions;
alter function public.generate_invitation_code() set search_path = public, extensions;
alter function public.generate_operator_invite_code() set search_path = public, extensions;
alter function public.generate_organization_operator_code() set search_path = public, extensions;
alter function public.generate_quote_number(uuid) set search_path = public, extensions;
alter function public.handle_new_user() set search_path = public, extensions;
alter function public.set_employee_biometrics_updated_at() set search_path = public, extensions;
alter function public.set_operator_invitation_codes_updated_at() set search_path = public, extensions;
alter function public.set_updated_at() set search_path = public, extensions;
alter function public.trg_touch_updated_at() set search_path = public, extensions;
alter function public.trg_tp_snapshot_immutable() set search_path = public, extensions;
alter function public.update_orders_updated_at() set search_path = public, extensions;
