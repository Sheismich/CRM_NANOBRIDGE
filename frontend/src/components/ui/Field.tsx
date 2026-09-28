import type { ReactNode } from "react";

// Mismo estilo de input que LoginPage, para los formularios de la ficha.
export const inputClass = "w-full rounded-[9px] border border-border bg-white px-3 py-2 text-[13px]";

export function Field({ label, htmlFor, error, children }: { label: string; htmlFor: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-semibold text-ink-2">
        {label}
      </label>
      {children}
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

export function ServerError({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="rounded-[9px] bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger">{message}</div>;
}
