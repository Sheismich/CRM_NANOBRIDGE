import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Field, ServerError, inputClass } from "../ui/Field";
import { ApiError, api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { formatoFecha, formatoFechaHora, formatoTamano } from "../../lib/formato";
import type { Documento, Paginated } from "../../types";
import { useOportunidadesEmpresa } from "./queries";

// Mismos tipos que TIPOS_MIME_PERMITIDOS (documento.schema.ts) y el tope de
// STORAGE_MAX_FILE_SIZE_MB por default (25, PLAN_CRM #8). Revisar aquí solo
// evita subir de balde un archivo que el backend va a rechazar; si el tope
// del servidor se configura distinto, manda el del servidor.
const MIME_PERMITIDOS = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg"
];
const ACCEPT = ".pdf,.docx,.xlsx,.png,.jpg,.jpeg";
const MAX_BYTES = 25 * 1024 * 1024;

function validarArchivo(archivo: File | undefined): string | null {
  if (!archivo) return "Elige un archivo";
  if (!MIME_PERMITIDOS.includes(archivo.type)) return "Tipo no permitido. Permitidos: PDF, DOCX, XLSX, PNG, JPG";
  if (archivo.size > MAX_BYTES) return "El archivo excede 25 MB";
  if (archivo.size === 0) return "El archivo está vacío";
  if (archivo.name.length > 255) return "El nombre del archivo no puede exceder 255 caracteres";
  return null;
}

type TipoDocumento = { id: number; clave: string; nombre: string };

