import { AuthCard } from "@/components/auth-card";
import { FormMessage } from "@/components/form-message";
import { updatePassword } from "@/app/auth/actions";

export default async function UpdatePasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  return (
    <AuthCard title="Choose a new password" intro="Use a password you don’t use elsewhere.">
      <FormMessage error={params.error} />
      <form action={updatePassword} className="form-stack">
        <label>New password<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
        <button className="button button--primary button--wide" type="submit">Update password</button>
      </form>
    </AuthCard>
  );
}
