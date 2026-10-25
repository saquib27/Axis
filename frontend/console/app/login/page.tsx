"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, session } from "../../lib/api";
import { SignInPage } from "../../components/ui/sign-in.tsx";
import { AxisWorkflow } from "../../components/ui/axis-workflow.tsx";

export default function Login() {
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
      session.save(await api.login(email, password));
      router.push("/projects");
    } catch (x) {
      setErr((x as { error?: { message?: string } })?.error?.message ?? "login failed");
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
        title={<span className="font-normal text-foreground tracking-tighter">Welcome back</span>}
        description="Open your receipts, projects and spend history."
        busy={busy}
        error={err}
        submitLabel="Sign in"
        pendingLabel="Signing in…"
        onSignIn={submit}
        onGoogleSignIn={() =>
          setErr("Google sign-in isn't wired up — the router issues its own JWTs. Use your email and password.")
        }
        onResetPassword={() =>
          setErr("Password reset isn't available yet. There is no reset endpoint on the router.")
        }
        hero={<AxisWorkflow />}
        footer={
          <>
            New to AXIS?{" "}
            <Link href="/signup" className="text-foreground hover:underline">
              Create an account
            </Link>
          </>
        }
      />
    </div>
  );
}
