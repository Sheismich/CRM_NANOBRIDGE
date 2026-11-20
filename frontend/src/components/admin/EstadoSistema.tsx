import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Icono } from "../ui/Icono";
import type { NombreIcono } from "../ui/iconos";
import { MarcaDeAgua } from "../ui/MarcaDeAgua";
import { Button } from "../ui/Button";
import { ApiError, api } from "../../lib/api";
import { hora } from "../../lib/mi-dia";
import { isoDia } from "../../lib/inicio";
import { plural } from "../../lib/formato";
import type { ProspectoRebotado, ReactivacionRebote, SaludSistema } from "../../types";

// Franja "Estado del sistema" de Administración (capturas
// administracion-centro-control*.png): los servicios con su semáforo. El
// que necesita atención se ilumina en ámbar. "Responde en" de la API lo
// mide esta pantalla (lo que tarda GET /admin/salud); el de la base lo mide
// el backend con un SELECT 1. Se revisa solo cada minuto.

export function EstadoSistema() {
  const queryClient = useQueryClient();
  const [reanudando, setReanudando] = useState(false);
  const [errorFreno, setErrorFreno] = useState<string | null>(null);
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
  const correos = s?.correos;
  const freno = s?.freno;
  const problemas = s?.resumen?.problemas_abiertos ?? 0;
  const baseCaida = s?.base_datos.estado === "error";
  const titulo = !s ? "Revisando…" : baseCaida ? "La base de datos no responde" : freno?.pausado ? "Envíos de prospección en pausa" : problemas === 0 ? "Todo en orden" : "Casi todo en orden";
  const subtitulo = !s
    ? ""
    : baseCaida
      ? "La API funciona, pero no alcanza la base de datos. Nada se guarda hasta que vuelva."
      : freno?.pausado
        ? "Nadie recibe correos de prospección hasta que un administrador los reanude."
      : problemas === 0
        ? "Ningún problema abierto."
        : `Hay ${plural(problemas, "problema abierto", "problemas abiertos")}.`;

  async function reanudar() {
    setReanudando(true);
    setErrorFreno(null);
    try {
      await api.post("/api/v1/admin/freno-dominio/reanudar");
      await queryClient.invalidateQueries({ queryKey: ["admin", "salud"] });
    } catch (err) {
      setErrorFreno(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setReanudando(false);
    }
  }

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
      {freno?.pausado && (
        <div className="relative z-[1] mt-4 rounded-[14px] border border-[#f4c06a]/70 bg-[#f4c06a]/[0.08] px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-[13px] text-white/85">
              {freno.pausado_en && <b className="mb-0.5 block text-[#f4c06a]">En pausa desde {momento(freno.pausado_en)}</b>}
              {freno.motivo} Revisa la lista antes de reanudar: los correos siguen esperando su turno.
              {errorFreno && <span className="mt-1 block text-[#ffb1b9]">{errorFreno}</span>}
            </p>
            <Button disabled={reanudando} onClick={() => void reanudar()}>
              {reanudando ? "…" : "Reanudar envíos"}
            </Button>
          </div>
          <ListaRebotados />
        </div>
      )}
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
          icono="correo"
          titulo="Correos (SendGrid)"
          sub="envío de campañas"
          etiqueta="Enviados hoy"
          valor={correos ? String(correos.enviados_hoy) : "…"}
          pie={freno?.pausado ? (freno.pausado_en ? `En pausa desde ${momento(freno.pausado_en)}` : "Envíos en pausa") : (correos?.sin_confirmar ?? 0) > 0 ? plural(correos!.sin_confirmar, "correo sin confirmar", "correos sin confirmar") : correos?.ultimo_envio_en ? `Último envío ${momento(correos.ultimo_envio_en)}` : "Hoy no ha salido ninguno"}
          ok={!freno?.pausado && (correos?.sin_confirmar ?? 0) === 0}
        />
        <Servicio
          icono="aviso"
          titulo="Reputación del dominio"
          sub={freno ? `${freno.rebotes_duros_7d} ${freno.rebotes_duros_7d === 1 ? "duro" : "duros"} · ${freno.rebotes_suaves_7d} ${freno.rebotes_suaves_7d === 1 ? "suave" : "suaves"} · ${plural(freno.quejas_7d, "queja", "quejas")} en 7 días` : "rebotes y quejas en 7 días"}
          etiqueta="Rebotes"
          valor={freno ? `${freno.rebotes_7d}${freno.tasa_rebote_7d != null ? ` · ${freno.tasa_rebote_7d}%` : ""}` : "…"}
          pie={!freno ? "…" : freno.pausado ? "Envíos en pausa" : reglaDePausa(freno)}
          ok={!freno?.pausado}
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

// "10:02" si es de hoy; si no, "18 nov".
function momento(iso: string) {
  const fecha = new Date(iso);
  return isoDia(fecha) === isoDia(new Date()) ? hora(fecha) : fecha.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

// Con pocos envíos el porcentaje engaña, así que la regla cambia (ver
// src/shared/freno-dominio.ts).
function reglaDePausa(f: NonNullable<SaludSistema["freno"]>) {
  const quejas = plural(f.limite_quejas, "queja", "quejas");
  return f.enviados_7d >= f.min_envios
    ? `Se pausa con ${f.limite_tasa}% de rebotes o ${quejas}`
    : `Se pausa con ${f.limite_rebotes} rebotes o ${quejas} (${f.enviados_7d} de ${f.min_envios} envíos para usar el %)`;
}

// Los contactos que rebotaron (044): correo, tipo y motivo, con "Reactivar"
// para cuando se corrigió el correo. Se carga al abrirla.
function ListaRebotados() {
  const queryClient = useQueryClient();
  const [abierta, setAbierta] = useState(false);
  const [confirmando, setConfirmando] = useState<number | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rebotes = useQuery({
    queryKey: ["admin", "rebotes"],
    queryFn: () => api.get<{ data: ProspectoRebotado[] }>("/api/v1/admin/rebotes"),
    enabled: abierta
  });
  const filas = rebotes.data?.data ?? [];

  async function reactivar(id: number) {
    setError(null);
    setAviso(null);
    try {
      const res = await api.post<ReactivacionRebote>(`/api/v1/admin/rebotes/${id}/reactivar`);
      setAviso(res.quitar_de_sendgrid
        ? `Reactivado. Quita también ${res.quitar_de_sendgrid} de Suppressions → Bounces en SendGrid; si no, SendGrid no le vuelve a mandar.`
        : "Reactivado. Ya se puede volver a mandar a automatización.");
      setConfirmando(null);
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    }
  }

  return (
    <div className="mt-3 border-t border-white/10 pt-3">
      <button type="button" className="text-[13px] font-bold text-mint underline-offset-2 hover:underline" aria-expanded={abierta} onClick={() => setAbierta((v) => !v)}>
        {abierta ? "Ocultar los contactos que rebotaron" : "Ver los contactos que rebotaron"}
      </button>
      {abierta && (
        <div className="mt-2 text-[13px] text-white/85">
          {rebotes.isLoading && <p className="text-white/60">Cargando…</p>}
          {rebotes.isError && <p className="text-[#ffb1b9]">No se pudo cargar la lista.</p>}
          {rebotes.isSuccess && filas.length === 0 && <p className="text-white/60">Ningún contacto rebotado en los últimos 7 días.</p>}
          {aviso && <p className="mb-2 text-mint">{aviso}</p>}
          {error && <p className="mb-2 text-[#ffb1b9]">{error}</p>}
          <ul className="flex flex-col gap-2">
            {filas.map((f) => (
              <li key={f.prospecto_id} className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-[10px] bg-white/[0.05] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <b className="block break-all">{f.correo ?? "(sin correo)"}</b>
                  <small className="block text-white/60">
                    {f.contacto} · {f.empresa}{f.campana ? ` · ${f.campana}` : ""}
                  </small>
                  <small className="block text-white/75">
                    <span className={clsx("font-bold", f.tipo_rebote === "duro" ? "text-[#ffb1b9]" : "text-[#f4c06a]")}>{f.tipo_rebote === "suave" ? "Rebote suave repetido" : "Rebote duro"}</span>
                    {f.motivo_rebote ? ` · ${f.motivo_rebote}` : ""}
                    {f.fecha_rebote ? ` · ${momento(f.fecha_rebote)}` : ""}
                  </small>
                </div>
                {confirmando === f.prospecto_id ? (
                  <span className="flex items-center gap-2">
                    <button type="button" className="rounded-[8px] bg-mint px-2.5 py-1 text-[12px] font-bold text-navy-ink" onClick={() => void reactivar(f.prospecto_id)}>
                      Sí, reactivar
                    </button>
                    <button type="button" className="rounded-[8px] px-2.5 py-1 text-[12px] font-bold text-white/70 hover:bg-white/10" onClick={() => setConfirmando(null)}>
                      No
                    </button>
                  </span>
                ) : (
                  <button type="button" className="rounded-[8px] border border-white/20 px-2.5 py-1 text-[12px] font-bold text-white/85 hover:bg-white/10" onClick={() => setConfirmando(f.prospecto_id)}>
                    Reactivar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
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
