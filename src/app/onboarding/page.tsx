import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getHouseholds } from "@/lib/household";
import { createHouseholdAction, acceptInviteAction } from "./actions";
import { FormMessage } from "@/components/form-message";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string; invite?: string }> }) {
  await requireUser();
  const households = await getHouseholds();
  const params = await searchParams;
  if (households.length && !params.invite) redirect("/app");
  return (
    <main className="onboarding-shell">
      <div className="onboarding-card">
        <div className="brand"><span className="brand-mark">S</span><span>Stapli</span></div>
        <p className="eyebrow">One small setup</p>
        <h1>Who are you shopping for?</h1>
        <p className="lead">A household keeps your lists, purchase history and predictions private to the people you invite.</p>
        <FormMessage error={params.error} />
        <form action={createHouseholdAction} className="form-stack">
          <label>Household name<input name="name" required placeholder="The Fry household" autoFocus /></label>
          <button className="button button--primary button--wide" type="submit">Create household</button>
        </form>
        <div className="divider"><span>or join one</span></div>
        <form action={acceptInviteAction} className="inline-form">
          <input name="token" defaultValue={params.invite} placeholder="Invite code" aria-label="Invite code" />
          <button className="button button--secondary" type="submit">Join</button>
        </form>
      </div>
    </main>
  );
}
