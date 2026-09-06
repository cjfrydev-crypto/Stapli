import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { FormMessage } from "@/components/form-message";
import { signUp } from "@/app/auth/actions";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const params = await searchParams;
  return (
    <AuthCard
      eyebrow="Create your household"
      title="A shopping list that learns."
      intro="Stapli remembers what you buy, how much, and when it usually comes round again."
      footer={<p>Already have an account? <Link href="/auth/sign-in">Sign in</Link></p>}
    >
      <FormMessage error={params.error} message={params.message} />
      <form action={signUp} className="form-stack">
        <label>Your name<input name="displayName" autoComplete="name" required placeholder="Connor" /></label>
        <label>Email<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" /></label>
        <label>Password<input name="password" type="password" autoComplete="new-password" minLength={8} required /><small>At least 8 characters</small></label>
        <button className="button button--primary button--wide" type="submit">Create account</button>
      </form>
    </AuthCard>
  );
}