export function DocumentosTab({ empresaId, contactos }: { empresaId: number; contactos: { id: number; nombre: string }[] }) {
  const { user } = useAuth();
  const puedeEliminar = user?.rol === "administrador" || user?.rol === "supervisor";
  const [subiendo, setSubiendo] = useState(false);

  // Un agente solo ve los documentos de empresas de las que es propietario
  // (DocumentosService.validarEmpresaScoped): en una ajena, 404.
  const { data, isPending, isError } = useQuery({
    queryKey: ["documentos", { empresaId }],
    queryFn: () => api.get<Paginated<Documento>>("/api/v1/documentos", { empresaId, limit: 100 })
  });
  const { data: catalogos } = useQuery({
    queryKey: ["documentos-catalogos"],
    queryFn: () => api.get<{ tipos_documento: TipoDocumento[] }>("/api/v1/documentos/catalogos"),
    staleTime: Infinity
  });
  const { data: oportunidades } = useOportunidadesEmpresa(empresaId);
  const tipos = useMemo(() => catalogos?.tipos_documento ?? [], [catalogos]);
  const nombreTipo = useMemo(() => new Map(tipos.map((t) => [t.id, t.nombre])), [tipos]);
  const tituloOportunidad = useMemo(() => new Map((oportunidades?.data ?? []).map((o) => [o.id, o.titulo])), [oportunidades]);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="text-sm font-bold">Documentos</div>
        {!subiendo && (
          <Button variant="outline" onClick={() => setSubiendo(true)}>
            Subir documento
          </Button>
        )}
      </div>
      {subiendo && (
        <SubirDocumentoForm empresaId={empresaId} tipos={tipos} oportunidades={oportunidades?.data ?? []} contactos={contactos} onDone={() => setSubiendo(false)} />
      )}

      {isPending && <div className="p-6 text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="p-6 text-sm text-danger">No se pudieron cargar los documentos (o no tienes acceso a los de esta empresa).</div>}
      {data && data.data.length === 0 && <div className="p-6 text-sm text-ink-3">Esta empresa no tiene documentos todavía.</div>}

      {data && data.data.length > 0 && (
        <ul>
          {data.data.map((d) => (
            <DocumentoFila
              key={d.id}
              documento={d}
              tipo={d.tipo_documento_id ? nombreTipo.get(d.tipo_documento_id) : undefined}
              oportunidad={d.oportunidad_id ? tituloOportunidad.get(d.oportunidad_id) : undefined}
              puedeEliminar={puedeEliminar}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function SubirDocumentoForm({
  empresaId,
  tipos,
  oportunidades,
  contactos,
  onDone
}: {
  empresaId: number;
  tipos: TipoDocumento[];
  oportunidades: { id: number; titulo: string }[];
  contactos: { id: number; nombre: string }[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [archivo, setArchivo] = useState<File | undefined>();
  const [tipoDocumentoId, setTipoDocumentoId] = useState("");
  const [oportunidadId, setOportunidadId] = useState("");
  const [contactoId, setContactoId] = useState("");
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function onSubmit() {
    setServerError(null);
    const error = validarArchivo(archivo);
    setErrorArchivo(error);
    if (error || !archivo) return;

    // multipart: el archivo va en el campo "archivo" (uploadInterceptor de
    // DocumentosController); los ids viajan como texto.
    const form = new FormData();
    form.append("archivo", archivo);
    form.append("empresaId", String(empresaId));
    if (tipoDocumentoId) form.append("tipoDocumentoId", tipoDocumentoId);
    if (oportunidadId) form.append("oportunidadId", oportunidadId);
    if (contactoId) form.append("contactoId", contactoId);

    setEnviando(true);
    try {
      await api.postForm("/api/v1/documentos", form);
      await queryClient.invalidateQueries({ queryKey: ["documentos", { empresaId }] });
      onDone();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void onSubmit(); }} className="flex flex-col gap-4 border-b border-border bg-bg p-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Archivo (PDF, DOCX, XLSX, PNG o JPG; máx. 25 MB)" htmlFor="doc-archivo" error={errorArchivo ?? undefined}>
          <input id="doc-archivo" type="file" accept={ACCEPT} className={inputClass} onChange={(e) => setArchivo(e.target.files?.[0])} />
        </Field>
        <Field label="Tipo (opcional)" htmlFor="doc-tipo">
          <select id="doc-tipo" className={inputClass} value={tipoDocumentoId} onChange={(e) => setTipoDocumentoId(e.target.value)}>
            <option value="">— Sin clasificar —</option>
            {tipos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Oportunidad (opcional)" htmlFor="doc-oportunidad">
          <select id="doc-oportunidad" className={inputClass} value={oportunidadId} onChange={(e) => setOportunidadId(e.target.value)}>
            <option value="">— Ninguna —</option>
            {oportunidades.map((o) => (
              <option key={o.id} value={o.id}>
                {o.titulo}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Contacto (opcional)" htmlFor="doc-contacto">
          <select id="doc-contacto" className={inputClass} value={contactoId} onChange={(e) => setContactoId(e.target.value)}>
            <option value="">— Ninguno —</option>
            {contactos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <ServerError message={serverError} />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={enviando}>
          {enviando ? "Subiendo…" : "Subir"}
        </Button>
      </div>
    </form>
  );
}

function DocumentoFila({ documento: d, tipo, oportunidad, puedeEliminar }: { documento: Documento; tipo?: string; oportunidad?: string; puedeEliminar: boolean }) {
  const queryClient = useQueryClient();
  const versionInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function ejecutar(accion: () => Promise<unknown>) {
    setError(null);
    setOcupado(true);
    try {
      await accion();
      await queryClient.invalidateQueries({ queryKey: ["documentos", { empresaId: d.empresa_id }] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setOcupado(false);
    }
  }

  async function descargar() {
    setError(null);
    try {
      await api.descargar(`/api/v1/documentos/${d.id}/descarga`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    }
  }

  function subirVersion(archivo: File | undefined) {
    const problema = validarArchivo(archivo);
    if (problema || !archivo) {
      setError(problema);
      return;
    }
    const form = new FormData();
    form.append("archivo", archivo);
    void ejecutar(() => api.postForm(`/api/v1/documentos/${d.id}/version`, form));
  }

  return (
    <li className="flex flex-col gap-2 border-t border-border px-5 py-3.5 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{d.nombre_original}</div>
          <div className="mt-0.5 text-xs text-ink-3">
            {[tipo ?? "Sin clasificar", `v${d.version}`, formatoTamano(d.tamano_bytes), `Subido el ${formatoFecha.format(new Date(d.creado_en))}`, oportunidad && `Oportunidad: ${oportunidad}`]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {d.estado === "archivado" && <span className="rounded-full bg-bg px-2.5 py-1 text-[11px] font-bold text-ink-3">Archivado</span>}
          {d.revisado_en ? (
            <span className="rounded-full bg-ok-bg px-2.5 py-1 text-[11px] font-bold text-ok" title={formatoFechaHora.format(new Date(d.revisado_en))}>
              Revisado
            </span>
          ) : (
            <span className="rounded-full bg-warn-bg px-2.5 py-1 text-[11px] font-bold text-warn">Pendiente de revisión</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Button variant="ghost" onClick={() => void descargar()}>
          Descargar
        </Button>
        {!d.revisado_en && (
          <Button variant="ghost" disabled={ocupado} onClick={() => void ejecutar(() => api.patch(`/api/v1/documentos/${d.id}/revisar`, {}))}>
            Marcar revisado
          </Button>
        )}
        <Button variant="ghost" disabled={ocupado} onClick={() => versionInput.current?.click()}>
          Nueva versión
        </Button>
        <input
          ref={versionInput}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            subirVersion(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button
          variant="ghost"
          disabled={ocupado}
          onClick={() => void ejecutar(() => api.patch(`/api/v1/documentos/${d.id}/estado`, { estado: d.estado === "archivado" ? "vigente" : "archivado" }))}
        >
          {d.estado === "archivado" ? "Reactivar" : "Archivar"}
        </Button>
        {puedeEliminar && (
          <Button
            variant="ghost"
            disabled={ocupado}
            className="text-danger"
            onClick={() => {
              if (window.confirm(`¿Eliminar "${d.nombre_original}" del expediente?`)) void ejecutar(() => api.delete(`/api/v1/documentos/${d.id}`));
            }}
          >
            Eliminar
          </Button>
        )}
      </div>
      <ServerError message={error} />
    </li>
  );
}
