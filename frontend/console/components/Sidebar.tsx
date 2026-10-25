"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { session } from "../lib/api";

const NAV: { href: string; label: string; ico: string; section: string }[] = [
  { href: "/projects", label: "Projects", ico: "▦", section: "Run" },
  { href: "/agent", label: "Autonomous agent", ico: "◆", section: "Run" },
  { href: "/workflow", label: "Workflow", ico: "▶", section: "Run" },
  { href: "/failure", label: "Test failure", ico: "↺", section: "Prove it" },
  { href: "/attack", label: "Start attack", ico: "⚔", section: "Prove it" },
  { href: "/receipts", label: "Receipts", ico: "≣", section: "Ledger" },
  { href: "/refunds", label: "Refunds", ico: "↩", section: "Ledger" },
  { href: "/protocol", label: "How it works", ico: "?", section: "Learn" },
];

const SECTIONS = ["Run", "Prove it", "Ledger", "Learn"];

/** The AXIS ribbon mark, inlined so it needs no network fetch. */
function Logo() {
  return (
    <svg className="logo" viewBox="0 0 1024 1024" aria-hidden>
      <defs>
        <linearGradient id="sbg1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#B30000" />
          <stop offset="100%" stopColor="#4D0000" />
        </linearGradient>
        <linearGradient id="sbg2" x1="100%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#E60000" />
          <stop offset="100%" stopColor="#FF4D4D" />
        </linearGradient>
      </defs>
      <path d="M 453 200 L 203 820 L 821 450" fill="none" stroke="url(#sbg1)" strokeWidth="140" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M 821 450 L 703 820 L 453 200" fill="none" stroke="url(#sbg2)" strokeWidth="140" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Never render the whole key. It spends real USDC, and this sits on screen
 *  through every demo and screen-share — masked is the only safe default. */
const mask = (k: string) => `${k.slice(0, 9)}…${k.slice(-4)}`;

export function Sidebar() {
  const [email, setEmail] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // Read the session on the client only (localStorage is not on the server).
  useEffect(() => { setEmail(session.email()); setApiKey(session.apiKey()); }, []);

  function logout() {
    session.clear();
    setEmail(null);
    setApiKey(null);
    router.push("/login");
  }

  function copyKey() {
    if (!apiKey) return;
    navigator.clipboard?.writeText(apiKey);   // the FULL key goes to the clipboard
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav className="sidebar">
      <Link href="/projects" className="sidebar-brand">
        <Logo />
        <span className="name">AX<b>I</b>S</span>
      </Link>

      {SECTIONS.map((section) => (
        <div key={section}>
          <div className="sidebar-section">{section}</div>
          <ul className="sidebar-nav">
            {NAV.filter((n) => n.section === section).map((n) => (
              <li key={n.href}>
                <Link href={n.href} className={isActive(n.href) ? "active" : ""}>
                  <span className="ico">{n.ico}</span>
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="sidebar-foot">
        {email ? (
          <>
            <div className="dim" style={{ marginBottom: 8 }}>{email}</div>
            {apiKey ? (
              <div className="keychip" title="API key — copy into the extension or AXIS_API_KEY">
                <code>{mask(apiKey)}</code>
                <button type="button" onClick={copyKey} aria-label="Copy API key">
                  {copied ? "✓" : "copy"}
                </button>
              </div>
            ) : null}
            <button type="button" onClick={logout}>log out</button>
          </>
        ) : (
          <>
            <Link href="/login">Log in</Link>
            {" · "}
            <Link href="/signup">Sign up</Link>
          </>
        )}
      </div>
    </nav>
  );
}
