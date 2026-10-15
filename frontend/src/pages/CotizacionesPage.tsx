import { useEffect, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { AppShell } from "../components/layout/AppShell";
import { CuerpoCotizacion, EncabezadoCotizacion } from "../components/cotizaciones/CotizacionPanel";
import { EditorCotizacion, type ModoEditor } from "../components/cotizaciones/EditorCotizacion";
import { TableroCotizaciones, type ColumnaCotizaciones } from "../components/cotizaciones/TableroCotizaciones";
import { Button } from "../components/ui/Button";
import { CajaBusqueda } from "../components/ui/CajaBusqueda";
import { Contador } from "../components/ui/Contador";
import { EncabezadoPagina } from "../components/ui/EncabezadoPagina";
import { EstadoVacio } from "../components/ui/EstadoVacio";
import { inputBaseClass } from "../components/ui/Field";
import { Icono } from "../components/ui/Icono";
import { PanelLateral } from "../components/ui/PanelLateral";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { TONO_ESTADO_COTIZACION, useMotivosRechazoCotizacion } from "../lib/cotizaciones";
import { compacto } from "../lib/formato";
import type { ConteosCotizaciones, CotizacionTablero, Paginated, Usuario } from "../types";

// Cotizaciones del rediseño (docs/diseno/cotizaciones.html, opción B):
// qué se ha propuesto, a quién, por cuánto y en qué quedó. Arriba los
// contadores por estado con la tasa de aceptación (GET /cotizaciones/conteos;
// cada uno filtra el tablero), luego el tablero por estado. Clic en una
// tarjeta abre la cotización como documento en el panel lateral, con sus
// acciones; "+ Nueva cotización" y "Nueva versión" abren el editor por
// pasos en lugar del tablero. Un agente solo ve las de sus oportunidades
// (lo filtra el backend).

type EstadoTablero = "borrador" | "enviada" | "aceptada" | "rechazada" | "vencida";
type Orden = "reciente" | "envio" | "total";

const ESTADOS: { estado: EstadoTablero; titulo: string }[] = [
  { estado: "borrador", titulo: "Borradores" },
  { estado: "enviada", titulo: "Enviadas" },
  { estado: "aceptada", titulo: "Aceptadas" },
  { estado: "rechazada", titulo: "Rechazadas" },
  { estado: "vencida", titulo: "Vencidas" }
];
// El backend permite hasta 100 por página: una consulta por estado.
const LIMITE_COLUMNA = 100;

export function CotizacionesPage() {
  const { user } = useAuth();
  const esAdminOSupervisor = user?.rol === "administrador" || user?.rol === "supervisor";
  const [estado, setEstado] = useState<EstadoTablero | "">("");
  const [texto, setTexto] = useState("");
  const [q, setQ] = useState("");
  const [responsableId, setResponsableId] = useState("");
  const [orden, setOrden] = useState<Orden>("reciente");
  const [abiertaId, setAbiertaId] = useState<number | null>(null);
  const [editor, setEditor] = useState<ModoEditor | null>(null);

  // La búsqueda va al backend (empresa, oportunidad o folio "#12").
  useEffect(() => {
    const t = setTimeout(() => setQ(texto.trim()), 300);
    return () => clearTimeout(t);
  }, [texto]);

  const { data: usuarios } = useQuery({
    queryKey: ["usuarios", "activos"],
    queryFn: () => api.get<Paginated<Usuario>>("/api/v1/usuarios", { activo: true, limit: 100 }),
    enabled: esAdminOSupervisor,
    staleTime: 5 * 60_000
  });
  const personas = usuarios?.data.filter((u) => u.rol !== "sistema");
  const { data: conteos } = useQuery({
    queryKey: ["cotizaciones", "conteos", { responsableId }],
    queryFn: () => api.get<ConteosCotizaciones>("/api/v1/cotizaciones/conteos", { responsableId: responsableId || undefined })
  });
  const { data: motivos } = useMotivosRechazoCotizacion();
  const nombreMotivo = (clave: string) => motivos?.find((m) => m.clave === clave)?.nombre ?? clave;

  const visibles = estado ? ESTADOS.filter((e) => e.estado === estado) : ESTADOS;
  const consultas = useQueries({
    queries: visibles.map((e) => ({
      queryKey: ["cotizaciones", "tablero", e.estado, { q, responsableId, orden }],
      queryFn: () =>
        api.get<Paginated<CotizacionTablero>>("/api/v1/cotizaciones", { estado: e.estado, q: q || undefined, responsableId: responsableId || undefined, orden, limit: LIMITE_COLUMNA })
    }))
  });
  const columnas: ColumnaCotizaciones[] = visibles.map((e, i) => {
    const lista = consultas[i]?.data?.data ?? [];
    // Con búsqueda, la cuenta es de lo encontrado; sin ella, la de /conteos
    // (cuenta todas, aunque la columna solo traiga las 100 más recientes).
    const cuenta = q
      ? consultas[i]?.data && { cantidad: lista.length, total: lista.reduce((s, c) => s + Number(c.total), 0) }
      : conteos && { cantidad: conteos[e.estado].cantidad, total: Number(conteos[e.estado].total) };
    return {
      ...e,
      cotizaciones: lista,
      cuenta: cuenta || undefined,
      cargando: Boolean(consultas[i]?.isPending),
      error: Boolean(consultas[i]?.isError),
      cortada: lista.length === LIMITE_COLUMNA
    };
  });
  const sinNinguna = conteos && !responsableId && ESTADOS.every((e) => conteos[e.estado].cantidad === 0);

  const nueva = () => {
    setAbiertaId(null);
    setEditor({ tipo: "crear" });
  };

  return (
    <AppShell
      titulo="Cotizaciones"
      encabezado={
        <EncabezadoPagina
          titulo="Cotizaciones"
          subtitulo="Qué se ha propuesto, a quién, por cuánto y en qué quedó."
          acciones={
            !editor && (
              <Button className="w-full md:w-auto" onClick={nueva}>
                + Nueva cotización
              </Button>
            )
          }
        />
      }
    >
      {editor ? (
        <EditorCotizacion
          key={editor.tipo === "version" ? `v-${editor.base.id}` : "nueva"}
          modo={editor}
          onCerrar={() => setEditor(null)}
          onGuardada={(id) => {
            // Se abre la que se acaba de guardar, con el tablero completo atrás.
            setEstado("");
            setAbiertaId(id);
          }}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Contadores conteos={conteos} estado={estado} onEstado={(e) => setEstado(estado === e ? "" : e)} />

          <div className="flex flex-wrap items-center gap-2.5">
            <CajaBusqueda placeholder="Buscar por empresa, oportunidad o folio…" valor={texto} onCambiar={setTexto} />
            {estado && (
              <button type="button" onClick={() => setEstado("")} className="flex h-10 items-center gap-1.5 rounded-[11px] border border-border bg-card px-3 text-[13px] font-semibold text-ink-2 hover:text-strong">
                Estado <b className="text-strong">{ESTADOS.find((e) => e.estado === estado)?.titulo}</b>
                <Icono nombre="cerrar" size={13} />
              </button>
            )}
            {esAdminOSupervisor && (
              <select aria-label="Responsable" className={`${inputBaseClass} h-10 w-auto max-w-[220px]`} value={responsableId} onChange={(e) => setResponsableId(e.target.value)}>
                <option value="">Responsable: Todos</option>
                {personas?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
            )}
            <select aria-label="Ordenar" className={`${inputBaseClass} h-10 w-auto md:ml-auto`} value={orden} onChange={(e) => setOrden(e.target.value as Orden)}>
              <option value="reciente">Ordenar: Movidas hace poco</option>
              <option value="envio">Ordenar: Enviada más reciente</option>
              <option value="total">Ordenar: Total más alto</option>
            </select>
          </div>

          {sinNinguna ? (
            <EstadoVacio
              className="tarjeta-blanca p-5"
              titulo="Todavía no hay cotizaciones."
              texto="Con + Nueva cotización se elige la empresa, su oportunidad y las partidas."
              accion={<Button onClick={nueva}>+ Nueva cotización</Button>}
            />
          ) : (
            <TableroCotizaciones columnas={columnas} verResponsable={esAdminOSupervisor} nombreMotivo={nombreMotivo} onAbrir={(c) => setAbiertaId(c.id)} onNueva={nueva} />
          )}
        </div>
      )}

      <PanelLateral
        abierto={abiertaId !== null}
        onCerrar={() => setAbiertaId(null)}
        ancho={860}
        encabezado={
          abiertaId !== null && (
            <EncabezadoCotizacion
              id={abiertaId}
              onNuevaVersion={(base) => {
                setAbiertaId(null);
                setEditor({ tipo: "version", base });
              }}
            />
          )
        }
        cuerpoClassName="!p-0 bg-soft"
      >
        {abiertaId !== null && <CuerpoCotizacion id={abiertaId} onVerVersion={setAbiertaId} />}
      </PanelLateral>
    </AppShell>
  );
}

// Contadores por estado (filtran el tablero) y la tasa de aceptación.
function Contadores({ conteos: c, estado, onEstado }: { conteos: ConteosCotizaciones | undefined; estado: EstadoTablero | ""; onEstado: (e: EstadoTablero) => void }) {
  const $ = (total: string) => compacto.format(Number(total));
  const detalle: Record<EstadoTablero, string> = c
    ? {
        borrador: `${$(c.borrador.total)} sin enviar`,
        enviada: `${$(c.enviada.total)} esperan respuesta`,
        aceptada: `${$(c.aceptadas_este_mes.total)} este mes`,
        rechazada: $(c.rechazada.total),
        vencida: "pasó su cierre"
      }
    : { borrador: "", enviada: "", aceptada: "", rechazada: "", vencida: "" };
  const tasa = c?.tasa_aceptacion;
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 md:gap-3 xl:grid-cols-6">
      {ESTADOS.map((e) => (
        <Contador
          key={e.estado}
          etiqueta={e.titulo}
          valor={c ? c[e.estado].cantidad : "…"}
          detalle={detalle[e.estado] || undefined}
          tono={TONO_ESTADO_COTIZACION[e.estado]}
          seleccionado={estado === e.estado}
          onClick={() => onEstado(e.estado)}
        />
      ))}
      <div className="relative overflow-hidden rounded-[18px] bg-[linear-gradient(135deg,#101733,#2a449b_80%,#5b2d86_140%)] px-4 pb-4 pt-3.5 text-white">
        <div className="font-heading text-[11px] font-extrabold uppercase tracking-[1.5px] text-white/70">Tasa de aceptación</div>
        <div className="mono mt-1.5 bg-[linear-gradient(90deg,var(--mint),var(--cyan))] bg-clip-text font-display text-[34px] leading-none text-transparent">
          {!tasa ? "…" : tasa.pct == null ? "—" : `${Math.round(tasa.pct)}%`}
        </div>
        <div className="mt-2 truncate text-[12px] text-white/70">{!tasa ? "" : tasa.respondidas === 0 ? "nadie ha respondido todavía" : `${tasa.aceptadas} de ${tasa.respondidas} respondidas`}</div>
      </div>
    </div>
  );
}
