import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

const PUBLIC_PATHS = new Set([
  "/",
  "/auth/sign-in",
  "/auth/sign-up",
  "/auth/forgot-password",
  "/api/health",
  "/mcp",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
]);

export async function proxy(request: NextRequest) {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
