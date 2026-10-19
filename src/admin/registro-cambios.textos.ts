// Frases del Registro de cambios (12-oct-2026): "Fabián cambió el rol de
// TEST.", "Tania editó la empresa Moldes del Bajío." y el antes → después con
// nombre de campo en español y nombres en vez de ids. Se arman aquí (no en la
// pantalla) para que la pantalla, el PDF y el CSV digan exactamente lo mismo.
// Si una acción no tiene frase propia sale una genérica, nunca un error.

export interface Nombres {
  usuarios: Map<number, string>;
  empresas: Map<number, string>;
  contactos: Map<number, { nombre: string; empresaId: number | null }>;
  oportunidades: Map<number, string>;
  cotizaciones: Map<number, { version: number; empresaId: number; raizId: number | null }>;
  documentos: Map<number, { nombre: string; version: number; empresaId: number }>;
  campanas: Map<number, string>;
  tiposDocumento: Map<number, string>;
  prospectos: Map<number, { contactoId: number }>;
  medios: Map<number, { valor: string; contactoId: number | null }>;
  etapas: Map<string, string>;
}

export interface FilaAuditoria {
  entidad: string;
  entidadId: number;
  accion: string;
  usuarioId: number | null;
  antes: unknown;
  despues: unknown;
}

export interface Cambio {
  campo: string;
  etiqueta: string;
  antes: string;
  despues: string;
}

const ETIQUETAS: Record<string, string> = {
  nombre: "Nombre",
  nombreLegal: "Nombre legal",
  nombre_legal: "Nombre legal",
  nombreComercial: "Nombre comercial",
  correo: "Correo",
  telefono: "Teléfono",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  sitio_web: "Sitio web",
  puesto: "Puesto",
  rol: "Rol",
  password: "Contraseña",
  activo: "Activo",
  giro: "Giro",
  tamano: "Tamaño",
  region: "Región",
  estado: "Estado",
  ciudad: "Ciudad",
  pais: "País",
  sitioWeb: "Sitio web",
  linkedinUrl: "LinkedIn",
  facebookUrl: "Facebook",
  instagramUrl: "Instagram",
  propietario_id: "Responsable",
  responsable_id: "Responsable",
  etapa_clave: "Etapa",
  motivo_perdida_clave: "Motivo de pérdida",
  fecha_inicio: "Fecha de inicio",
  fecha_fin: "Fecha de fin",
  revision: "Revisión",
  motivo_rechazo: "Motivo de rechazo",
  motivo_rechazo_detalle: "Explicación",
  obligatorio: "Obligatorio",
  intentos: "Intentos",
  ultimo_error: "Error",
  asunto: "Asunto",
  cuerpo: "Texto",
  pie: "Pie"
};

const ROLES: Record<string, string> = { administrador: "Administrador", supervisor: "Supervisor", agente: "Agente" };

const REPORTES: Record<string, string> = {
  actividades: "el reporte de actividades por agente",
  tareas: "el reporte de tareas",
  "conversion-etapas": "el reporte de conversión por etapa",
  pipeline: "el reporte del pipeline",
  forecast: "el reporte del forecast",
  "desempeno-por-agente": "el reporte de desempeño por agente",
  prospeccion: "el reporte de prospección",
  dia: "la bitácora del día",
  "informe-ejecutivo": "el informe ejecutivo"
};

// Correos de prospección (033_plantillas_correo.sql): el número dice cuál.
const NOMBRES_PLANTILLA: Record<string, string> = { 1: "Correo 1", 2: "Recordatorio 1", 3: "Recordatorio 2" };

const VERBOS_CAMPANA: Record<string, string> = { crear: "creó", editar: "editó", activar: "activó", pausar: "pausó", finalizar: "finalizó" };

function objeto(valor: unknown): Record<string, unknown> | null {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null;
}

function legible(campo: string, valor: unknown, nombres: Nombres): string {
  if (campo === "propietario_id" || campo === "responsable_id") {
    return valor == null ? "sin asignar" : nombres.usuarios.get(Number(valor)) ?? `#${valor}`;
  }
  if (valor == null || valor === "") return "—";
  if (campo === "rol") return ROLES[String(valor)] ?? String(valor);
  if (campo === "etapa_clave") return nombres.etapas.get(String(valor)) ?? String(valor);
  if (campo === "password") return "cambiada";
  // Texto de un correo: tal cual (los "_" de {{primer_nombre}} se quedan).
  if (campo === "asunto" || campo === "cuerpo" || campo === "pie") return String(valor);
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  // Medios de contacto: { valor, estado_contacto }.
  const comoObjeto = objeto(valor);
  if (comoObjeto && "valor" in comoObjeto) return String(comoObjeto.valor ?? "—");
  if (comoObjeto) return JSON.stringify(comoObjeto);
  return String(valor).replace(/_/g, " ");
}

