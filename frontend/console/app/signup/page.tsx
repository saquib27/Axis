"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, session } from "../../lib/api";
import { SignInPage } from "../../components/ui/sign-in.tsx";
import { AxisWorkflow } from "../../components/ui/axis-workflow.tsx";

export default function Signup() {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Already signed in? Go straight to the console — asking someone to sign in
  // when they already have a session is just a wall in front of their data.
  const [checking, setChecking] = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (session.token()) router.replace("/projects");
    else setChecking(false);
  }, [router]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    setErr(null);
    setBusy(true);
    try {
      session.save(await api.signup(email, password));
      router.push("/projects");
    } catch (x) {
      setErr((x as { error?: { message?: string } })?.error?.message ?? "signup failed");
    } finally {
      setBusy(false);
    }
  }

  if (checking) return null;   // no form flash on the way to the console

  return (
    <div className="auth-shell relative">
      <div className="lp-lights" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="lp-mesh" aria-hidden="true" />
      <div className="lp-grain" aria-hidden="true" />

      <SignInPage
        title={<span className="font-normal text-foreground tracking-tighter">Create account</span>}
        description="Pay per run. No subscription, no seats, no API keys to provision."
        busy={busy}
        error={err}
        submitLabel="Create account"
        pendingLabel="Creating…"
        minPasswordLength={8}
        showReset={false}
        onSignIn={submit}
        onGoogleSignIn={() =>
          setErr("Google sign-up isn't wired up — the router issues its own JWTs. Use your email and password.")
        }
        hero={<AxisWorkflow />}
        footer={
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-foreground hover:underline">
              Sign in
            </Link>
          </>
        }
      />
    </div>
  );
}
