import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import { ApiError } from "../lib/api";
import { useTema } from "../lib/tema";

// Mismos límites que credentialsSchema en el backend (src/auth/dto/credentials.schema.ts)
// -- validar aquí evita una vuelta al servidor solo para descubrir un
// error de forma; el backend sigue siendo quien de verdad autentica.
const loginSchema = z.object({
  correo: z.string().trim().email("Correo inválido"),
  password: z.string().min(12, "La contraseña debe tener al menos 12 caracteres")
});
type LoginInput = z.infer<typeof loginSchema>;

// Rediseño "Circuito vivo" (docs/diseno/login.html): trazos de circuito con
// pulsos de luz detrás de una tarjeta al centro. Los estilos viven en
// index.css (.login-*); el circuito del celular es otro dibujo, no el de
// escritorio recortado.
export function LoginPage() {
  const { user, status, login } = useAuth();
  const { tema, alternar } = useTema();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Iniciar sesión · CRM NANOBRIDGE";
  }, []);

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
      // 401 (credenciales incorrectas) y 429 (RateLimitGuard por IP, o el
      // freno por cuenta) son los casos esperados del lado del backend --
      // cualquier otro status se muestra igual pero es señal de que algo
      // más está mal.
      setServerError(mensajeDeLogin(error));
    }
  }

  return (
    <div className="login">
      <div className="login-tema" role="group" aria-label="Modo de color">
        <button type="button" aria-pressed={tema === "claro"} title="Día" aria-label="Modo día" onClick={() => tema !== "claro" && alternar()}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        </button>
        <button type="button" aria-pressed={tema === "oscuro"} title="Noche" aria-label="Modo noche" onClick={() => tema !== "oscuro" && alternar()}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
          </svg>
        </button>
      </div>

      <CircuitoEscritorio />
      <CircuitoMovil />

      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="login-tarjeta" noValidate>
        <div className="flex items-center gap-3">
          <img src={tema === "oscuro" ? "/logo-n-claro.svg" : "/logo-n-color.svg"} alt="" className="w-[42px]" />
          <div>
            <b className="block font-display text-[19px] font-normal leading-none tracking-[1.5px] text-[var(--l-strong)]">NANOBRIDGE</b>
            <span className="font-heading text-[9px] font-bold uppercase tracking-[2px] text-[var(--l-tx3)]">CRM de prospección</span>
          </div>
        </div>

        <h1 className="mt-7 font-heading text-[22px] font-extrabold text-[var(--l-strong)]">Iniciar sesión</h1>

        <div className="mt-5">
          <label htmlFor="correo" className="mb-[7px] block text-[13px] font-bold">
            Correo
          </label>
          <input id="correo" type="email" autoComplete="username" placeholder="tu@nano-bridge-mex.com" className="login-campo" aria-invalid={Boolean(errors.correo)} {...register("correo")} />
          {errors.correo && <span className="mt-1.5 block text-xs text-danger">{errors.correo.message}</span>}
        </div>

        <div className="mt-4">
          <label htmlFor="password" className="mb-[7px] block text-[13px] font-bold">
            Contraseña
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••••"
              className="login-campo pr-11"
              aria-invalid={Boolean(errors.password)}
              {...register("password")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--l-tx3)]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
                {showPassword && <path d="M3 3l18 18" />}
              </svg>
            </button>
          </div>
          {errors.password && <span className="mt-1.5 block text-xs text-danger">{errors.password.message}</span>}
        </div>

        {serverError && (
          <div role="alert" className="mt-4 rounded-[10px] bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger">
            {serverError}
          </div>
        )}

        <button type="submit" disabled={isSubmitting} className="login-boton mt-6">
          {isSubmitting ? "Entrando…" : "Iniciar sesión"}
        </button>

        <div className="mt-4 text-center text-[13px] text-[var(--l-tx3)]">
          ¿Problemas para entrar? <span className="font-bold text-[var(--l-link)]">Contacta a tu administrador</span>
        </div>
      </form>

      <div className="login-pie">Conectando la ficción con la realidad</div>
    </div>
  );
}

