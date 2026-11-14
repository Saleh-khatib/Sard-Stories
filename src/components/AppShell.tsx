"use client";

import { FlaskConical, SlidersHorizontal, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SardLogo } from "./SardLogo";
import { cn } from "./ui";

const NAV = [
  { href: "/m1", label: "Experiment", icon: FlaskConical },
  { href: "/studio", label: "Image studio", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal },
];

function Brand() {
  return (
    <Link href="/m1" className="flex items-center gap-3" aria-label="Sard Story Books home">
      <SardLogo className="h-9 w-auto text-ink" />
      <span className="font-display text-lg font-semibold leading-tight">Story Books</span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[256px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-8 border-r border-line bg-surface/70 p-5 backdrop-blur md:flex">
        <Brand />
        <nav className="flex flex-col gap-1" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn("relative flex h-12 items-center gap-3 rounded-2xl px-4 font-semibold transition-colors", active(n.href) ? "text-ink" : "text-mute hover:text-ink")}>
              {active(n.href) && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-2xl bg-brand/20" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
              <n.icon className="relative size-5" aria-hidden />
              <span className="relative">{n.label}</span>
            </Link>
          ))}
        </nav>
        <p className="mt-auto text-xs text-mute">M1 lab · runs on this computer only</p>
      </aside>

      <div className="min-w-0">
        <header className="flex h-14 items-center border-b border-line bg-surface/70 px-4 backdrop-blur md:hidden">
          <Brand />
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 md:px-10 md:pb-12 md:pt-10">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-line bg-surface/90 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Main">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold", active(n.href) ? "text-ink" : "text-mute")}>
            <n.icon className={cn("size-5", active(n.href) && "text-brand")} aria-hidden />
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
