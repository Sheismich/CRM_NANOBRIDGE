import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { AppShell } from "../components/layout/AppShell";
import { OportunidadDetallePanel } from "../components/ficha/OportunidadDetallePanel";
import { NuevaOportunidadPanel } from "../components/inicio/NuevaOportunidadPanel";
import { TableroOportunidades, type Columna } from "../components/oportunidades/TableroOportunidades";
import { InformeEjecutivo } from "../components/reportes/InformeEjecutivo";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { CajaBusqueda } from "../components/ui/CajaBusqueda";
import { EncabezadoPagina } from "../components/ui/EncabezadoPagina";
import { EstadoVacio, LigaAccion } from "../components/ui/EstadoVacio";
import { inputBaseClass } from "../components/ui/Field";
import { Icono } from "../components/ui/Icono";
import { LogoEmpresa } from "../components/ui/LogoEmpresa";
import { MarcaDeAgua } from "../components/ui/MarcaDeAgua";
import { Paginacion } from "../components/ui/Paginacion";
import { PanelLateral } from "../components/ui/PanelLateral";
import { Pastilla } from "../components/ui/Pastilla";
import { Segmento } from "../components/ui/Segmento";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { fechaLocal, formatoFecha, formatoMonedaEntera } from "../lib/formato";
import type { CatalogosOportunidad, ConversionConCiclo, OportunidadTablero, Paginated, Usuario } from "../types";

// Oportunidades del rediseño (docs/diseno/oportunidades.html, tablero +
// embudo): lo que se puede cerrar, cuánto vale y qué tan probable es.
// Arriba la franja de números, luego el tablero por etapa (se arrastra para
// cambiar de etapa) y abajo la conversión con el informe ejecutivo (de
// Fabián; solo admin y supervisor). Un agente solo ve las suyas (lo filtra
// el backend). La franja se calcula con lo cargado en el tablero, así sale
// igual para todos los roles y respeta el filtro de responsable.

// El backend permite hasta 100 por página: una consulta por etapa.
const LIMITE_COLUMNA = 100;
const LIMITE_CERRADAS = 25;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

type Cierre = "" | "este_mes" | "vencido" | "sin_fecha";
type Orden = "valor" | "cierre" | "dias";