function mensajeDeLogin(error: unknown) {
  if (!(error instanceof ApiError)) return "No se pudo conectar con el servidor";
  // 10 contraseñas mal en 15 minutos bloquean la cuenta 15 minutos, desde
  // cualquier IP. Retry-After trae los segundos que faltan.
  if (error.code === "CUENTA_BLOQUEADA_TEMPORALMENTE") {
    const minutos = error.retryAfter ? Math.max(1, Math.ceil(error.retryAfter / 60)) : null;
    return minutos
      ? `Demasiados intentos fallidos con esta cuenta. Intenta de nuevo en ${minutos} ${minutos === 1 ? "minuto" : "minutos"}.`
      : "Demasiados intentos fallidos con esta cuenta. Intenta de nuevo más tarde.";
  }
  // Protección CSRF: el sitio se abrió desde un dominio que el backend no
  // tiene en CORS_ORIGINS.
  if (error.code === "ORIGEN_NO_PERMITIDO") return "Este sitio no está autorizado para conectarse con el CRM. Avisa al administrador.";
  return error.message;
}

// Trazos del diseño. Cada pulso recorre el mismo camino que su trazo.
const TRAZOS_ESCRITORIO = [
  "M-20 140 H260 L340 220 H560 L620 160 H760",
  "M1460 120 H1180 L1100 200 H900 L840 260",
  "M-20 700 H180 L260 620 H420 L500 700 H700",
  "M1460 760 H1240 L1160 680 H980 L900 760 H760",
  "M120 -20 V80 L200 160",
  "M1320 920 V820 L1240 760",
  "M-20 420 H120 L180 480 H300",
  "M1460 460 H1300 L1240 400 H1120"
];
const TRAZOS_MOVIL = ["M60 -20 V60 L110 110 V170", "M330 -20 V40 L280 90 V170", "M195 -20 V150", "M70 864 V780 L120 730 V680", "M320 864 V800 L270 750 V680", "M195 864 V700"];

// Color del trazo y del brillo (en modo noche) de los cuatro pulsos.
const PULSOS = [
  { clase: "", stroke: "#41e198", color: "#41e198" },
  { clase: "b", stroke: "#23bad3", color: "#23bad3" },
  { clase: "c", stroke: "#2a449b", color: "#4f6bd6" },
  { clase: "d", stroke: "#a796e6", color: "#a796e6" }
];

function CircuitoEscritorio() {
  const conPulso = [TRAZOS_ESCRITORIO[0], TRAZOS_ESCRITORIO[1], TRAZOS_ESCRITORIO[2], TRAZOS_ESCRITORIO[3]];
  return (
    <svg className="login-fondo escritorio" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g className="login-trazo">
        {TRAZOS_ESCRITORIO.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      {conPulso.map((d, i) => (
        <path key={d} className={`login-pulso ${PULSOS[i].clase}`} stroke={PULSOS[i].stroke} color={PULSOS[i].color} d={d} />
      ))}
      {[
        [760, 160, 9],
        [840, 260, 9],
        [700, 700, 9],
        [760, 760, 9],
        [200, 160, 7],
        [1240, 760, 7],
        [300, 480, 7],
        [1120, 400, 7]
      ].map(([cx, cy, r]) => (
        <circle key={`${cx}-${cy}`} className="login-nodo" cx={cx} cy={cy} r={r} />
      ))}
    </svg>
  );
}

function CircuitoMovil() {
  const conPulso = [TRAZOS_MOVIL[0], TRAZOS_MOVIL[1], TRAZOS_MOVIL[3], TRAZOS_MOVIL[4]];
  return (
    <svg className="login-fondo movil" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g className="login-trazo">
        {TRAZOS_MOVIL.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      {conPulso.map((d, i) => (
        <path key={d} className={`login-pulso ${PULSOS[i].clase}`} stroke={PULSOS[i].stroke} color={PULSOS[i].color} d={d} />
      ))}
      {[
        [110, 170, 7],
        [280, 170, 7],
        [195, 150, 6],
        [120, 680, 7],
        [270, 680, 7],
        [195, 700, 6]
      ].map(([cx, cy, r]) => (
        <circle key={`${cx}-${cy}`} className="login-nodo" cx={cx} cy={cy} r={r} />
      ))}
    </svg>
  );
}
