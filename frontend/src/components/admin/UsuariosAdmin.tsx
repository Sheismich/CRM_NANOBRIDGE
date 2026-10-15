import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Field, ServerError, inputBaseClass, inputClass } from "../ui/Field";
import { Paginacion } from "../ui/Paginacion";
import { Pastilla } from "../ui/Pastilla";
import { Segmento } from "../ui/Segmento";
import type { Tono } from "../ui/tonos";
import { ApiError, api } from "../../lib/api";
import { cuando } from "../../lib/documentos";
import { formatoFecha } from "../../lib/formato";
import type { Paginated, Rol, Usuario } from "../../types";

// Usuarios (UsuariosController): administrador y supervisor consultan; solo
// el administrador da de alta, edita, desactiva y reactiva
// (POST /usuarios/:id/reactivar, 2-oct-2026). Vive en el panel lateral de
// Administración; con el estilo del rediseño desde el 15-oct-2026 (filas
// con avatar y pastillas en vez de la tabla vieja).

const LIMIT = 25;
const ETIQUETA_ROL: Record<Rol, string> = { administrador: "Administrador", supervisor: "Supervisor", agente: "Agente", sistema: "Sistema (n8n)" };
// Mismos colores que "Equipo y roles".
const TONO_ROL: Record<Rol, Tono> = { administrador: "navy", supervisor: "info", agente: "ok", sistema: "neutro" };
const ROLES_ASIGNABLES = ["agente", "supervisor", "administrador"] as const;
type FiltroActivo = "true" | "false" | "todos";

// Mismas reglas que crearUsuarioSchema / actualizarUsuarioSchema
// (src/usuarios/dto/usuario.schema.ts). Al editar, la contraseña vacía
// significa "no cambiarla".
const usuarioSchema = (editando: boolean) =>
  z.object({
    nombre: z.string().trim().min(2, "Mínimo 2 caracteres").max(160, "Máximo 160 caracteres"),
    correo: z.string().trim().email("Correo no válido").max(254),
    rol: z.enum(ROLES_ASIGNABLES),
    password: editando
      ? z.string().refine((v) => v === "" || (v.length >= 12 && v.length <= 128), "Entre 12 y 128 caracteres, o vacía para no cambiarla")
      : z.string().min(12, "Mínimo 12 caracteres").max(128, "Máximo 128 caracteres")
  });
type UsuarioInput = z.infer<ReturnType<typeof usuarioSchema>>;

