alter table public.bank_accounts
  add column if not exists opening_balance numeric not null default 0,
  add column if not exists opening_balance_date date not null default current_date;

update public.bank_accounts
set opening_balance = coalesce(opening_balance, 0),
    opening_balance_date = coalesce(opening_balance_date, current_date)
where opening_balance is null
   or opening_balance_date is null;
