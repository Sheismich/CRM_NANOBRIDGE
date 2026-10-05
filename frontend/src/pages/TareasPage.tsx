import { Fragment, useState, type ChangeEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../components/layout/AppShell";
import { ColaClasificacion } from "../components/tareas/ColaClasificacion";
import { NuevaTareaForm } from "../components/tareas/NuevaTareaForm";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ServerError, inputBaseClass, inputClass } from "../components/ui/Field";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { formatoFechaHora } from "../lib/formato";
import { CLASE_PRIORIDAD, ETIQUETA_CLASIFICACION, ETIQUETA_ESTADO_TAREA, ETIQUETA_PRIORIDAD, ETIQUETA_TIPO_TAREA, LIMITE_COLA, estaVencida, useColaClasificacion } from "../lib/tareas";
import type { Paginated, Tarea, Usuario } from "../types";

// Tareas (PLAN_FRONTEND.md §5): bandeja para todos (un agente solo ve las
// suyas, lo filtra el backend) y cola de clasificación solo para
// administrador/supervisor, los únicos que clasifican. ?tab=cola abre la
// cola directo (liga desde el Inicio).
export function TareasPage() {
  const { user } = useAuth();
  const esAdminOSupervisor = user?.rol === "administrador" || user?.rol === "supervisor";
  const [params, setParams] = useSearchParams();
  const tab = esAdminOSupervisor && params.get("tab") === "cola" ? "cola" : "bandeja";
  const { data: cola } = useColaClasificacion(1, esAdminOSupervisor);
  const pendientesCola = cola?.data.length ?? 0;

  const tabs = [
    { id: "bandeja", label: esAdminOSupervisor ? "Bandeja" : "Mis tareas" },
    ...(esAdminOSupervisor ? [{ id: "cola", label: `Cola de clasificación${pendientesCola ? ` (${pendientesCola}${pendientesCola >= LIMITE_COLA ? "+" : ""})` : ""}` }] : [])
  ];

  return (
    <AppShell titulo="Tareas">
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setParams(t.id === "cola" ? { tab: "cola" } : {}, { replace: true })}
            className={`shrink-0 whitespace-nowrap px-4 py-2.5 text-[13px] font-semibold ${tab === t.id ? "border-b-2 border-navy text-navy" : "text-ink-3"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "cola" ? <ColaClasificacion /> : <Bandeja esAdminOSupervisor={esAdminOSupervisor} usuarioId={user!.id} onIrACola={() => setParams({ tab: "cola" }, { replace: true })} />}
    </AppShell>
  );
}

const LIMIT = 25;
const SIN_ASIGNAR = "sin_asignar";
const COLUMNAS = ["Tarea", "Empresa", "Tipo", "Prioridad", "Fecha límite", "Responsable", "Estado"];

function Bandeja({ esAdminOSupervisor, usuarioId, onIrACola }: { esAdminOSupervisor: boolean; usuarioId: number; onIrACola: () => void }) {
  const [estado, setEstado] = useState<Tarea["estado"] | "">("pendiente");
  const [prioridad, setPrioridad] = useState("");
  const [tipo, setTipo] = useState("");
  const [responsableId, setResponsableId] = useState("");
  const [page, setPage] = useState(1);
  const [abiertaId, setAbiertaId] = useState<number | null>(null);
  const [creando, setCreando] = useState(false);

  // "sin_asignar" no es un id: se manda como sinAsignar=true (las tareas que
  // crea n8n, como "Contactar prospecto interesado", llegan sin responsable).
  const sinAsignar = responsableId === SIN_ASIGNAR;
  const filtros = { estado: estado || undefined, prioridad: prioridad || undefined, tipo: tipo || undefined, responsableId: (!sinAsignar && responsableId) || undefined, sinAsignar: sinAsignar ? "true" : undefined, page, limit: LIMIT };
  const { data, isPending, isError } = useQuery({
    queryKey: ["tareas", "bandeja", filtros],
    queryFn: () => api.get<Paginated<Tarea>>("/api/v1/tareas", filtros)
  });
  // Nombres de responsables: GET /usuarios solo lo pueden llamar
  // admin/supervisor; un agente solo ve sus propias tareas.
  const { data: usuarios } = useQuery({
    queryKey: ["usuarios", "activos"],
    queryFn: () => api.get<Paginated<Usuario>>("/api/v1/usuarios", { activo: true, limit: 100 }),
    enabled: esAdminOSupervisor,
    staleTime: 5 * 60_000
  });
  // La cuenta "sistema" (n8n) no trabaja tareas: el backend no deja
  // asignárselas, así que ni se ofrece.
  const personas = usuarios?.data.filter((u) => u.rol !== "sistema");
  const nombreDe = (id: number | null) => (id == null ? "Sin asignar" : (usuarios?.data.find((u) => u.id === id)?.nombre ?? `Usuario ${id}`));

  function cambiar(setter: (v: string) => void) {
    return (e: ChangeEvent<HTMLSelectElement>) => {
      setPage(1);
      setAbiertaId(null);
      setter(e.target.value);
    };
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <div className="flex flex-wrap gap-3">
          <select aria-label="Estado" className={`${inputBaseClass} w-auto`} value={estado} onChange={cambiar((v) => setEstado(v as Tarea["estado"] | ""))}>
            <option value="">Estado: Todas</option>
            {Object.entries(ETIQUETA_ESTADO_TAREA).map(([clave, etiqueta]) => (
              <option key={clave} value={clave}>
                {etiqueta}
              </option>
            ))}
          </select>
          <select aria-label="Prioridad" className={`${inputBaseClass} w-auto`} value={prioridad} onChange={cambiar(setPrioridad)}>
            <option value="">Prioridad: Todas</option>
            {Object.entries(ETIQUETA_PRIORIDAD).map(([clave, etiqueta]) => (
              <option key={clave} value={clave}>
                {etiqueta}
              </option>
            ))}
          </select>
          <select aria-label="Tipo" className={`${inputBaseClass} w-auto`} value={tipo} onChange={cambiar(setTipo)}>
            <option value="">Tipo: Todos</option>
            {Object.entries(ETIQUETA_TIPO_TAREA).map(([clave, etiqueta]) => (
              <option key={clave} value={clave}>
                {etiqueta}
              </option>
            ))}
          </select>
          {esAdminOSupervisor && (
            <select aria-label="Responsable" className={`${inputBaseClass} w-auto`} value={responsableId} onChange={cambiar(setResponsableId)}>
              <option value="">Responsable: Todos</option>
              <option value={SIN_ASIGNAR}>Sin asignar</option>
              {personas?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          )}
        </div>
        {!creando && <Button onClick={() => setCreando(true)}>+ Nueva tarea</Button>}
      </div>

      {creando && <NuevaTareaForm usuarioActualId={usuarioId} usuarios={esAdminOSupervisor ? personas : undefined} onDone={() => setCreando(false)} />}

      {isPending && <div className="p-5 text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="p-5 text-sm text-danger">No se pudieron cargar las tareas.</div>}
      {data && data.data.length === 0 && <div className="p-5 text-sm text-ink-3">No hay tareas{estado || prioridad || tipo || responsableId ? " con ese filtro" : ""}.</div>}

      {data && data.data.length > 0 && (
        <div className="overflow-x-auto">
          <div className="tabla-scroll"><table className="w-full border-collapse">
            <thead>
              <tr className="bg-bg">
                {COLUMNAS.filter((c) => esAdminOSupervisor || c !== "Responsable").map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-ink-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.data.map((t) => {
                const vencida = estaVencida(t);
                return (
                  <Fragment key={t.id}>
                    <tr className={`cursor-pointer border-t border-border hover:bg-bg ${abiertaId === t.id ? "bg-bg" : ""}`} onClick={() => setAbiertaId(abiertaId === t.id ? null : t.id)}>
                      <td className="px-4 py-3 text-[13px] font-semibold">{t.titulo}</td>
                      <td className="px-4 py-3 text-[13px]">
                        {t.empresa_id ? (
                          <Link to={`/empresas/${t.empresa_id}`} className="hover:text-navy hover:underline" onClick={(e) => e.stopPropagation()}>
                            {t.empresa_nombre ?? `Empresa ${t.empresa_id}`}
                          </Link>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-ink-2">{ETIQUETA_TIPO_TAREA[t.tipo]}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${CLASE_PRIORIDAD[t.prioridad]}`}>{ETIQUETA_PRIORIDAD[t.prioridad]}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-[13px]">
                        {t.fecha_limite ? <span className={vencida ? "font-semibold text-danger" : "text-ink-2"}>{formatoFechaHora.format(new Date(t.fecha_limite))}</span> : <span className="text-ink-3">—</span>}
                        {vencida && <span className="ml-2 rounded-full bg-danger-bg px-2 py-0.5 text-[10px] font-bold text-danger">Vencida</span>}
                      </td>
                      {esAdminOSupervisor && <td className="px-4 py-3 text-[13px] text-ink-2">{nombreDe(t.responsable_id)}</td>}
                      <td className="px-4 py-3 text-[13px] text-ink-2">{ETIQUETA_ESTADO_TAREA[t.estado]}</td>
                    </tr>
                    {abiertaId === t.id && (
                      <tr>
                        <td colSpan={COLUMNAS.length} className="p-0">
                          <DetalleTarea tarea={t} esAdminOSupervisor={esAdminOSupervisor} usuarios={personas} onIrACola={onIrACola} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table></div>
        </div>
      )}

      {data && (page > 1 || data.data.length === LIMIT) && (
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <span className="text-xs text-ink-3">Página {page}</span>
          <Button variant="ghost" disabled={data.data.length < LIMIT} onClick={() => setPage((p) => p + 1)}>
            Siguiente
          </Button>
        </div>
      )}
    </Card>
  );
}

