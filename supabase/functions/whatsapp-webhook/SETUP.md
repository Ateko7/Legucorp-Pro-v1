# Configuración: WhatsApp Business → Pedidos

## Variables de entorno (Supabase Edge Function Secrets)

Configura estos secrets en Supabase Dashboard → Edge Functions → Manage Secrets:

| Variable | Descripción |
|---|---|
| `ANTHROPIC_API_KEY` | API key de Anthropic (también usada por `analyze-order`) |
| `WHATSAPP_TOKEN` | Token permanente del System User de Meta (Business Manager) |
| `WHATSAPP_VERIFY_TOKEN` | Token arbitrario que tú inventas para verificar el webhook (ej. `legucorp_verify`) |
| `WHATSAPP_PHONE_ID` | Phone Number ID de tu número de WhatsApp Business (en Meta for Developers) |
| `ORGANIZATION_ID` | UUID de tu organización en Supabase (tabla `organizations`) |

## Pasos de configuración

### 1. Deploy de la función
```bash
supabase functions deploy whatsapp-webhook --no-verify-jwt
supabase functions deploy analyze-order
```

### 2. Configurar secrets
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set WHATSAPP_TOKEN=EAAxxxx...
supabase secrets set WHATSAPP_VERIFY_TOKEN=legucorp_verify
supabase secrets set WHATSAPP_PHONE_ID=123456789
supabase secrets set ORGANIZATION_ID=tu-uuid-aqui
```

### 3. Registrar el webhook en Meta for Developers

1. Ve a https://developers.facebook.com → tu app → WhatsApp → Configuration
2. En "Webhook URL" pon: `https://<tu-proyecto>.supabase.co/functions/v1/whatsapp-webhook`
3. En "Verify token" pon el mismo valor de `WHATSAPP_VERIFY_TOKEN`
4. Suscríbete al evento: `messages`
5. Haz clic en "Verify and Save"

### 4. Obtener tu Organization ID

Ejecuta en Supabase SQL Editor:
```sql
SELECT id, name FROM organizations LIMIT 10;
```

## Flujo de funcionamiento

1. Cliente envía WhatsApp con una lista de productos y cantidades
2. Meta llama al webhook con el mensaje
3. La función busca al cliente por su número de teléfono
4. Claude (Haiku) analiza el mensaje y detecta si es un pedido
5. Si es pedido, crea el registro en `orders` + `order_items`
6. Se responde automáticamente al cliente con confirmación + número de pedido
7. El pedido aparece en la página de Pedidos con badge "whatsapp"

## Nota sobre permisos de la tabla orders

Si tienes RLS activo, la Edge Function usa el `SERVICE_ROLE_KEY` que bypasea RLS.
Asegúrate de que `SUPABASE_SERVICE_ROLE_KEY` esté disponible (Supabase lo inyecta automáticamente en Edge Functions).
