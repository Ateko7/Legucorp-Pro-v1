update public.quality_spec_rules
set
  unit = '°C',
  min_value = 3,
  max_value = 6,
  updated_at = now()
where code in ('temp_recepcion', 'temperatura_proceso');