// Una tarea de clasificación no se cierra aquí: PATCH /tareas/:id/cerrar
// la rechaza (409) porque cerrarla sin clasificar dejaría la respuesta y el
// prospecto sin resolver.
function DetalleTarea({ tarea, esAdminOSupervisor, usuarios, onIrACola }: { tarea: Tarea; esAdminOSupervisor: boolean; usuarios?: Usuario[]; onIrACola: () => void }) {
  const queryClient = useQueryClient();
  const [resultado, setResultado] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const abierta = tarea.estado === "pendiente" || tarea.estado === "en_progreso";
  const [asignarA, setAsignarA] = useState(tarea.responsable_id ? String(tarea.responsable_id) : "");

  // Las tareas que crea n8n llegan sin responsable: admin/supervisor las
  // asignan aquí (PATCH /tareas/:id/asignar) para que el agente las vea.
  async function asignar() {
    if (!asignarA) return;
    setError(null);
    setOcupado(true);
    try {
      await api.patch(`/api/v1/tareas/${tarea.id}/asignar`, { responsableId: Number(asignarA) });
      await queryClient.invalidateQueries({ queryKey: ["tareas"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setOcupado(false);
    }
  }

  async function cerrar() {
    if (resultado.trim().length < 2) {
      setError("Anota el resultado (mínimo 2 caracteres).");
      return;
    }
    setError(null);
    setOcupado(true);
    try {
      await api.patch(`/api/v1/tareas/${tarea.id}/cerrar`, { resultado: resultado.trim() });
      await queryClient.invalidateQueries({ queryKey: ["tareas"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 border-t border-border bg-bg p-5">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
        <dt className="text-ink-3">Descripción</dt>
        <dd className="whitespace-pre-wrap">{tarea.descripcion || "—"}</dd>
        <dt className="text-ink-3">Creada</dt>
        <dd>{formatoFechaHora.format(new Date(tarea.creado_en))}</dd>
        {tarea.cerrada_en && (
          <>
            <dt className="text-ink-3">Cerrada</dt>
            <dd>{formatoFechaHora.format(new Date(tarea.cerrada_en))}</dd>
          </>
        )}
        {tarea.clasificacion && (
          <>
            <dt className="text-ink-3">Clasificación</dt>
            <dd>{ETIQUETA_CLASIFICACION[tarea.clasificacion]}</dd>
          </>
        )}
        {tarea.resultado && (
          <>
            <dt className="text-ink-3">Resultado</dt>
            <dd className="whitespace-pre-wrap">{tarea.resultado}</dd>
          </>
        )}
      </dl>

      {abierta && esAdminOSupervisor && usuarios && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-ink-2">
            {tarea.responsable_id ? "Reasignar a" : "Asignar a"}
            <select className={`${inputBaseClass} w-auto`} value={asignarA} onChange={(e) => setAsignarA(e.target.value)}>
              <option value="">Elige a alguien…</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </label>
          <Button variant="outline" className="px-3 py-2" disabled={ocupado || !asignarA || Number(asignarA) === tarea.responsable_id} onClick={() => void asignar()}>
            Asignar
          </Button>
          {/* Asignar = dar dueño (C1, 2-oct-2026): si la empresa no es de otro agente activo, pasa a este. */}
          {tarea.empresa_id && usuarios.find((u) => String(u.id) === asignarA)?.rol === "agente" && Number(asignarA) !== tarea.responsable_id && (
            <span className="pb-2 text-xs text-ink-3">Si la empresa no tiene otro agente activo como dueño, pasa a ser de este agente.</span>
          )}
        </div>
      )}

      {abierta && tarea.tipo === "clasificacion" && (
        <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-2">
          Esta tarea se resuelve clasificando la respuesta en la cola de clasificación.
          {esAdminOSupervisor && (
            <Button variant="outline" className="px-3 py-1.5" onClick={onIrACola}>
              Ir a la cola
            </Button>
          )}
        </div>
      )}

      {abierta && tarea.tipo !== "clasificacion" && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-72 flex-1 flex-col gap-1.5 text-xs font-semibold text-ink-2">
            Resultado
            <input className={inputClass} maxLength={4000} placeholder="Qué se hizo o cómo quedó" value={resultado} onChange={(e) => setResultado(e.target.value)} />
          </label>
          <Button variant="exito" disabled={ocupado} onClick={() => void cerrar()}>
            Cerrar tarea
          </Button>
        </div>
      )}
      <ServerError message={error} />
    </div>
  );
}
