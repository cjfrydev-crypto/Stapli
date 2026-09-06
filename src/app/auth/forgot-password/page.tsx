import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { FormMessage } from "@/components/form-message";
import { requestPasswordReset } from "@/app/auth/actions";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const params = await searchParams;
  return (
    <AuthCard title="Reset your password" intro="We’ll send a secure reset link to your email." footer={<Link href="/auth/sign-in">Back to sign in</Link>}>
      <FormMessage error={params.error} message={params.message} />
      <form action={requestPasswordReset} className="form-stack">
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <button className="button button--primary button--wide" type="submit">Send reset link</button>
      </form>
    </AuthCard>
  );
}
