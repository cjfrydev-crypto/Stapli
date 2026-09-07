import { NextResponse } from "next/server";
import {
  SUPABASE_CONFIG_SOURCE,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "@/lib/supabase/config";

export async function GET() {
  let supabaseHost: string | null = null;

  try {
    supabaseHost = new URL(SUPABASE_URL).host;
  } catch {
    supabaseHost = "invalid-url";
  }

  return NextResponse.json(
    {
      status: "ok",
      service: "stapli",
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      config: {
        supabaseUrlConfigured: Boolean(SUPABASE_URL),
        supabasePublishableKeyConfigured: Boolean(SUPABASE_PUBLISHABLE_KEY),
        supabaseHost,
        source: SUPABASE_CONFIG_SOURCE,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
