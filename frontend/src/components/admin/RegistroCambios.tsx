import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Button } from "../ui/Button";
import { Field, inputClass } from "../ui/Field";
import { Icono } from "../ui/Icono";
import { Paginacion } from "../ui/Paginacion";
import { ApiError, api } from "../../lib/api";
import { RANGOS_RAPIDOS, accionesDelTipo, cambiarTipo, diaMx, errorDeRango, filtrosIniciales, hayFiltros, horaMx, parametrosRegistro, rangoActivo, rangoRapido, urlExportar, type FiltrosRegistro, type OpcionesFiltros } from "../../lib/registro-cambios";
import type { FilaRegistro, TipoRegistro } from "../../types";

// Registro de cambios (punto 53; captura administracion-registro-cambios.png):
// quién movió qué, solo administradores. El trabajo del día (tareas,
// correos, respuestas) NO va aquí: está en Reportes → Día. Filtros por tipo,
// fechas, persona, acción y búsqueda (6-nov-2026). Exportar vive aquí junto a
// los filtros porque baja exactamente lo filtrado (lib/registro-cambios.ts).

const TIPOS: { valor: FiltrosRegistro["tipo"]; etiqueta: string }[] = [
  { valor: "todo", etiqueta: "Todo" },
  { valor: "usuarios_roles", etiqueta: "Usuarios y roles" },
  { valor: "ediciones", etiqueta: "Ediciones" },
  { valor: "borrados", etiqueta: "Borrados" },
  { valor: "descargas", etiqueta: "Descargas" },
  { valor: "configuracion", etiqueta: "Configuración" }
];

