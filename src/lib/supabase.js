import { createClient } from '@supabase/supabase-js';

// Leemos la URL y anon key publica del archivo .env local.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const missingSupabaseConfig = [];

if (!supabaseUrl) missingSupabaseConfig.push('VITE_SUPABASE_URL');
if (!supabaseAnonKey) missingSupabaseConfig.push('VITE_SUPABASE_ANON_KEY');

if (missingSupabaseConfig.length > 0) {
  const message = `Missing required Supabase env vars: ${missingSupabaseConfig.join(', ')}.`;

  if (typeof document !== 'undefined') {
    const root = document.getElementById('root');

    if (root) {
      root.innerHTML = `
        <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#f5efe6;color:#402d1f;font-family:system-ui,sans-serif;">
          <div style="max-width:720px;background:#fffaf3;border:1px solid #d7c3aa;border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(64,45,31,0.08);">
            <h1 style="margin:0 0 12px;font-size:24px;">Configuracion incompleta de Supabase</h1>
            <p style="margin:0 0 12px;line-height:1.5;">
              La aplicacion no puede iniciar porque faltan variables de entorno en este despliegue.
            </p>
            <p style="margin:0;line-height:1.5;"><strong>Faltan:</strong> ${missingSupabaseConfig.join(', ')}</p>
          </div>
        </div>
      `;
    }
  }

  throw new Error(message);
}

// Exportamos la conexion para usarla en todo el ERP.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
