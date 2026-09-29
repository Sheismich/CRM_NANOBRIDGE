import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card } from "../ui/Card";
import { inputBaseClass } from "../ui/Field";
import { Paginacion } from "../ui/Paginacion";
import { api } from "../../lib/api";
import { formatoFechaHora } from "../../lib/formato";
import type { Paginated, RegistroAuditoria, Usuario } from "../../types";

// Auditoría (AuditoriaController, admin/supervisor): solo lectura, lo más
// reciente primero. Los valores de los filtros son los que el backend
// escribe hoy (entidad/accion en los insert(auditoria) de src/, incluida
// ACCION_CAMBIO_ESTADO_POR_CLASIFICACION de shared/clasificacion-respuesta.ts).
// Si el backend agrega una acción nueva, hay que sumarla aquí.

const LIMIT = 50;
const ENTIDADES: Record<string, string> = {
  actividad: "Actividad",
  contacto: "Contacto",
  cotizacion: "Cotización",
  documento: "Documento",
  empresa: "Empresa",
  evento_pendiente: "Evento pendiente",
  medio_contacto: "Medio de contacto",
  oportunidad: "Oportunidad",
  proceso_fallido: "Proceso fallido",
  prospecto: "Prospecto",
  respuesta: "Respuesta",
  tarea: "Tarea",
  usuario: "Usuario"
};
const ACCIONES = [
  "actualizar",
  "asignar",
  "cambiar_estado",
  "cambiar_estado_automatizacion",
  "cambiar_estado_por_clasificacion",
  "cambiar_etapa",
  "cerrar",
  "clasificar",
  "clasificar_respuesta",
  "crear",
  "desactivar",
  "descargar",
  "eliminar",
  "importar_borrador",
  "nueva_version",
  "reabrir",
  "registrar_automatizacion",
  "registrar_supresion",
  "reintentar",
  "revisar",
  "subir",
  "validar_automatizacion"
];

// "desde"/"hasta" del backend son datetime ISO completos: el día elegido se
// toma completo en la zona del navegador.
function inicioDelDia(fecha: string) {
  return new Date(`${fecha}T00:00:00`).toISOString();
}
function finDelDia(fecha: string) {
  return new Date(`${fecha}T23:59:59.999`).toISOString();
}

