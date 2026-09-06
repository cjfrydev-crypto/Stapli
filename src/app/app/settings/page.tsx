import Link from "next/link";
import { headers } from "next/headers";
import { getUser } from "@/lib/auth";
import { getHouseholds, requireHousehold } from "@/lib/household";
import { createClient } from "@/lib/supabase/server";
import { FormMessage } from "@/components/form-message";
import { createHouseholdInviteAction } from "./actions";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string; invite?: string }> }) {
  const [user, households, household, params] = await Promise.all([getUser(), getHouseholds(), requireHousehold(), searchParams]);
  const supabase = await createClient();
  const { count: memberCount } = await supabase.from("household_members").select("user_id", { count: "exact", head: true }).eq("household_id", household.id);
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const inviteLink = params.invite ? `${protocol}://${host}/onboarding?invite=${params.invite}` : null;
  return (
    <div className="page-stack">
      <section className="page-heading"><p className="eyebrow">Settings</p><h1>Household & data</h1><p>Keep the app boring where it should be: clear ownership, clear privacy, easy imports and real account controls.</p></section>
      <FormMessage error={params.error} message={params.message} />
      {inviteLink ? <div className="invite-success"><strong>Invite created</strong><p>Send this private link to the person you want to join:</p><code>{inviteLink}</code></div> : null}
      <section className="settings-card">
        <div className="settings-row"><div><strong>Account</strong><span>{user?.email}</span></div><Link href="/auth/update-password" className="text-link">Change password</Link></div>
        <div className="settings-row"><div><strong>Household</strong><span>{household.name} · {memberCount ?? 1} member{memberCount === 1 ? "" : "s"}</span></div><span className="subtle-badge">{households.find((h) => h.id === household.id)?.role ?? "member"}</span></div>
        <div className="settings-row settings-row--stack"><div><strong>Invite someone</strong><span>They’ll use their own Stapli login and share only this household’s shopping data.</span></div><form action={createHouseholdInviteAction} className="invite-form"><input type="email" name="email" placeholder="Optional: lock invite to their email" /><button className="button button--secondary button--small">Create invite</button></form></div>
        <div className="settings-row"><div><strong>Purchase history</strong><span>Bootstrap Stapli from retailer exports.</span></div><Link href="/app/import" className="button button--secondary button--small">Import</Link></div>
        <div className="settings-row"><div><strong>ChatGPT</strong><span>The data model keeps exact articles, trip state and purchase events separate so a plugin can reason over them cleanly.</span></div><span className="subtle-badge">API next</span></div>
      </section>
      <form action="/auth/signout" method="post"><button className="button button--danger" type="submit">Sign out</button></form>
    </div>
  );
}