export function OportunidadesPage() {
  const { user } = useAuth();
  const esAdminOSupervisor = user?.rol === "administrador" || user?.rol === "supervisor";
  const [vista, setVista] = useState<"abiertas" | "cerradas">("abiertas");
  const [responsableId, setResponsableId] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [cierre, setCierre] = useState<Cierre>("");
  const [orden, setOrden] = useState<Orden>("valor");
  const [abierta, setAbierta] = useState<OportunidadTablero | null>(null);
  const [creando, setCreando] = useState(false);

  const { data: catalogos } = useQuery({
    queryKey: ["oportunidades-catalogos"],
    queryFn: () => api.get<CatalogosOportunidad>("/api/v1/oportunidades/catalogos"),
    staleTime: Infinity
  });
  const { data: usuarios } = useQuery({
    queryKey: ["usuarios", "activos"],
    queryFn: () => api.get<Paginated<Usuario>>("/api/v1/usuarios", { activo: true, limit: 100 }),
    enabled: esAdminOSupervisor,
    staleTime: 5 * 60_000
  });
  const personas = usuarios?.data.filter((u) => u.rol !== "sistema");
  const etapas = (catalogos?.etapas ?? []).filter((e) => !e.es_cierre).sort((a, b) => a.orden - b.orden);

  const consultas = useQueries({
    queries: etapas.map((e) => ({
      queryKey: ["oportunidades", "tablero", e.clave, responsableId],
      queryFn: () => api.get<Paginated<OportunidadTablero>>("/api/v1/oportunidades", { cerrada: "false", etapaClave: e.clave, responsableId: responsableId || undefined, limit: LIMITE_COLUMNA })
    }))
  });
  // Ganadas del mes (para la franja): las cerradas más recientes, filtradas aquí.
  const { data: cerradasRecientes } = useQuery({
    queryKey: ["oportunidades", "cerradas", { responsableId, limit: 100 }],
    queryFn: () => api.get<Paginated<OportunidadTablero>>("/api/v1/oportunidades", { cerrada: "true", responsableId: responsableId || undefined, limit: 100 })
  });
  // Conversión y ciclo de venta: es un reporte (admin y supervisor).
  const { data: conversion } = useQuery({
    queryKey: ["reportes", "pipeline/conversion-etapas", { responsableId }],
    queryFn: () => api.get<ConversionConCiclo>("/api/v1/reportes/pipeline/conversion-etapas", { responsableId: responsableId || undefined }),
    enabled: esAdminOSupervisor
  });

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const todas = consultas.flatMap((c) => c.data?.data ?? []);
  const pasaFiltros = (o: OportunidadTablero) => {
    const q = busqueda.trim().toLowerCase();
    if (q && !o.titulo.toLowerCase().includes(q) && !(o.empresa_nombre ?? "").toLowerCase().includes(q)) return false;
    if (cierre === "sin_fecha") return !o.fecha_cierre_estimada;
    if (!o.fecha_cierre_estimada) return cierre === "";
    const f = fechaLocal(o.fecha_cierre_estimada);
    if (cierre === "vencido") return f < hoy;
    if (cierre === "este_mes") return f >= hoy && f.getMonth() === hoy.getMonth() && f.getFullYear() === hoy.getFullYear();
    return true;
  };
  const ordenar = (lista: OportunidadTablero[]) =>
    [...lista].sort((a, b) => {
      if (orden === "cierre") return (a.fecha_cierre_estimada ?? "9999").localeCompare(b.fecha_cierre_estimada ?? "9999");
      if (orden === "dias") return (b.dias_en_etapa ?? -1) - (a.dias_en_etapa ?? -1);
      return Number(b.valor_estimado ?? 0) - Number(a.valor_estimado ?? 0);
    });
  const columnas: Columna[] = etapas.map((etapa, i) => ({
    etapa,
    oportunidades: ordenar((consultas[i]?.data?.data ?? []).filter(pasaFiltros)),
    cargando: Boolean(consultas[i]?.isPending),
    error: Boolean(consultas[i]?.isError)
  }));
  const cargado = consultas.length > 0 && consultas.every((c) => c.isSuccess);
  const sinNinguna = cargado && !responsableId && todas.length === 0;

  return (
    <AppShell
      titulo="Oportunidades"
      encabezado={
        <EncabezadoPagina
          titulo="Oportunidades"
          subtitulo="Lo que se puede cerrar, cuánto vale y qué tan probable es."
          acciones={
            <>
              <Segmento
                etiqueta="Vista"
                valor={vista}
                onCambiar={setVista}
                opciones={[
                  { id: "abiertas", texto: "Abiertas", cuenta: cargado ? todas.length : undefined },
                  { id: "cerradas", texto: "Ganadas y perdidas" }
                ]}
              />
              <Button className="w-full md:w-auto" onClick={() => setCreando(true)}>
                + Nueva oportunidad
              </Button>
            </>
          }
        />
      }
    >
      <div className="flex flex-col gap-4">
        {vista === "abiertas" && <Franja abiertas={todas} cerradas={cerradasRecientes?.data} cargado={cargado} hoy={hoy} />}

        <div className="flex flex-wrap items-center gap-2.5">
          <CajaBusqueda placeholder="Buscar oportunidad o empresa…" valor={busqueda} onCambiar={setBusqueda} />
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
          {vista === "abiertas" && (
            <>
              <select aria-label="Cierre" className={`${inputBaseClass} h-10 w-auto`} value={cierre} onChange={(e) => setCierre(e.target.value as Cierre)}>
                <option value="">Cierre: Cualquiera</option>
                <option value="este_mes">Cierra este mes</option>
                <option value="vencido">Cierre vencido</option>
                <option value="sin_fecha">Sin fecha de cierre</option>
              </select>
              <select aria-label="Ordenar" className={`${inputBaseClass} h-10 w-auto md:ml-auto`} value={orden} onChange={(e) => setOrden(e.target.value as Orden)}>
                <option value="valor">Ordenar: Valor</option>
                <option value="cierre">Ordenar: Cierre más próximo</option>
                <option value="dias">Ordenar: Más días en etapa</option>
              </select>
            </>
          )}
        </div>

        {vista === "abiertas" && (
          <>
            {!catalogos && <div className="text-sm text-ink-2">Cargando…</div>}
            {sinNinguna && (
              <EstadoVacio
                className="tarjeta-blanca p-5"
                titulo="Todavía no hay oportunidades abiertas."
                texto="Créala con + Nueva oportunidad, desde la ficha de su empresa o al armar una cotización."
                accion={<LigaAccion to="/empresas">Ir a Empresas</LigaAccion>}
              />
            )}
            {catalogos && etapas.length > 0 && <TableroOportunidades columnas={columnas} catalogos={catalogos} verResponsable={esAdminOSupervisor} onAbrir={setAbierta} />}
            {/* Informe ejecutivo (Fabián, 13-oct-2026) dentro de la franja de
                conversión, como el diseño; el componente es de Fabián. */}
            {esAdminOSupervisor && <Conversion datos={conversion} extra={<InformeEjecutivo enFranja responsableId={responsableId || undefined} className="md:ml-auto" />} />}
          </>
        )}
        {vista === "cerradas" && <Cerradas responsableId={responsableId} busqueda={busqueda} verResponsable={esAdminOSupervisor} onAbrir={setAbierta} />}
      </div>

      <PanelLateral
        abierto={abierta !== null}
        onCerrar={() => setAbierta(null)}
        encabezado={
          abierta && (
            <div className="min-w-0">
              <h2 className="pt-1 font-heading text-[18px] font-black text-strong">{abierta.titulo}</h2>
              <Link to={`/empresas/${abierta.empresa_id}?tab=oportunidades`} className="text-[13px] font-semibold text-navy hover:underline">
                {abierta.empresa_nombre ?? "Ver la empresa"} ›
              </Link>
            </div>
          )
        }
        cuerpoClassName="!p-0"
      >
        {abierta && <OportunidadDetallePanel enPanel id={abierta.id} onClose={() => setAbierta(null)} />}
      </PanelLateral>
      <NuevaOportunidadPanel abierto={creando} onCerrar={() => setCreando(false)} />
    </AppShell>
  );
}