const ICONO_TIPO: Record<TipoRegistro, { d: string; clase: string }> = {
  usuarios_roles: { d: "M12 8a3.5 3.5 0 1 0 0-.001 M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7", clase: "bg-[rgba(91,45,134,0.12)] text-purple" },
  ediciones: { d: "M4 20h4L19 9l-4-4L4 16z M14 6l4 4", clase: "bg-navy-bg text-navy" },
  borrados: { d: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13", clase: "bg-danger-bg text-danger" },
  descargas: { d: "M12 4v11 M7.5 10.5 12 15l4.5-4.5 M5 19h14", clase: "bg-info-bg text-info" },
  configuracion: { d: "M12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6z M19 12h2 M3 12h2 M12 3v2 M12 19v2 M5.6 5.6l1.4 1.4 M17 17l1.4 1.4 M5.6 18.4 7 17 M17 7l1.4-1.4", clase: "bg-soft text-ink-2" }
};

const LIMIT = 30;
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function RegistroCambios() {
  const [filtros, setFiltros] = useState(() => filtrosIniciales(new Date()));
  const [texto, setTexto] = useState("");
  const [page, setPage] = useState(1);
  const [exportando, setExportando] = useState<"pdf" | "csv" | null>(null);
  const [errorExport, setErrorExport] = useState<string | null>(null);

  function cambiar(nuevos: FiltrosRegistro) {
    setFiltros(nuevos);
    setPage(1);
  }

  useEffect(() => {
    const t = setTimeout(() => {
      if (texto.trim() !== filtros.q) {
        setFiltros({ ...filtros, q: texto.trim() });
        setPage(1);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [texto, filtros]);

  // Con las fechas a medias no se consulta ni se exporta: ver errorDeRango.
  const problemaRango = errorDeRango(filtros);
  const query = { ...parametrosRegistro(filtros), page, limit: LIMIT };
  const { data, isPending, isError } = useQuery({
    queryKey: ["admin", "registro", query],
    queryFn: () => api.get<{ page: number; limit: number; total: number; data: FilaRegistro[] }>("/api/v1/admin/registro-cambios", query),
    enabled: problemaRango === null
  });
  const { data: opciones } = useQuery({
    queryKey: ["admin", "registro-filtros"],
    queryFn: () => api.get<OpcionesFiltros>("/api/v1/admin/registro-cambios/filtros")
  });
  const acciones = opciones?.acciones ?? [];

  async function exportar(formato: "pdf" | "csv") {
    setExportando(formato);
    setErrorExport(null);
    try {
      await api.descargar(urlExportar(filtros, formato));
    } catch (err) {
      setErrorExport(err instanceof ApiError ? err.message : "No se pudo exportar");
    } finally {
      setExportando(null);
    }
  }

  const ahora = new Date();
  const hoy = diaMx(ahora);
  const atajo = rangoActivo(filtros, ahora);
  const porDia = new Map<string, FilaRegistro[]>();
  for (const f of data?.data ?? []) {
    const dia = diaMx(new Date(f.fecha));
    porDia.set(dia, [...(porDia.get(dia) ?? []), f]);
  }

  return (
    <section className="tarjeta-blanca overflow-hidden !rounded-[18px]">
      <header className="flex flex-wrap items-baseline gap-2 border-b border-border px-4 py-3.5 md:px-5">
        <h2 className="font-heading text-[15px] font-extrabold text-strong">Registro de cambios</h2>
        <span className="text-[12.5px] text-ink-3">quién movió qué · solo administradores</span>
        {data && <span className="ml-auto text-[12px] text-ink-3">{data.total.toLocaleString("es-MX")} en total</span>}
      </header>
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 md:px-5">
        <div className="flex flex-wrap items-center gap-2">
          {TIPOS.map((t) => (
            <button
              key={t.valor}
              type="button"
              aria-pressed={filtros.tipo === t.valor}
              onClick={() => cambiar(cambiarTipo(filtros, t.valor, acciones))}
              className={clsx("rounded-full border px-3 py-1.5 text-[12.5px] font-bold", filtros.tipo === t.valor ? "border-strong bg-strong text-card" : "border-border bg-card text-ink-2 hover:text-strong")}
            >
              {t.etiqueta}
            </button>
          ))}
          <label className="flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-[10px] border border-border bg-card px-3 text-ink-3 md:ml-auto md:max-w-[260px]">
            <Icono nombre="buscar" size={15} />
            <input aria-label="Buscar en el registro" placeholder="Buscar usuario o registro…" className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none" value={texto} onChange={(e) => setTexto(e.target.value)} />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 [&>div]:min-w-0">
          <Field label="Desde" htmlFor="registro-desde">
            <input id="registro-desde" type="date" max={hoy} className={inputClass} value={filtros.desde} onChange={(e) => cambiar({ ...filtros, desde: e.target.value })} />
          </Field>
          <Field label="Hasta" htmlFor="registro-hasta">
            <input id="registro-hasta" type="date" max={hoy} className={inputClass} value={filtros.hasta} onChange={(e) => cambiar({ ...filtros, hasta: e.target.value })} />
          </Field>
          <Field label="Persona" htmlFor="registro-persona">
            <select id="registro-persona" className={inputClass} value={filtros.usuarioId ?? ""} onChange={(e) => cambiar({ ...filtros, usuarioId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Todas</option>
              {opciones?.personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                  {p.activo ? "" : " (desactivado)"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Acción" htmlFor="registro-accion">
            <select id="registro-accion" className={inputClass} value={filtros.accion} onChange={(e) => cambiar({ ...filtros, accion: e.target.value })}>
              <option value="">Todas</option>
              {TIPOS.filter((t) => t.valor !== "todo" && (filtros.tipo === "todo" || filtros.tipo === t.valor)).map((t) => (
                <optgroup key={t.valor} label={t.etiqueta}>
                  {accionesDelTipo(acciones, t.valor).map((a) => (
                    <option key={a.clave} value={a.clave}>
                      {a.etiqueta}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {RANGOS_RAPIDOS.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={atajo === r.id}
              onClick={() => cambiar({ ...filtros, ...rangoRapido(r.id, new Date()) })}
              className={clsx("rounded-[8px] border px-2.5 py-1 text-[12px] font-bold", atajo === r.id ? "border-navy bg-navy-bg text-navy" : "border-border bg-card text-ink-2 hover:text-strong")}
            >
              {r.etiqueta}
            </button>
          ))}
          {hayFiltros(filtros, ahora) && (
            <button
              type="button"
              onClick={() => {
                setTexto("");
                cambiar(filtrosIniciales(new Date()));
              }}
              className="px-1 text-[12px] font-bold text-info hover:underline"
            >
              Quitar filtros
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden font-heading text-[10.5px] font-extrabold uppercase tracking-[1.5px] text-ink-3 md:inline">Exportar lo filtrado</span>
            <Button className="!px-3 !py-1.5 !text-[12.5px]" disabled={exportando !== null || problemaRango !== null} onClick={() => void exportar("pdf")}>
              <Icono nombre="descargar" size={14} /> {exportando === "pdf" ? "…" : "PDF"}
            </Button>
            <Button variant="outline" className="!px-3 !py-1.5 !text-[12.5px]" disabled={exportando !== null || problemaRango !== null} onClick={() => void exportar("csv")}>
              <Icono nombre="descargar" size={14} /> {exportando === "csv" ? "…" : "CSV"}
            </Button>
          </div>
        </div>
        {problemaRango && <p className="text-[12.5px] font-bold text-danger">{problemaRango}</p>}
        {errorExport && <p className="rounded-[10px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">{errorExport}</p>}
      </div>

      {!problemaRango && isPending && <p className="p-5 text-[13px] text-ink-3">Cargando…</p>}
      {isError && <p className="p-5 text-[13px] text-danger">No se pudo cargar el registro.</p>}
      {data && data.data.length === 0 && <p className="p-5 text-[13px] text-ink-2">No hay cambios con esos filtros.</p>}
      {[...porDia.entries()].map(([dia, filas]) => (
        <div key={dia}>
          <div className="border-y border-border bg-soft px-4 py-2 font-heading text-[11px] font-extrabold uppercase tracking-[1.5px] text-ink-3 md:px-5">{etiquetaDia(dia, ahora)}</div>
          <ul>
            {filas.map((f) => (
              <Fila key={f.id} f={f} />
            ))}
          </ul>
        </div>
      ))}
      {data && <Paginacion page={page} limit={LIMIT} cantidad={data.data.length} onPage={setPage} />}
      <p className="m-4 rounded-[12px] bg-soft px-4 py-2.5 text-[12.5px] text-ink-2">
        El trabajo del día (tareas cerradas, correos, respuestas, bajas) no va aquí: está en{" "}
        <Link to="/reportes?periodo=dia" className="font-bold text-info hover:underline">
          Reportes → Día
        </Link>
        .
      </p>
    </section>
  );
}

function Fila({ f }: { f: FilaRegistro }) {
  const [viendo, setViendo] = useState(false);
  const icono = ICONO_TIPO[f.tipo];
  return (
    <li className="grid grid-cols-[58px_34px_1fr] items-start gap-2.5 border-t border-border px-4 py-3.5 first:border-t-0 md:grid-cols-[70px_36px_1fr] md:px-5">
      <span className="pt-1 text-[12px] text-ink-3">{horaMx(new Date(f.fecha))}</span>
      <span className={clsx("grid h-8 w-8 place-items-center rounded-[10px]", icono.clase)}>
        <Icono d={icono.d} size={15} />
      </span>
      <div className="min-w-0">
        <p className="text-[13.5px] text-ink">
          {f.texto}
          {f.antes && (
            <button type="button" onClick={() => setViendo((v) => !v)} className="ml-1.5 font-bold text-info hover:underline">
              {viendo ? "Ocultar" : "Ver cómo estaba"}
            </button>
          )}
        </p>
        {f.cambios.length > 0 && (
          <dl className="mt-2 flex flex-col gap-1.5">
            {f.cambios.map((c) => (
              <div key={c.campo} className="flex flex-wrap items-center gap-2 text-[12px]">
                <dt className="w-28 shrink-0 font-heading text-[10.5px] font-extrabold uppercase tracking-[1px] text-ink-3">{c.etiqueta}</dt>
                <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="rounded-[6px] bg-danger-bg px-1.5 py-0.5 text-danger line-through">{c.antes}</span>
                  <span className="text-ink-3">→</span>
                  <span className="rounded-[6px] bg-ok-bg px-1.5 py-0.5 font-bold text-ok">{c.despues}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
        {viendo && f.antes && (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-[10px] border border-border bg-soft px-3 py-2 text-[12px]">
            {Object.entries(f.antes).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-3">{k.replace(/_/g, " ")}</dt>
                <dd className="min-w-0 break-words text-ink">{v == null || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </li>
  );
}

function etiquetaDia(dia: string, ahora: Date) {
  const [a, m, d] = dia.split("-").map(Number);
  const fecha = new Date(a, m - 1, d);
  const ayer = new Date(ahora);
  ayer.setDate(ayer.getDate() - 1);
  const prefijo = dia === diaMx(ahora) ? "Hoy" : dia === diaMx(ayer) ? "Ayer" : DIAS[fecha.getDay()];
  return `${prefijo} · ${d} ${MESES[m - 1]}`;
}
