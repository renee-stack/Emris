export function Mark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--ink)" />
      <path
        d="M6.5 22.5 L12.2 16.8 L17.2 19.6 L25.5 9"
        fill="none"
        stroke="var(--safety)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6.5" cy="22.5" r="1.7" fill="var(--safety)" />
      <circle cx="12.2" cy="16.8" r="1.7" fill="var(--safety)" />
      <circle cx="17.2" cy="19.6" r="1.7" fill="var(--safety)" />
      <circle cx="25.5" cy="9" r="1.7" fill="var(--safety)" />
    </svg>
  );
}
