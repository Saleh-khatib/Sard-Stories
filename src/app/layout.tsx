import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "Sard Story Books · M1 lab" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="flex items-center gap-6 border-b border-neutral-200 px-6 py-3 dark:border-neutral-800">
          <span className="font-semibold">Sard Story Books</span>
          <nav className="flex gap-4 text-sm">
            <Link href="/m1" className="hover:underline">M1 experiment</Link>
            <Link href="/studio" className="hover:underline">Image studio</Link>
            <Link href="/settings" className="hover:underline">Settings</Link>
          </nav>
          <span className="ml-auto text-xs text-neutral-500">M1 lab · local only</span>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
