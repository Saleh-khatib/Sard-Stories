import { SARD_LOGO } from "./sard-logo-path";

/** The Sard mark as a vector. It takes the text colour, so it works in light and dark mode. */
export function SardLogo({ className, title = "Sard" }: { className?: string; title?: string }) {
  return (
    <svg viewBox={`0 0 ${SARD_LOGO.width} ${SARD_LOGO.height}`} fill="currentColor" role="img" aria-label={title} className={className}>
      <path fillRule="evenodd" d={SARD_LOGO.d} />
    </svg>
  );
}