export function AuditoriaAdmin() {
  const [entidad, setEntidad] = useState("");
  const [accion, setAccion] = useState("");
  const [usuarioId, setUsuarioId] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [page, setPage] = useState(1);
  const [abiertoId, setAbiertoId] = useState<number | null>(null);

  const filtros = {
    entidad: entidad || undefined,
    accion: accion || undefined,
    usuario_id: usuarioId || undefined,
    desde: desde ? inicioDelDia(desde) : undefined,
    hasta: hasta ? finDelDia(hasta) : undefined,
    page,
    limit: LIMIT
  };
  const rangoInvalido = Boolean(desde && hasta && desde > hasta);
  const { data, isPending, isError } = useQuery({
    queryKey: ["auditoria", filtros],
    queryFn: () => api.get<Paginated<RegistroAuditoria>>("/api/v1/auditoria", filtros),
    enabled: !rangoInvalido
  });
  const { data: usuarios } = useQuery({
    queryKey: ["usuarios", "todos"],
    queryFn: () => api.get<Paginated<Usuario>>("/api/v1/usuarios", { limit: 100 }),
    staleTime: 5 * 60_000
  });
  const nombreDe = (id: number | null) => (id == null ? "Automatización" : (usuarios?.data.find((u) => u.id === id)?.nombre ?? `Usuario ${id}`));

  function cambiar(setter: (v: string) => void) {
    return (v: string) => {
      setPage(1);
      setAbiertoId(null);
      setter(v);
    };
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end gap-3 px-5 py-3.5">
        <select aria-label="Entidad" className={`${inputBaseClass} w-auto`} value={entidad} onChange={(e) => cambiar(setEntidad)(e.target.value)}>
          <option value="">Entidad: Todas</option>
          {Object.entries(ENTIDADES).map(([clave, etiqueta]) => (
            <option key={clave} value={clave}>
              {etiqueta}
            </option>
          ))}
        </select>
        <select aria-label="Acción" className={`${inputBaseClass} w-auto`} value={accion} onChange={(e) => cambiar(setAccion)(e.target.value)}>
          <option value="">Acción: Todas</option>
          {ACCIONES.map((a) => (
            <option key={a} value={a}>
              {a.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <select aria-label="Usuario" className={`${inputBaseClass} w-auto`} value={usuarioId} onChange={(e) => cambiar(setUsuarioId)(e.target.value)}>
          <option value="">Usuario: Todos</option>
          {usuarios?.data.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nombre}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs text-ink-2">
          Desde
          <input type="date" className={`${inputBaseClass} w-auto`} value={desde} onChange={(e) => cambiar(setDesde)(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-2">
          Hasta
          <input type="date" className={`${inputBaseClass} w-auto`} value={hasta} onChange={(e) => cambiar(setHasta)(e.target.value)} />
        </label>
      </div>

      {rangoInvalido && <div className="px-5 pb-4 text-sm text-danger">La fecha "desde" debe ser anterior o igual a "hasta".</div>}
      {!rangoInvalido && isPending && <div className="p-5 text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="p-5 text-sm text-danger">No se pudo cargar la auditoría.</div>}
      {data && data.data.length === 0 && <div className="p-5 text-sm text-ink-3">No hay registros con ese filtro.</div>}
      {data && data.data.length > 0 && (
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-bg">
              {["Fecha", "Usuario", "Entidad", "Acción", "Cambio"].map((h) => (
                <th key={h} className="px-5 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-ink-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.data.map((r) => (
              <Fragment key={r.id}>
                <tr className={`cursor-pointer border-t border-border hover:bg-bg ${abiertoId === r.id ? "bg-bg" : ""}`} onClick={() => setAbiertoId(abiertoId === r.id ? null : r.id)}>
                  <td className="whitespace-nowrap px-5 py-3 text-[13px] text-ink-2">{formatoFechaHora.format(new Date(r.creado_en))}</td>
                  <td className="px-5 py-3 text-[13px]">{nombreDe(r.usuario_id)}</td>
                  <td className="px-5 py-3 text-[13px]">
                    {r.entidad === "empresa" ? (
                      <Link to={`/empresas/${r.entidad_id}`} className="hover:text-navy hover:underline" onClick={(e) => e.stopPropagation()}>
                        Empresa #{r.entidad_id}
                      </Link>
                    ) : (
                      `${ENTIDADES[r.entidad] ?? r.entidad} #${r.entidad_id}`
                    )}
                  </td>
                  <td className="px-5 py-3 text-[13px] text-ink-2">{r.accion.replace(/_/g, " ")}</td>
                  <td className="max-w-md truncate px-5 py-3 font-mono text-xs text-ink-3">{resumenCambio(r)}</td>
                </tr>
                {abiertoId === r.id && (
                  <tr>
                    <td colSpan={5} className="bg-bg p-0">
                      <div className="grid grid-cols-1 gap-4 border-t border-border p-5 md:grid-cols-2">
                        <Json titulo="Antes" valor={r.antes} />
                        <Json titulo="Después" valor={r.despues} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      {data && <Paginacion page={page} limit={LIMIT} cantidad={data.data.length} onPage={setPage} />}
    </Card>
  );
}

// Una línea legible del cambio: "estado: abierto → resuelto" cuando antes y
// después comparten claves; si no, el "después" compacto.
function resumenCambio(r: RegistroAuditoria) {
  const antes = r.antes && typeof r.antes === "object" ? (r.antes as Record<string, unknown>) : null;
  const despues = r.despues && typeof r.despues === "object" ? (r.despues as Record<string, unknown>) : null;
  if (antes && despues) {
    const partes = Object.keys(despues)
      .filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(despues[k]))
      .map((k) => `${k}: ${JSON.stringify(antes[k] ?? null)} → ${JSON.stringify(despues[k])}`);
    if (partes.length) return partes.join(" · ");
  }
  return despues ? JSON.stringify(despues) : "—";
}

function Json({ titulo, valor }: { titulo: string; valor: unknown }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-2">{titulo}</div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-[9px] border border-border bg-white p-3 font-mono text-xs text-ink">{valor == null ? "—" : JSON.stringify(valor, null, 2)}</pre>
    </div>
  );
}
