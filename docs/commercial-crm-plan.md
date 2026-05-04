# Refuerzo CRM Comercial para Legucorp Pro

## Objetivo

Reforzar el módulo comercial existente sin rehacerlo. La estrategia es reutilizar:

- `clients` como maestro de clientes
- `prospects` como base de prospectos
- `quotes` como cotizaciones
- `orders` como ventas/pedidos
- `sales_budgets` como presupuesto comercial
- `salespeople` como responsables/vendedores
- `claims`, `cash_flow`, `route cost`, `expenses` y tablas contables como insumos de riesgo y rentabilidad

## Alcance por fases

### Fase 1

- Dashboard Comercial básico
- Prospectos
- Seguimientos
- Navegación comercial nueva
- Configuración mínima para catálogos y reglas

### Fase 2

- Rentabilidad por cliente
- Ranking, detalle y matriz volumen vs margen
- Snapshots de rentabilidad para acelerar consultas

### Fase 3

- Inteligencia comercial
- Alertas automáticas
- Recomendaciones por cliente

### Fase 4

- Configuración comercial ampliada
- Permisos finos por rol
- Automatizaciones avanzadas

## Decisiones clave

1. No duplicar clientes ni cotizaciones.
2. Extender `prospects` en lugar de reemplazarlo.
3. Crear tablas CRM nuevas solo para:
   - seguimientos
   - alertas
   - catálogos y settings
   - snapshots de rentabilidad
   - segmentación y recomendaciones
4. Permitir fallback con datos mock mientras se aplica la migración.
5. Mantener la UI alineada con el estilo actual de Legucorp Pro.

## Tablas nuevas / adaptadas

- Adaptada: `prospects`
- Nueva: `crm_followups`
- Nueva: `crm_commercial_alerts`
- Nueva: `crm_commercial_settings`
- Nueva: `crm_commercial_catalogs`
- Nueva: `crm_customer_profitability_snapshots`
- Nueva: `crm_customer_profitability_details`
- Nueva: `crm_customer_segments`
- Nueva: `crm_customer_recommendations`

## Integraciones

- Clientes: `clients`
- Prospectos: `prospects`
- Cotizaciones: `quotes`, `quote_items`
- Ventas: `orders`, `order_items`
- Presupuesto: `sales_budgets`
- CxC: órdenes y flujo de caja/cobros
- Reclamos: `claims` y/o servicios financieros de reclamos
- Logística: tablas de costeo de rutas
- Vendedores: `salespeople`

## Riesgos controlados

- La migración es incremental y no invalida el flujo actual de cotizaciones.
- El frontend nuevo puede vivir con mocks si las tablas CRM aún no están desplegadas.
- La rentabilidad avanzada se apoya en snapshots para no sobrecargar consultas operativas.
