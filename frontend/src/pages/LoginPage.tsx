import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import { ApiError } from "../lib/api";

// Mismos límites que credentialsSchema en el backend (src/auth/dto/credentials.schema.ts)
// -- validar aquí evita una vuelta al servidor solo para descubrir un
// error de forma; el backend sigue siendo quien de verdad autentica.
const loginSchema = z.object({
  correo: z.string().trim().email("Correo inválido"),
  password: z.string().min(12, "La contraseña debe tener al menos 12 caracteres")
});
type LoginInput = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { user, status, login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  // Ya hay sesión (ej. se llegó a /login con la cookie todavía viva): no
  // tiene caso mostrar el formulario otra vez.
  if (status === "authenticated" && user) return <Navigate to="/" replace />;

  async function onSubmit(values: LoginInput) {
    setServerError(null);
    try {
      await login(values.correo, values.password);
    } catch (error) {
      // 401 (credenciales incorrectas) y 429 (RateLimitGuard) son los dos
      // casos esperados del lado del backend -- cualquier otro status se
      // muestra igual pero es señal de que algo más está mal.
      setServerError(error instanceof ApiError ? error.message : "No se pudo conectar con el servidor");
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg">
      {/* Panel de marca — mismo corte diagonal que el mockup */}
      <div
        className="relative hidden min-w-[420px] flex-[0.9] overflow-hidden bg-bg shadow-[6px_0_24px_rgba(16,23,51,0.05)] lg:block"
        style={{ clipPath: "polygon(0 0, 100% 0, 84% 100%, 0 100%)" }}
      >
        <div className="relative flex h-full flex-col justify-between p-13 pr-21">
          <div className="font-display text-2xl text-navy">NANOBRIDGE</div>
          <div className="max-w-[440px]">
            <div className="mb-5 flex items-center gap-2.5">
              <Dot color="var(--mint)" />
              <div className="h-px w-11.5 bg-gradient-to-r from-mint to-cyan" />
              <Dot color="var(--cyan)" />
              <div className="h-px w-11.5 bg-gradient-to-r from-cyan to-navy" />
              <Dot color="var(--violet)" />
            </div>
            <div className="font-display text-[32px] leading-tight text-ink">
              CRM de prospección
              <br />
              outbound
            </div>
            <div className="mt-4 text-[14.5px] font-medium leading-relaxed text-ink-2">Empresas, historial, ventas y cotizaciones en un solo lugar.</div>
          </div>
          <div className="text-xs text-ink-3">© 2026 NANOBRIDGE SA de CV</div>
        </div>
      </div>

      {/* Formulario */}
      <div className="flex flex-1 items-center justify-center p-10">
        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex w-[360px] flex-col gap-6.5">
          <div>
            <div className="font-heading text-[22px] font-extrabold">Iniciar sesión</div>
            <div className="mt-1.5 text-[13px] text-ink-2">Ingresa con tu cuenta del CRM.</div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="correo" className="text-[13px] font-semibold text-ink-2">
                Correo
              </label>
              <input
                id="correo"
                type="email"
                autoComplete="username"
                placeholder="tu.nombre@nanobridge.mx"
                className="rounded-[9px] border border-border bg-white px-3.5 py-2.75 text-sm"
                {...register("correo")}
              />
              {errors.correo && <span className="text-xs text-danger">{errors.correo.message}</span>}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-[13px] font-semibold text-ink-2">
                Contraseña
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full rounded-[9px] border border-border bg-white px-3.5 py-2.75 pr-10 text-sm"
                  {...register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              </div>
              {errors.password && <span className="text-xs text-danger">{errors.password.message}</span>}
            </div>
          </div>

          {serverError && <div className="rounded-[9px] bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger">{serverError}</div>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-[9px] bg-[linear-gradient(135deg,var(--navy),var(--violet))] py-3.25 text-sm font-bold text-white shadow-[0_10px_24px_rgba(42,68,155,0.28)] disabled:opacity-60"
          >
            {isSubmitting ? "Entrando…" : "Iniciar sesión"}
          </button>

          <div className="text-center text-xs text-ink-3">¿Problemas para entrar? Contacta a tu administrador.</div>
        </form>
      </div>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 14 14">
      <circle cx="7" cy="7" r="5" fill="none" stroke={color} strokeWidth="2" />
      <circle cx="7" cy="7" r="2" fill={color} />
    </svg>
  );
}
