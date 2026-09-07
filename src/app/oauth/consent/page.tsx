import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AuthorizationDetails = {
  authorization_id?: string;
  redirect_url?: string;
  redirect_uri?: string;
  scope?: string;
  client?: { name?: string };
};

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>;
}) {
  const params = await searchParams;
  const authorizationId = params.authorization_id;

  if (!authorizationId) {
    return (
      <main className="onboarding-shell">
        <div className="onboarding-card">
          <div className="brand"><span className="brand-mark">S</span><span>Stapli</span></div>
          <p className="eyebrow">AI connection</p>
          <h1>That authorization request is incomplete.</h1>
          <p className="lead">Return to ChatGPT and connect Stapli again.</p>
        </div>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims) {
    const next = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
    redirect(`/auth/sign-in?next=${encodeURIComponent(next)}`);
  }

  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) {
    return (
      <main className="onboarding-shell">
        <div className="onboarding-card">
          <div className="brand"><span className="brand-mark">S</span><span>Stapli</span></div>
          <p className="eyebrow">AI connection</p>
          <h1>We couldn’t verify this request.</h1>
          <p className="lead">{error?.message ?? "The authorization request may have expired. Return to ChatGPT and try connecting Stapli again."}</p>
        </div>
      </main>
    );
  }

  const details = data as unknown as AuthorizationDetails;
  if (!details.authorization_id && details.redirect_url) redirect(details.redirect_url);

  const requestedScopes = details.scope?.split(" ").filter(Boolean) ?? [];

  return (
    <main className="onboarding-shell">
      <div className="onboarding-card">
        <div className="brand"><span className="brand-mark">S</span><span>Stapli</span></div>
        <p className="eyebrow">Connect your AI</p>
        <h1>Allow {details.client?.name ?? "this AI app"} to use Stapli?</h1>
        <p className="lead">
          It will be able to read and update the shopping data that your Stapli account can access, using the same household permissions as you.
        </p>

        <div className="settings-section">
          <h2>What this enables</h2>
          <ul>
            <li>Read your current shopping lists and known products.</li>
            <li>Read purchase history to help you reason about shopping patterns.</li>
            <li>Add, update and remove list items when you ask.</li>
            <li>Read and save standing household shopping instructions.</li>
          </ul>
          {requestedScopes.length > 0 ? <p className="muted">Identity permissions requested: {requestedScopes.join(", ")}</p> : null}
        </div>

        <p className="muted">You can revoke the connection later. Stapli’s row-level security continues to restrict access to households you belong to.</p>

        <form action="/api/oauth/decision" method="post" className="form-stack">
          <input type="hidden" name="authorization_id" value={authorizationId} />
          <button className="button button--primary button--wide" type="submit" name="decision" value="approve">Allow access</button>
          <button className="button button--secondary button--wide" type="submit" name="decision" value="deny">Deny</button>
        </form>
      </div>
    </main>
  );
}
