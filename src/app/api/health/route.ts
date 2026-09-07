import { NextResponse } from "next/server";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let supabaseHost: string | null = null;

  if (supabaseUrl) {
    try {
      supabaseHost = new URL(supabaseUrl).host;
    } catch {
      supabaseHost = "invalid-url";
    }
  }

  return NextResponse.json(
    {
      status: "ok",
      service: "stapli",
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      config: {
        supabaseUrlConfigured: Boolean(supabaseUrl),
        supabasePublishableKeyConfigured: Boolean(supabaseKey),
        supabaseHost,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
