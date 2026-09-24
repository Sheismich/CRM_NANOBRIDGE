import type { HTMLAttributes, ReactNode } from "react";
import { clsx } from "clsx";

export function Card({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx("rounded-[14px] border border-border bg-card", className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 flex items-center text-sm font-bold">
      <span className="mr-2.5 inline-block h-4 w-[5px] rounded-[3px] bg-[var(--grad)]" />
      {children}
    </div>
  );
}
