import { Fragment, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Field, ServerError, inputBaseClass, inputClass } from "../ui/Field";
import { Paginacion } from "../ui/Paginacion";
import { ApiError, api } from "../../lib/api";
import { formatoFecha } from "../../lib/formato";
import type { Paginated, Rol, Usuario } from "../../types";

// Usuarios (UsuariosController): administrador y supervisor consultan; solo
// el administrador da de alta, edita y desactiva. No hay reactivación en el
// backend: un usuario desactivado se queda así (se muestra, sin acciones).

const LIMIT = 25;
const ETIQUETA_ROL: Record<Rol, string> = { administrador: "Administrador", supervisor: "Supervisor", agente: "Agente", sistema: "Sistema (n8n)" };
const ROLES_ASIGNABLES = ["agente", "supervisor", "administrador"] as const;

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
  const [activo, setActivo] = useState("true");
  const [creando, setCreando] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);

  const filtros = { page, limit: LIMIT, rol: rol || undefined, activo: activo || undefined };
  const { data, isPending, isError } = useQuery({
    queryKey: ["usuarios", "admin", filtros],
    queryFn: () => api.get<Paginated<Usuario>>("/api/v1/usuarios", filtros)
  });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <div className="flex flex-wrap gap-3">
          <select aria-label="Rol" className={`${inputBaseClass} w-auto`} value={rol} onChange={(e) => {
              setPage(1);
              setRol(e.target.value);
            }}>
            <option value="">Rol: Todos</option>
            {(["administrador", "supervisor", "agente", "sistema"] as const).map((r) => (
              <option key={r} value={r}>
                {ETIQUETA_ROL[r]}
              </option>
            ))}
          </select>
          <select aria-label="Estado" className={`${inputBaseClass} w-auto`} value={activo} onChange={(e) => {
              setPage(1);
              setActivo(e.target.value);
            }}>
            <option value="true">Activos</option>
            <option value="false">Desactivados</option>
            <option value="">Todos</option>
          </select>
        </div>
        {esAdmin && !creando && <Button onClick={() => {
              setCreando(true);
              setEditandoId(null);
            }}>+ Nuevo usuario</Button>}
      </div>

      {creando && <UsuarioForm onDone={() => setCreando(false)} />}

      {isPending && <div className="p-5 text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="p-5 text-sm text-danger">No se pudieron cargar los usuarios.</div>}
      {data && data.data.length === 0 && <div className="p-5 text-sm text-ink-3">No hay usuarios con ese filtro.</div>}
      {data && data.data.length > 0 && (
        <div className="tabla-scroll"><table className="w-full border-collapse">
          <thead>
            <tr className="bg-bg">
              {["Nombre", "Correo", "Rol", "Estado", "Alta", ""].map((h) => (
                <th key={h} className="px-5 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-ink-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.data.map((u) => (
              <Fragment key={u.id}>
                <tr className="border-t border-border">
                  <td className="px-5 py-3 text-[13px] font-semibold">
                    {u.nombre}
                    {u.id === usuarioActualId && <span className="ml-1.5 text-xs font-normal text-ink-3">(tú)</span>}
                  </td>
                  <td className="px-5 py-3 text-[13px] text-ink-2">{u.correo}</td>
                  <td className="px-5 py-3 text-[13px] text-ink-2">{ETIQUETA_ROL[u.rol]}</td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${u.activo ? "bg-ok-bg text-ok" : "bg-bg text-ink-3"}`}>{u.activo ? "Activo" : "Desactivado"}</span>
                  </td>
                  <td className="px-5 py-3 text-[13px] text-ink-2">{u.creado_en ? formatoFecha.format(new Date(u.creado_en)) : "—"}</td>
                  <td className="px-5 py-3 text-right">
                    {/* La cuenta "sistema" es de n8n (ApiKeyGuard): no se edita aquí. */}
                    {esAdmin && u.activo && u.rol !== "sistema" && (
                      <Button variant="ghost" className="border border-border px-3 py-1.5" onClick={() => {
              setEditandoId(editandoId === u.id ? null : u.id);
              setCreando(false);
            }}>
                        {editandoId === u.id ? "Cancelar" : "Editar"}
                      </Button>
                    )}
                  </td>
                </tr>
                {editandoId === u.id && (
                  <tr>
                    <td colSpan={6} className="p-0">
                      <UsuarioForm usuario={u} esUnoMismo={u.id === usuarioActualId} onDone={() => setEditandoId(null)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table></div>
      )}
      {data && <Paginacion page={page} limit={LIMIT} cantidad={data.data.length} onPage={setPage} />}
    </Card>
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
    <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex flex-col gap-4 border-y border-border bg-bg p-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Nombre" htmlFor="usr-nombre" error={errors.nombre?.message}>
          <input id="usr-nombre" className={inputClass} {...register("nombre")} />
        </Field>
        <Field label="Correo" htmlFor="usr-correo" error={errors.correo?.message}>
          <input id="usr-correo" type="email" className={inputClass} {...register("correo")} />
        </Field>
        <Field label="Rol" htmlFor="usr-rol">
          <select id="usr-rol" className={inputClass} {...register("rol")}>
            {ROLES_ASIGNABLES.map((r) => (
              <option key={r} value={r}>
                {ETIQUETA_ROL[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={editando ? "Nueva contraseña (opcional)" : "Contraseña"} htmlFor="usr-password" error={errors.password?.message}>
          <input id="usr-password" type="password" autoComplete="new-password" className={inputClass} placeholder="Mínimo 12 caracteres" {...register("password")} />
        </Field>
      </div>
      <ServerError message={serverError} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {editando ? "Guardar cambios" : "Crear usuario"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        {/* Desactivarse a uno mismo cerraría la sesión en uso: no se ofrece. */}
        {editando && !esUnoMismo && (
          <div className="ml-auto flex items-center gap-2">
            {confirmarBaja ? (
              <>
                <span className="text-xs text-danger">Ya no podrá iniciar sesión y no se puede reactivar desde aquí.</span>
                <Button type="button" variant="primary" onClick={() => void desactivar()}>
                  Sí, desactivar
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmarBaja(false)}>
                  No
                </Button>
              </>
            ) : (
              <Button type="button" variant="ghost" className="border border-border text-danger" onClick={() => setConfirmarBaja(true)}>
                Desactivar usuario
              </Button>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