export function UsuariosAdmin({ esAdmin, usuarioActualId }: { esAdmin: boolean; usuarioActualId: number }) {
  const [page, setPage] = useState(1);
  const [rol, setRol] = useState("");
  const [activo, setActivo] = useState<FiltroActivo>("true");
  const [creando, setCreando] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [reactivandoId, setReactivandoId] = useState<number | null>(null);
  const [errorFila, setErrorFila] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const ahora = new Date();

  const filtros = { page, limit: LIMIT, rol: rol || undefined, activo: activo === "todos" ? undefined : activo };
  const { data, isPending, isError } = useQuery({
    queryKey: ["usuarios", "admin", filtros],
    queryFn: () => api.get<Paginated<Usuario>>("/api/v1/usuarios", filtros)
  });

  async function reactivar(id: number) {
    setErrorFila(null);
    setReactivandoId(id);
    try {
      await api.post(`/api/v1/usuarios/${id}/reactivar`);
      await queryClient.invalidateQueries({ queryKey: ["usuarios"] });
    } catch (error) {
      // 409: ya estaba activo (otra persona lo reactivó antes).
      setErrorFila(error instanceof ApiError ? error.message : "No se pudo conectar con el servidor");
      await queryClient.invalidateQueries({ queryKey: ["usuarios"] });
    } finally {
      setReactivandoId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <Segmento<FiltroActivo>
          etiqueta="Estado de los usuarios"
          opciones={[
            { id: "true", texto: "Activos" },
            { id: "false", texto: "Desactivados" },
            { id: "todos", texto: "Todos" }
          ]}
          valor={activo}
          onCambiar={(v) => {
            setPage(1);
            setActivo(v);
          }}
        />
        <select
          aria-label="Rol"
          className={`${inputBaseClass} h-10 w-auto`}
          value={rol}
          onChange={(e) => {
            setPage(1);
            setRol(e.target.value);
          }}
        >
          <option value="">Rol: Todos</option>
          {(["administrador", "supervisor", "agente", "sistema"] as const).map((r) => (
            <option key={r} value={r}>
              {ETIQUETA_ROL[r]}
            </option>
          ))}
        </select>
        {esAdmin && !creando && (
          <Button
            className="ml-auto"
            onClick={() => {
              setCreando(true);
              setEditandoId(null);
            }}
          >
            + Nuevo usuario
          </Button>
        )}
      </div>

      {creando && (
        <div className="rounded-[14px] border border-border bg-soft">
          <div className="px-4 pt-3.5 font-heading text-[14px] font-extrabold text-strong">Nuevo usuario</div>
          <UsuarioForm onDone={() => setCreando(false)} />
        </div>
      )}
      <ServerError message={errorFila} />

      {isPending && <div className="text-[13px] text-ink-3">Cargando…</div>}
      {isError && <div className="text-[13px] text-danger">No se pudieron cargar los usuarios.</div>}
      {data && data.data.length === 0 && <div className="rounded-[12px] border border-dashed border-border px-4 py-3 text-[13px] text-ink-3">No hay usuarios con ese filtro.</div>}
      {data && data.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {data.data.map((u) => {
            const editando = editandoId === u.id;
            return (
              <li key={u.id} className={clsx("rounded-[14px] border bg-card", editando ? "border-navy/40" : "border-border", !u.activo && "opacity-75")}>
                <div className="flex flex-wrap items-center gap-3 px-3.5 py-3">
                  <Avatar nombre={u.nombre} className="!h-9 !w-9 !text-[12px]" />
                  <div className="min-w-0 flex-[1_1_12rem]">
                    <div className="truncate text-[14px] font-bold text-strong">
                      {u.nombre}
                      {u.id === usuarioActualId && <span className="ml-1.5 text-[12px] font-normal text-ink-3">(tú)</span>}
                    </div>
                    <div className="truncate text-[12.5px] text-ink-3">{u.correo}</div>
                    <div className="text-[11.5px] text-ink-3">
                      {u.ultimo_acceso_en ? `Último acceso: ${cuando(u.ultimo_acceso_en, ahora).toLowerCase()}` : "Sin acceso registrado"}
                      {u.creado_en && ` · alta ${formatoFecha.format(new Date(u.creado_en))}`}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pastilla tono={TONO_ROL[u.rol]} punto>
                      {ETIQUETA_ROL[u.rol]}
                    </Pastilla>
                    {!u.activo && <Pastilla tono="neutro">Desactivado</Pastilla>}
                  </div>
                  {/* La cuenta "sistema" es de n8n (ApiKeyGuard): no se edita aquí. */}
                  {esAdmin && u.rol !== "sistema" && (
                    <div className="ml-auto">
                      {u.activo ? (
                        <Button
                          variant="outline"
                          className="h-9 px-3"
                          onClick={() => {
                            setEditandoId(editando ? null : u.id);
                            setCreando(false);
                          }}
                        >
                          {editando ? "Cerrar" : "Editar"}
                        </Button>
                      ) : (
                        <Button variant="outline" className="h-9 px-3" disabled={reactivandoId === u.id} onClick={() => void reactivar(u.id)}>
                          {reactivandoId === u.id ? "Reactivando…" : "Reactivar"}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                {editando && (
                  <div className="border-t border-border bg-soft">
                    <UsuarioForm usuario={u} esUnoMismo={u.id === usuarioActualId} onDone={() => setEditandoId(null)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {data && <Paginacion page={page} limit={LIMIT} cantidad={data.data.length} onPage={setPage} />}
    </div>
  );
}

function UsuarioForm({ usuario, esUnoMismo = false, onDone }: { usuario?: Usuario; esUnoMismo?: boolean; onDone: () => void }) {
  const queryClient = useQueryClient();
  const editando = Boolean(usuario);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmarBaja, setConfirmarBaja] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, dirtyFields }
  } = useForm<UsuarioInput>({
    resolver: zodResolver(usuarioSchema(editando)),
    defaultValues: {
      nombre: usuario?.nombre ?? "",
      correo: usuario?.correo ?? "",
      rol: usuario && usuario.rol !== "sistema" ? usuario.rol : "agente",
      password: ""
    }
  });

  async function refrescar() {
    await queryClient.invalidateQueries({ queryKey: ["usuarios"] });
  }

  async function onSubmit(values: UsuarioInput) {
    setServerError(null);
    try {
      if (usuario) {
        // PATCH parcial: solo lo que cambió (el backend exige al menos un campo).
        const cambios: Record<string, string> = {};
        if (dirtyFields.nombre) cambios.nombre = values.nombre;
        if (dirtyFields.correo) cambios.correo = values.correo;
        if (dirtyFields.rol) cambios.rol = values.rol;
        if (values.password) cambios.password = values.password;
        if (Object.keys(cambios).length === 0) return onDone();
        await api.patch(`/api/v1/usuarios/${usuario.id}`, cambios);
      } else {
        await api.post("/api/v1/usuarios", values);
      }
      await refrescar();
      onDone();
    } catch (error) {
      // 409: correo repetido, o dejar el sistema sin administrador activo.
      setServerError(error instanceof ApiError ? error.message : "No se pudo conectar con el servidor");
    }
  }

  async function desactivar() {
    if (!usuario) return;
    setServerError(null);
    try {
      await api.delete(`/api/v1/usuarios/${usuario.id}`);
      await refrescar();
      onDone();
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : "No se pudo conectar con el servidor");
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex flex-col gap-3.5 p-4">
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <Field label="Nombre" htmlFor={`usr-nombre-${usuario?.id ?? "nuevo"}`} error={errors.nombre?.message}>
          <input id={`usr-nombre-${usuario?.id ?? "nuevo"}`} className={inputClass} {...register("nombre")} />
        </Field>
        <Field label="Correo" htmlFor={`usr-correo-${usuario?.id ?? "nuevo"}`} error={errors.correo?.message}>
          <input id={`usr-correo-${usuario?.id ?? "nuevo"}`} type="email" className={inputClass} {...register("correo")} />
        </Field>
        <Field label="Rol" htmlFor={`usr-rol-${usuario?.id ?? "nuevo"}`}>
          <select id={`usr-rol-${usuario?.id ?? "nuevo"}`} className={inputClass} {...register("rol")}>
            {ROLES_ASIGNABLES.map((r) => (
              <option key={r} value={r}>
                {ETIQUETA_ROL[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={editando ? "Nueva contraseña (opcional)" : "Contraseña"} htmlFor={`usr-password-${usuario?.id ?? "nuevo"}`} error={errors.password?.message}>
          <input id={`usr-password-${usuario?.id ?? "nuevo"}`} type="password" autoComplete="new-password" className={inputClass} placeholder="Mínimo 12 caracteres" {...register("password")} />
        </Field>
      </div>
      <ServerError message={serverError} />
      {confirmarBaja ? (
        <div className="flex flex-col gap-2.5 rounded-[12px] border border-danger/25 bg-danger-bg px-3.5 py-3">
          <span className="text-[13px] text-danger">Se cierran sus sesiones y sus tareas abiertas quedan "Sin asignar". Se puede reactivar después.</span>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="rechazar" onClick={() => void desactivar()}>
              Sí, desactivar
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirmarBaja(false)}>
              No
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Guardando…" : editando ? "Guardar cambios" : "Crear usuario"}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancelar
          </Button>
          {/* Desactivarse a uno mismo cerraría la sesión en uso: no se ofrece. */}
          {editando && !esUnoMismo && (
            <Button type="button" variant="peligro" className="ml-auto" onClick={() => setConfirmarBaja(true)}>
              Desactivar usuario
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
