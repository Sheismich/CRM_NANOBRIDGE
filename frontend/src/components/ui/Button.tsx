import type { ButtonHTMLAttributes } from "react";
import { clsx } from "clsx";

type Variant = "primary" | "outline" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-[linear-gradient(135deg,var(--navy),var(--violet))] text-white shadow-[0_10px_24px_rgba(42,68,155,0.28)]",
  outline: "border-[1.5px] border-navy bg-white text-navy",
  ghost: "text-ink-2 hover:bg-bg"
};

export function Button({ variant = "primary", className, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={clsx(
        "rounded-[9px] px-4 py-2.5 text-[13px] font-bold transition-opacity",
        VARIANTS[variant],
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className
      )}
      disabled={disabled}
      {...rest}
    />
  );
}
