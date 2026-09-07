"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function withMessage(path: string, key: string, message: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${key}=${encodeURIComponent(message)}`;
}

function safeNext(raw: string, fallback: string) {
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback;
}

export async function signIn(formData: FormData) {
  const email = value(formData, "email").toLowerCase();
  const password = value(formData, "password");
  const next = safeNext(value(formData, "next"), "/app");
  const retryPath = next === "/app" ? "/auth/sign-in" : `/auth/sign-in?next=${encodeURIComponent(next)}`;
  if (!email || !password) redirect(withMessage(retryPath, "error", "Enter your email and password."));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(withMessage(retryPath, "error", error.message));

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signUp(formData: FormData) {
  const displayName = value(formData, "displayName");
  const email = value(formData, "email").toLowerCase();
  const password = value(formData, "password");

  if (!displayName || !email || password.length < 8) {
    redirect(withMessage("/auth/sign-up", "error", "Use your name, a valid email, and a password of at least 8 characters."));
  }

  const origin = (await headers()).get("origin") ?? "http://localhost:3000";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
      emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
    },
  });

  if (error) redirect(withMessage("/auth/sign-up", "error", error.message));
  if (data.session) redirect("/onboarding");
  redirect(withMessage("/auth/sign-up", "message", "Check your email to confirm your account."));
}

export async function requestPasswordReset(formData: FormData) {
  const email = value(formData, "email").toLowerCase();
  if (!email) redirect(withMessage("/auth/forgot-password", "error", "Enter your email address."));

  const origin = (await headers()).get("origin") ?? "http://localhost:3000";
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/auth/update-password`,
  });

  if (error) redirect(withMessage("/auth/forgot-password", "error", error.message));
  redirect(withMessage("/auth/forgot-password", "message", "If that account exists, a reset link is on its way."));
}

export async function updatePassword(formData: FormData) {
  const password = value(formData, "password");
  if (password.length < 8) redirect(withMessage("/auth/update-password", "error", "Use at least 8 characters."));

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect(withMessage("/auth/update-password", "error", error.message));

  redirect(withMessage("/app/settings", "message", "Password updated."));
}
