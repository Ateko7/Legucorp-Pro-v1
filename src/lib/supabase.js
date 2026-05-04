import { createClient } from '@supabase/supabase-js';

// Leemos la URL y anon key publica del archivo .env local.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Exportamos la conexion para usarla en todo el ERP.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