// Franja de números (diseño: blanca de día, degradado de noche, con la N).
function Franja({ abiertas, cerradas, cargado, hoy }: { abiertas: OportunidadTablero[]; cerradas: OportunidadTablero[] | undefined; cargado: boolean; hoy: Date }) {
  const valor = (o: OportunidadTablero) => Number(o.valor_estimado ?? 0);
  const pipeline = abiertas.reduce((s, o) => s + valor(o), 0);
  const ponderado = abiertas.reduce((s, o) => s + (valor(o) * o.probabilidad) / 100, 0);
  const esteMesLista = abiertas.filter((o) => {
    if (!o.fecha_cierre_estimada) return false;
    const f = fechaLocal(o.fecha_cierre_estimada);
    return f >= hoy && f.getMonth() === hoy.getMonth() && f.getFullYear() === hoy.getFullYear();
  });
  const vencidas = abiertas.filter((o) => o.fecha_cierre_estimada && fechaLocal(o.fecha_cierre_estimada) < hoy);
  const ganadasMes = (cerradas ?? []).filter((o) => {
    if (o.etapa_clave !== "ganada") return false;
    const f = new Date(o.actualizado_en);
    return f.getMonth() === hoy.getMonth() && f.getFullYear() === hoy.getFullYear();
  });
  const n = (x: number) => (cargado ? x : "…");
  const $ = (x: number) => (cargado ? formatoMonedaEntera.format(x) : "…");

  return (
    <section className="tarjeta-blanca relative grid grid-cols-2 overflow-hidden !rounded-[22px] md:grid-cols-[1.4fr_repeat(4,1fr)] dark:border-white/10 dark:bg-[radial-gradient(600px_220px_at_100%_0,rgba(35,186,211,0.3),transparent_60%),linear-gradient(135deg,#101733,#2a449b_75%,#5b2d86_130%)]">
      <MarcaDeAgua className="-bottom-[70px] -right-[30px] w-[220px]" />
      <Numero etiqueta="Pipeline abierto" valor={$(pipeline)} detalle={`${n(abiertas.length)} ${abiertas.length === 1 ? "oportunidad" : "oportunidades"}`} grande className="col-span-2 md:col-span-1" />
      <Numero etiqueta="Ponderado" valor={$(ponderado)} detalle="por probabilidad" />
      <Numero etiqueta="Cierra este mes" valor={$(esteMesLista.reduce((s, o) => s + valor(o), 0))} detalle={`${n(esteMesLista.length)} ${esteMesLista.length === 1 ? "oportunidad" : "oportunidades"}`} />
      <Numero etiqueta="Cierre vencido" valor={n(vencidas.length)} detalle={vencidas.length > 0 ? "pasó su fecha · revisar" : "ninguna atrasada"} tono={vencidas.length > 0 ? "danger" : undefined} />
      <Numero
        etiqueta={`Ganado en ${MESES[hoy.getMonth()]}`}
        valor={cerradas ? formatoMonedaEntera.format(ganadasMes.reduce((s, o) => s + valor(o), 0)) : "…"}
        detalle={`${ganadasMes.length} ${ganadasMes.length === 1 ? "cerrada" : "cerradas"}`}
        tono="ok"
      />
    </section>
  );
}