/** Lo que cambió, campo por campo; solo campos que conocemos (lo interno, como execution_id, no se muestra). */
export function cambiosDe(fila: FilaAuditoria, nombres: Nombres): Cambio[] {
  const antes = objeto(fila.antes);
  const despues = objeto(fila.despues) ?? {};
  if (!antes) return [];
  const campos = [...new Set([...Object.keys(antes), ...Object.keys(despues)])].filter((campo) => campo in ETIQUETAS);
  return campos
    .map((campo) => ({ campo, etiqueta: ETIQUETAS[campo]!, antes: legible(campo, antes[campo], nombres), despues: legible(campo, despues[campo], nombres) }))
    .filter((c) => c.antes !== c.despues);
}

/** Nombre corto del registro afectado ("Moldes del Bajío", "Evaluación UPA.pdf (v1)", "#12 v2"). */
export function nombreDelRegistro(fila: FilaAuditoria, nombres: Nombres): string | null {
  const id = fila.entidadId;
  switch (fila.entidad) {
    case "usuario": return nombres.usuarios.get(id) ?? null;
    case "empresa": return nombres.empresas.get(id) ?? null;
    case "contacto": return nombres.contactos.get(id)?.nombre ?? null;
    case "oportunidad": return nombres.oportunidades.get(id) ?? null;
    case "cotizacion": {
      const c = nombres.cotizaciones.get(id);
      return c ? `#${id} v${c.version}` : `#${id}`;
    }
    case "documento": {
      const d = nombres.documentos.get(id);
      return d ? `${d.nombre} (v${d.version})` : null;
    }
    case "campana": return nombres.campanas.get(id) ?? null;
    case "plantilla_correo": return NOMBRES_PLANTILLA[String(objeto(fila.despues)?.numero ?? "")] ?? null;
    case "pie_correo": return "Pie de los correos";
    case "catalogo_tipo_documento": return nombres.tiposDocumento.get(id) ?? null;
    case "prospecto": {
      const p = nombres.prospectos.get(id);
      return p ? nombres.contactos.get(p.contactoId)?.nombre ?? null : null;
    }
    case "medio_contacto": return nombres.medios.get(id)?.valor ?? null;
    case "reporte": {
      const reporte = String(objeto(fila.despues)?.reporte ?? "");
      return REPORTES[reporte] ?? reporte;
    }
    case "registro_cambios": return "Registro de cambios";
    default: return null;
  }
}

function deEmpresa(empresaId: number | null | undefined, nombres: Nombres) {
  const nombre = empresaId != null ? nombres.empresas.get(empresaId) : undefined;
  return nombre ? ` de ${nombre}` : "";
}

