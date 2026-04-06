import { createClient } from '@supabase/supabase-js';

// Leemos las llaves secretas de tu archivo .env
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Exportamos la conexión para usarla en todo el ERP
export const supabase = createClient(supabaseUrl, supabaseAnonKey);