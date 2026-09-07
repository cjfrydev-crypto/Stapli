const DEFAULT_SUPABASE_URL = "https://dyacfwcpaahcubcwxrwh.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rTz5D19V1v9DxpuAlsraGA_7e0wFf-O";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY;

export const SUPABASE_CONFIG_SOURCE = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ? "environment" : "built-in fallback",
  publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ? "environment" : "built-in fallback",
} as const;
