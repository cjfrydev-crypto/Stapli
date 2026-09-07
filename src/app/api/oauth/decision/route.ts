import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const formData = await request.formData();
  const authorizationId = String(formData.get("authorization_id") ?? "").trim();
  const decision = String(formData.get("decision") ?? "").trim();

  if (!authorizationId || !["approve", "deny"].includes(decision)) {
    return NextResponse.json({ error: "Invalid authorization decision." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims) {
    const next = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
    return NextResponse.redirect(new URL(`/auth/sign-in?next=${encodeURIComponent(next)}`, request.url), 303);
  }

  const result = decision === "approve"
    ? await supabase.auth.oauth.approveAuthorization(authorizationId)
    : await supabase.auth.oauth.denyAuthorization(authorizationId);

  if (result.error || !result.data?.redirect_url) {
    return NextResponse.json(
      { error: result.error?.message ?? "Supabase did not return an OAuth redirect URL." },
      { status: 400 },
    );
  }

  return NextResponse.redirect(result.data.redirect_url, 303);
}
