"use client";

import { motion, type HTMLMotionProps, type Variants } from "motion/react";
import { Loader2, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export const cn = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

const EASE = [0.22, 1, 0.36, 1] as const;
export const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
export const rise: Variants = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE } } };

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-on-brand hover:bg-brand-hover shadow-card",
  secondary: "border border-line bg-surface text-ink hover:bg-soft",
  ghost: "text-ink hover:bg-soft",
  danger: "bg-bad text-white hover:opacity-90",
};
const SIZES = { sm: "h-9 px-4 text-sm", md: "h-11 px-5 text-sm", lg: "h-12 px-6 text-base" };

export function Button({ variant = "primary", size = "md", loading, icon: Icon, className, children, disabled, ...rest }: HTMLMotionProps<"button"> & { variant?: Variant; size?: keyof typeof SIZES; loading?: boolean; icon?: LucideIcon; children?: ReactNode }) {
  const off = disabled || loading;
  return (
    <motion.button
      whileHover={off ? undefined : { y: -1 }}
      whileTap={off ? undefined : { scale: 0.97 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      disabled={off}
      className={cn("inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold transition-colors disabled:pointer-events-none disabled:opacity-45", SIZES[size], VARIANTS[variant], className)}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : Icon ? <Icon className="size-4" aria-hidden /> : null}
      {children}
    </motion.button>
  );
}

export function Card({ className, children, ...rest }: HTMLMotionProps<"section">) {
  return (
    <motion.section className={cn("rounded-3xl border border-line bg-surface p-5 shadow-card md:p-6", className)} {...rest}>
      {children}
    </motion.section>
  );
}

const TONES = { neutral: "bg-soft text-mute", info: "bg-accent/15 text-accent", ok: "bg-ok/15 text-ok", warn: "bg-warn/15 text-warn", bad: "bg-bad/15 text-bad" };
export function Badge({ tone = "neutral", icon: Icon, children }: { tone?: keyof typeof TONES; icon?: LucideIcon; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold", TONES[tone])}>
      {Icon && <Icon className="size-3.5" aria-hidden />}
      {children}
    </span>
  );
}

export const fieldCls = "h-11 rounded-xl border border-line bg-surface px-3 text-sm text-ink placeholder:text-mute focus-visible:border-accent";

export function Segmented<T extends string>({ id, value, onChange, options, className }: { id: string; value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: LucideIcon }[]; className?: string }) {
  return (
    <div role="tablist" className={cn("inline-flex gap-1 overflow-x-auto rounded-full bg-soft p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} role="tab" aria-selected={active} onClick={() => onChange(o.value)} className={cn("relative h-10 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-colors", active ? "text-ink" : "text-mute hover:text-ink")}>
            {active && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-full bg-surface shadow-card" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            <span className="relative z-10 inline-flex items-center gap-1.5">{o.icon && <o.icon className="size-4" aria-hidden />}{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-soft", className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <motion.div className="h-full rounded-full bg-brand" initial={false} animate={{ width: `${Math.max(0, Math.min(100, value))}%` }} transition={{ type: "spring", stiffness: 120, damping: 22 }} />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-3xl font-semibold md:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-mute">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={onChange} className={cn("inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors", checked ? "border-transparent bg-accent text-on-accent" : "border-line bg-surface text-ink hover:bg-soft")}>
      <span className={cn("grid size-4 place-items-center rounded-full border text-[10px]", checked ? "border-on-accent" : "border-mute")}>{checked ? "✓" : ""}</span>
      {label}
    </button>
  );
}
