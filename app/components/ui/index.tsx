import type { ReactNode } from "react";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-lockup">
      <span className="brand-mark">象</span>
      {!compact && <span className="brand-name">小飞象</span>}
    </div>
  );
}

export function Pill({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <span className={`pill ${dark ? "pill-dark" : ""}`}>{children}</span>;
}

export function AppButton({
  children,
  primary = false,
  disabled = false,
  onClick,
  className = "",
}: {
  children: ReactNode;
  primary?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      className={`app-button ${primary ? "primary" : ""} ${className}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