/** La frase de la fila. `quien` = nombre de la persona que lo hizo. */
export function frase(fila: FilaAuditoria, quien: string, nombres: Nombres): string {
  const nombre = nombreDelRegistro(fila, nombres) ?? `#${fila.entidadId}`;
  const despues = objeto(fila.despues) ?? {};
  const clave = `${fila.entidad}:${fila.accion}`;
  switch (clave) {
    case "usuario:crear": return `${quien} dio de alta a ${nombre} como ${ROLES[String(despues.rol)] ?? String(despues.rol ?? "usuario")}.`;
    case "usuario:actualizar": return Object.keys(despues).length === 1 && "rol" in despues ? `${quien} cambió el rol de ${nombre}.` : `${quien} editó los datos de ${nombre}.`;
    case "usuario:desactivar": {
      const liberadas = Number(despues.tareas_liberadas ?? 0);
      return `${quien} desactivó a ${nombre}${liberadas > 0 ? `; sus ${liberadas} tareas abiertas quedaron sin asignar` : ""}.`;
    }
    case "usuario:reactivar": return `${quien} reactivó a ${nombre}.`;
    case "empresa:crear": return `${quien} dio de alta la empresa ${nombre}.`;
    case "empresa:actualizar": return `${quien} editó la empresa ${nombre}.`;
    case "empresa:desactivar": return `${quien} dio de baja la empresa ${nombre}.`;
    case "empresa:tomar_empresa": {
      const responsable = nombres.usuarios.get(Number(despues.propietario_id)) ?? "alguien";
      return fila.usuarioId === Number(despues.propietario_id) ? `${quien} tomó la empresa ${nombre}.` : `${quien} le dio la empresa ${nombre} a ${responsable}.`;
    }
    case "contacto:crear": return `${quien} agregó el contacto ${nombre}${deEmpresa(nombres.contactos.get(fila.entidadId)?.empresaId, nombres)}.`;
    case "contacto:actualizar": return `${quien} editó el contacto ${nombre}${deEmpresa(nombres.contactos.get(fila.entidadId)?.empresaId, nombres)}.`;
    case "contacto:desactivar": return `${quien} dio de baja el contacto ${nombre}${deEmpresa(nombres.contactos.get(fila.entidadId)?.empresaId, nombres)}.`;
    case "oportunidad:crear": return `${quien} creó la oportunidad ${nombre}.`;
    case "oportunidad:cambiar_etapa": return `${quien} movió la oportunidad ${nombre} a ${legible("etapa_clave", despues.etapa_clave, nombres)}.`;
    case "oportunidad:reabrir": return `${quien} reabrió la oportunidad ${nombre}.`;
    case "cotizacion:crear": return `${quien} creó la cotización ${nombre}${deEmpresa(nombres.cotizaciones.get(fila.entidadId)?.empresaId, nombres)}.`;
    case "cotizacion:nueva_version": return `${quien} sacó una versión nueva de la cotización: ${nombre}.`;
    case "cotizacion:cambiar_estado": return `${quien} marcó la cotización ${nombre} como ${legible("estado", despues.estado, nombres)}.`;
    case "cotizacion:descargar_pdf": return `${quien} descargó el PDF de la cotización ${nombre}.`;
    case "documento:subir": return `${quien} subió el documento ${nombre}${deEmpresa(nombres.documentos.get(fila.entidadId)?.empresaId, nombres)}.`;
    case "documento:nueva_version": return `${quien} subió una versión nueva del documento ${nombre}.`;
    case "documento:cambiar_estado": return `${quien} cambió el estado del documento ${nombre} a ${legible("estado", despues.estado, nombres)}.`;
    case "documento:aprobar": return `${quien} aprobó el documento ${nombre}${deEmpresa(nombres.documentos.get(fila.entidadId)?.empresaId, nombres)}.`;
    case "documento:rechazar": return `${quien} rechazó el documento ${nombre}${deEmpresa(nombres.documentos.get(fila.entidadId)?.empresaId, nombres)}.`;
    case "documento:revisar": return `${quien} marcó como revisado el documento ${nombre}.`;
    case "documento:eliminar": return `${quien} eliminó el documento ${nombre}${deEmpresa(nombres.documentos.get(fila.entidadId)?.empresaId, nombres)}.`;
    case "documento:ver": return `${quien} vio el documento ${nombre}${deEmpresa(nombres.documentos.get(fila.entidadId)?.empresaId, nombres)}.`;
    case "documento:descargar": return `${quien} descargó el documento ${nombre}${deEmpresa(nombres.documentos.get(fila.entidadId)?.empresaId, nombres)}.`;
    case "documento:descargar_lote": return `${quien} descargó un lote de ${Number(despues.cantidad ?? 0)} documentos.`;
    case "prospecto:importar_borrador": return `${quien} importó a ${nombre} como prospecto.`;
    case "medio_contacto:registrar_supresion": return `${quien} marcó ${nombre} como "no contactar".`;
    case "catalogo_tipo_documento:cambiar_obligatorio": return despues.obligatorio ? `${quien} marcó ${nombre} como papel obligatorio.` : `${quien} quitó ${nombre} de los papeles obligatorios.`;
    case "evento_pendiente:reintentar": return `${quien} reintentó el aviso #${fila.entidadId} a n8n.`;
    case "proceso_fallido:cambiar_estado": return `${quien} marcó el problema #${fila.entidadId} como ${legible("estado", despues.estado, nombres)}.`;
    case "reporte:exportar": return `${quien} exportó ${nombre} (${String(despues.formato ?? "csv").toUpperCase()}).`;
    case "plantilla_correo:editar": return `${quien} editó el correo de prospección «${nombre}».`;
    case "pie_correo:editar": return `${quien} editó el pie de los correos de prospección.`;
    case "registro_cambios:exportar": return `${quien} exportó el Registro de cambios (${String(despues.formato ?? "csv").toUpperCase()}).`;
  }
  if (fila.entidad === "campana" && VERBOS_CAMPANA[fila.accion]) return `${quien} ${VERBOS_CAMPANA[fila.accion]} la campaña ${nombre}.`;
  if (fila.entidad === "prospecto" && despues.estado === "baja") return `${quien} dio de baja a ${nombre}${deEmpresa(nombres.contactos.get(nombres.prospectos.get(fila.entidadId)?.contactoId ?? 0)?.empresaId, nombres)}; ya no se le escribe.`;
  return `${quien} hizo "${fila.accion.replace(/_/g, " ")}" en ${fila.entidad.replace(/_/g, " ")} ${nombre}.`;
}
