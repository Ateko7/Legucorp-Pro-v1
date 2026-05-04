-- Seed a COST_PLUS rule. Percentages are decimal fractions: 0.18 = 18%.
insert into public.transfer_pricing_rules (
  organization_id,
  product_sku,
  method,
  min_margin_pct,
  target_margin_pct,
  max_margin_pct,
  market_reference_price,
  currency,
  valid_from
) values (
  public.get_my_profile_org(),
  'SKU-CHILE-001',
  'COST_PLUS',
  0.12,
  0.18,
  0.25,
  16.00,
  'GTQ',
  current_date
);

-- Create a GT dispatch event. In production p_dispatch_id is the real dispatch/order UUID.
select public.create_intercompany_dispatch_event(
  '11111111-1111-4111-8111-111111111111'::uuid,
  '{
    "currency": "GTQ",
    "freight_cost": 350.00,
    "insurance_cost": 75.00,
    "invoice_data": {
      "fel_document_id": "22222222-2222-4222-8222-222222222222",
      "tipo_documento": "FACT"
    },
    "items": [
      {
        "sku": "SKU-CHILE-001",
        "description": "Chile jalapeno 12 oz",
        "qty": 120,
        "unit_cost": 12.5,
        "lots": [
          { "lot_id": "GT-LOT-2026-00045", "lot_code": "GT-LOT-2026-00045", "qty": 80, "expiry_date": "2026-10-31" },
          { "lot_id": "GT-LOT-2026-00046", "lot_code": "GT-LOT-2026-00046", "qty": 40, "expiry_date": "2026-11-15" }
        ]
      }
    ]
  }'::jsonb,
  'GT',
  'SV',
  public.get_my_profile_org()
);