function Numero({ etiqueta, valor, detalle, grande, tono, className }: { etiqueta: string; valor: ReactNode; detalle: ReactNode; grande?: boolean; tono?: "ok" | "danger"; className?: string }) {
  return (
    <div className={clsx("relative border-b border-r border-border px-4 py-4 md:border-b-0 md:px-[22px] md:py-[18px] dark:border-white/10 md:last:border-r-0", className)}>
      <small className="block font-heading text-[11px] font-extrabold uppercase tracking-[1px] text-ink-3 dark:text-white/60">{etiqueta}</small>
      <b
        className={clsx(
          "mono mt-1.5 block font-display font-normal leading-none",
          grande ? "bg-[linear-gradient(90deg,var(--navy),var(--purple))] bg-clip-text text-[34px] text-transparent md:text-[40px] dark:bg-none dark:text-white" : "text-[26px] md:text-[30px]",
          !grande && (tono === "ok" ? "text-ok" : tono === "danger" ? "text-danger" : "text-strong dark:text-white")
        )}
      >
        {valor}
      </b>
      <span className="mt-1 block text-[12px] text-ink-3 dark:text-white/60">{detalle}</span>
    </div>
  );
}

// Tasa de conversión y tiempo promedio para cerrar (conversion-etapas).
function Conversion({ datos, extra }: { datos: ConversionConCiclo | undefined; extra?: ReactNode }) {
  const ganada = datos?.etapas.find((e) => e.etapa_clave === "ganada");
  const tasa = ganada?.conversion_desde_calificada_pct ?? null;
  const dias = datos?.ciclo_medio_venta?.dias ?? null;
  const uno = tasa && tasa > 0 ? Math.max(1, Math.round(100 / tasa)) : null;
  return (
    <section className="flex flex-wrap items-center gap-4 rounded-[18px] border border-navy/15 bg-[color-mix(in_srgb,var(--navy)_7%,var(--card))] px-4 py-4 md:px-5">
      <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[13px] bg-[linear-gradient(135deg,#2a449b,#5b2d86)] text-white shadow-[0_8px_16px_-8px_rgba(42,68,155,0.8)]">
        <Icono nombre="tendencia" size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <b className="block text-[17px] font-extrabold text-strong">{datos ? `Tasa de conversión: ${tasa == null ? "—" : `${tasa}%`}` : "Tasa de conversión: …"}</b>
        <span className="text-[13px] text-ink-2">
          {uno ? `De las oportunidades calificadas, 1 de cada ${uno} se gana` : "Todavía no hay oportunidades calificadas para medirla"}
          {" · "}tiempo promedio para cerrar: <b className="text-strong">{dias == null ? "—" : `${Math.round(dias)} días`}</b>
        </span>
      </div>
      {extra}
    </section>
  );
}

function Cerradas({ responsableId, busqueda, verResponsable, onAbrir }: { responsableId: string; busqueda: string; verResponsable: boolean; onAbrir: (o: OportunidadTablero) => void }) {
  const [page, setPage] = useState(1);
  const filtros = { cerrada: "true", responsableId: responsableId || undefined, page, limit: LIMITE_CERRADAS };
  const { data, isPending, isError } = useQuery({
    queryKey: ["oportunidades", "cerradas", filtros],
    queryFn: () => api.get<Paginated<OportunidadTablero>>("/api/v1/oportunidades", filtros)
  });
  const q = busqueda.trim().toLowerCase();
  const filas = (data?.data ?? []).filter((o) => !q || o.titulo.toLowerCase().includes(q) || (o.empresa_nombre ?? "").toLowerCase().includes(q));

  return (
    <section className="tarjeta-blanca overflow-hidden">
      {isPending && <div className="p-5 text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="p-5 text-sm text-danger">No se pudieron cargar las oportunidades.</div>}
      {data && filas.length === 0 && <div className="p-5 text-sm text-ink-3">No hay oportunidades cerradas{responsableId || q ? " con ese filtro" : ""}.</div>}
      {filas.length > 0 && (
        <ul className="divide-y divide-border">
          {filas.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => onAbrir(o)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 text-left hover:bg-soft md:grid-cols-[minmax(0,2fr)_130px_140px_110px_minmax(0,1fr)] md:px-[18px]">
                <span className="flex min-w-0 items-center gap-3">
                  <LogoEmpresa id={o.empresa_id} nombre={o.empresa_nombre ?? o.titulo} tamano="chico" />
                  <span className="min-w-0">
                    <b className="block truncate text-[14px] text-strong">{o.titulo}</b>
                    <small className="block truncate text-[12px] text-ink-3">{o.empresa_nombre ?? `Empresa ${o.empresa_id}`}</small>
                  </span>
                </span>
                <Pastilla tono={o.etapa_clave === "ganada" ? "ok" : "danger"} punto className="justify-self-end md:justify-self-start">
                  {o.etapa_nombre}
                </Pastilla>
                <b className="mono text-[14px] text-strong">{o.valor_estimado ? formatoMonedaEntera.format(Number(o.valor_estimado)) : "—"}</b>
                <span className="text-[13px] text-ink-2 max-md:justify-self-end">{formatoFecha.format(new Date(o.actualizado_en))}</span>
                {verResponsable && (
                  <span className="hidden min-w-0 items-center gap-2 text-[13px] text-ink-2 md:flex">
                    <Avatar nombre={o.responsable_nombre} />
                    <span className="truncate">{o.responsable_nombre ?? "Sin responsable"}</span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && (page > 1 || data.data.length === LIMITE_CERRADAS) && (
        <div className="border-t border-border bg-soft">
          <Paginacion page={page} limit={LIMITE_CERRADAS} cantidad={data.data.length} onPage={setPage} />
        </div>
      )}
    </section>
  );
}
