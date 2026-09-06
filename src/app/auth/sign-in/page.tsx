import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { FormMessage } from "@/components/form-message";
import { signIn } from "@/app/auth/actions";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const params = await searchParams;
  return (
    <AuthCard
      eyebrow="Welcome back"
      title="Your next shop is waiting."
      intro="Sign in to your household and pick up exactly where you left off."
      footer={<p>New to Stapli? <Link href="/auth/sign-up">Create an account</Link></p>}
    >
      <FormMessage error={params.error} message={params.message} />
      <form action={signIn} className="form-stack">
        <label>Email<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        <div className="form-row form-row--between"><span /><Link href="/auth/forgot-password" className="text-link">Forgot password?</Link></div>
        <button className="button button--primary button--wide" type="submit">Sign in</button>
      </form>
    </AuthCard>
  );
}
