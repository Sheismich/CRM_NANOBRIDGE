import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Icono } from "../ui/Icono";
import type { NombreIcono } from "../ui/iconos";
import { MarcaDeAgua } from "../ui/MarcaDeAgua";
import { api } from "../../lib/api";
import { hora } from "../../lib/mi-dia";
import { isoDia } from "../../lib/inicio";
import { plural } from "../../lib/formato";
import type { SaludSistema } from "../../types";

// Franja "Estado del sistema" de Administración (capturas
// administracion-centro-control*.png): los 4 servicios con su semáforo. El
// que necesita atención se ilumina en ámbar. "Responde en" de la API lo
// mide esta pantalla (lo que tarda GET /admin/salud); el de la base lo mide
// el backend con un SELECT 1. Se revisa solo cada minuto.

export function EstadoSistema() {
  const salud = useQuery({
    queryKey: ["admin", "salud"],
    queryFn: async () => {
      const inicio = performance.now();
      const datos = await api.get<SaludSistema>("/api/v1/admin/salud");
      return { datos, respondeMs: Math.round(performance.now() - inicio) };
    },
    refetchInterval: 60_000
  });
  const segundos = useSegundosDesde(salud.dataUpdatedAt);
  const s = salud.data?.datos;
  const n8n = s?.avisos_n8n;
  const correos = s?.correos;
  const porConfigurar = s?.resumen?.por_configurar ?? 0;
  const problemas = s?.resumen?.problemas_abiertos ?? 0;
  const baseCaida = s?.base_datos.estado === "error";
  const titulo = !s ? "Revisando…" : baseCaida ? "La base de datos no responde" : porConfigurar + problemas === 0 ? "Todo en orden" : "Casi todo en orden";
  const subtitulo = !s
    ? ""
    : baseCaida
      ? "La API funciona, pero no alcanza la base de datos. Nada se guarda hasta que vuelva."
      : porConfigurar + problemas === 0
        ? "Ningún pendiente de configuración ni problemas abiertos."
        : `Hay ${[porConfigurar > 0 && plural(porConfigurar, "cosa por configurar", "cosas por configurar"), problemas > 0 && plural(problemas, "problema abierto", "problemas abiertos")].filter(Boolean).join(" y ")}.`;

  return (
    <section className="franja px-4 py-5 md:px-7 md:py-6">
      <MarcaDeAgua sobreOscuro girada={false} className="-right-[50px] -top-[50px] w-[300px]" />
      <div className="relative z-[1] flex flex-wrap items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] border border-white/15 bg-white/8">
          <Icono d="M12 3v6 M6 15v-3h12v3 M4 15h4v5H4z M10 15h4v5h-4z M16 15h4v5h-4z" size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-heading text-[11px] font-extrabold uppercase tracking-[3px] text-mint">Estado del sistema</div>
          <h2 className="font-heading text-[22px] font-black md:text-[26px]">{titulo}</h2>
          <p className="text-[14px] text-white/70">{subtitulo}</p>
        </div>
        {salud.dataUpdatedAt > 0 && (
          <div className="order-first w-full sm:order-none sm:w-auto">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/8 px-3 py-1 text-[12px] font-bold text-white/85">
              <span className="punto-vivo" /> Revisado hace {segundos < 60 ? `${segundos} s` : `${Math.floor(segundos / 60)} min`}
            </span>
          </div>
        )}
      </div>
      {salud.isError && <p className="relative z-[1] mt-4 text-[13px] text-[#ffb1b9]">No se pudo revisar el estado. Se vuelve a intentar en un minuto.</p>}
      <div className="relative z-[1] mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Servicio icono="servidor" titulo="API del CRM" sub={s?.api.revision ? `revisión ${s.api.revision.replace(/^nanobridge-api-/, "")} · Cloud Run` : "Cloud Run"} etiqueta="Responde en" valor={salud.data ? `${salud.data.respondeMs} ms` : "…"} pie="Funcionando" ok />
        <Servicio
          icono={"M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"}
          titulo="Base de datos"
          sub="MySQL · Cloud SQL"
          etiqueta="Responde en"
          valor={s ? (s.base_datos.responde_ms != null ? `${s.base_datos.responde_ms} ms` : "—") : "…"}
          pie={baseCaida ? "No responde" : "Respaldo diario activo"}
          ok={!baseCaida}
        />
        <Servicio
          icono={"M4 4v6h6 M20 20v-6h-6 M5.5 15a7 7 0 0 0 12.2 2.5L20 14 M4 10l2.3-3.5A7 7 0 0 1 18.5 9"}
          titulo="Avisos a n8n"
          sub="eventos hacia la automatización"
          etiqueta="En espera"
          valor={n8n ? plural(n8n.en_espera, "aviso", "avisos") : "…"}
          ok={n8n?.estado !== "atencion"}
          pie={
            !n8n ? (
              "…"
            ) : !n8n.configurado ? (
              <>
                Falta la dirección <code className="rounded-[6px] bg-white/12 px-1.5 py-0.5 text-[10px] font-bold text-white">N8N_WEBHOOK_URL</code>
              </>
            ) : n8n.fallidos > 0 ? (
              plural(n8n.fallidos, "aviso falló", "avisos fallaron")
            ) : (
              "Todo salió"
            )
          }
        />
        <Servicio
          icono="correo"
          titulo="Correos (SendGrid)"
          sub="envío de campañas"
          etiqueta="Enviados hoy"
          valor={correos ? String(correos.enviados_hoy) : "…"}
          pie={correos?.ultimo_envio_en ? `Último envío ${isoDia(new Date(correos.ultimo_envio_en)) === isoDia(new Date()) ? hora(new Date(correos.ultimo_envio_en)) : new Date(correos.ultimo_envio_en).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}` : "Hoy no ha salido ninguno"}
          ok
        />
      </div>
    </section>
  );
}

