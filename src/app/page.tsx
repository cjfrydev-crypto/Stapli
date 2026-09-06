import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) redirect("/app");

  return (
    <main className="landing-shell">
      <nav className="landing-nav"><div className="brand"><span className="brand-mark">S</span><span>Stapli</span></div><div><Link href="/auth/sign-in" className="button button--ghost">Sign in</Link><Link href="/auth/sign-up" className="button button--primary">Get started</Link></div></nav>
      <section className="hero">
        <div className="hero-copy"><span className="hero-badge">Shopping that remembers</span><h1>The list that already knows what’s running out.</h1><p>Stapli learns what your household buys, how much you usually get, and when it tends to come round again — then helps build the next shop.</p><div className="hero-actions"><Link href="/auth/sign-up" className="button button--primary button--large">Start your household</Link><span>No pantry admin. No scanning what you consume.</span></div></div>
        <div className="hero-phone" aria-label="Stapli shopping list preview">
          <div className="phone-top"><div><span>Tuesday</span><strong>Tesco</strong></div><span className="live-pill"><span />Shared</span></div></div>
          <div className="phone-progress"><span style={{ width: "42%" }} /></div>
          <div className="phone-category"><span>Fruit & veg</span><small>3</small></div>
          {[["Blueberries", "Rosedene Farms 150g", "1"],["Blackberries", "Rosedene Farms 150g", "1"],["Bananas", "Tesco Small Bananas 6 Pack", "1"]].map(([name, article, qty]) => <div className="phone-item" key={name}><span className="fake-check"/><div><strong>{name}</strong><small>{article}</small></div><b>×{qty}</b></div>)}
          <div className="phone-category"><span>Bakery</span><small>1</small></div>
          <div className="phone-item phone-item--highlight"><span className="fake-check"/><div><strong>White bread</strong><small>Tesco White Toastie 800g</small><em>carried over</em></div><b>×2</b></div>
        </div>
      </section>
      <section className="principles">
        <article><span>01</span><h2>It watches purchases, not cupboards.</h2><p>No inventory maintenance. Tick what you buy and Stapli learns from the event.</p></article>
        <article><span>02</span><h2>Your settings and reality stay separate.</h2><p>Set “every 14 days” if you want. Stapli still shows the rolling 16-week actual beside it.</p></article>
        <article><span>03</span><h2>The exact article matters.</h2><p>“Milk” is a need. The Tesco or Asda product your household actually prefers is remembered underneath it.</p></article>
      </section>
    </main>
  );
}
