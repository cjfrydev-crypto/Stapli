import Link from "next/link";
import type { ReactNode } from "react";

const nav = [
  { href: "/app", label: "Shop", icon: "✓" },
  { href: "/app/upcoming", label: "Upcoming", icon: "↗" },
  { href: "/app/products", label: "Products", icon: "≡" },
  { href: "/app/settings", label: "Settings", icon: "⚙" },
];

export function AppShell({ children, householdName }: { children: ReactNode; householdName: string }) {
  return (
    <div className="app-frame">
      <header className="app-header">
        <Link href="/app" className="brand"><span className="brand-mark">S</span><span>Stapli</span></Link>
        <div className="household-pill"><span className="presence-dot" />{householdName}</div>
      </header>
      <main className="app-main">{children}</main>
      <nav className="bottom-nav" aria-label="Primary navigation">
        {nav.map((item) => <Link href={item.href} key={item.href}><span className="bottom-nav__icon">{item.icon}</span><span>{item.label}</span></Link>)}
      </nav>
    </div>
  );
}