function Servicio({ icono, titulo, sub, etiqueta, valor, pie, ok }: { icono: NombreIcono | string; titulo: string; sub: string; etiqueta: string; valor: string; pie: ReactNode; ok: boolean }) {
  const esNombre = !icono.includes(" ") && !icono.startsWith("M");
  return (
    <div className={clsx("flex min-w-0 flex-col rounded-[16px] border px-4 py-4", ok ? "border-white/10 bg-white/[0.06]" : "border-[#f4c06a]/70 bg-[#f4c06a]/[0.08] shadow-[0_0_24px_-6px_rgba(244,192,106,0.55)]")}>
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-white/10">{esNombre ? <Icono nombre={icono as NombreIcono} size={17} /> : <Icono d={icono} size={17} />}</span>
        <div className="min-w-0 flex-1">
          <b className="block text-[14px]">{titulo}</b>
          <small className="block text-[11.5px] text-white/60">{sub}</small>
        </div>
        <span className={clsx("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", ok ? "bg-mint shadow-[0_0_10px_var(--mint)]" : "bg-[#f4c06a] shadow-[0_0_10px_#f4c06a]")} />
      </div>
      <div className="mt-4 flex items-end justify-between gap-2">
        <span className="text-[12px] text-white/65">{etiqueta}</span>
        <b className={clsx("mono font-display text-[28px] leading-none", !ok && "text-[#f4c06a]")}>{valor}</b>
      </div>
      <div className={clsx("mt-3 flex items-center gap-1.5 border-t border-white/10 pt-3 text-[12.5px] font-bold", ok ? "text-mint" : "text-[#f4c06a]")}>
        <Icono nombre={ok ? "checkCirculo" : "aviso"} size={15} />
        <span className="min-w-0">{pie}</span>
      </div>
    </div>
  );
}

// Segundos desde la última revisión, que avanzan solos.
function useSegundosDesde(momento: number) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return momento > 0 ? Math.max(0, Math.round((ahora - momento) / 1000)) : 0;
}
