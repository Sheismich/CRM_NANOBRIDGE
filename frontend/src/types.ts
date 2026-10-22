// Tipos calcados del contrato HTTP real del backend (los toRow()/mapeos de
// cada *.service.ts en CRM_NANOBRIDGE devuelven snake_case aunque las
// columnas internas estén en camelCase) -- mismo criterio que ya sigue el
// propio backend: "es el mismo contrato HTTP que ya consumen n8n y el CRM,
// solo cambió cómo se arman las queries por dentro" (empresas.service.ts).
// Solo se tipan los campos que el frontend ya usa, no el modelo completo.

export type Rol = "administrador" | "supervisor" | "agente" | "sistema";

export type CurrentUser = {
  id: number;
  nombre: string;
  correo: string;
  rol: Rol;
};

export type Paginated<T> = {
  page: number;
  limit: number;
  data: T[];
};

export type MedioContacto = {
  id: number;
  tipo: "correo" | "telefono" | "whatsapp" | "linkedin" | "sitio_web" | "facebook" | "instagram";
  valor: string;
  estado_contacto: "activo" | "no_contactar" | "obsoleto";
};

export type Empresa = {
  id: number;
  nombre_legal: string;
  nombre_comercial: string | null;
  giro: string | null;
  // GET /empresas lo trae desde el 22-oct-2026 (Nuevo prospecto avisa si falta).
  tamano?: "micro" | "pequena" | "mediana" | "grande" | null;
  region: string | null;
  estado: string | null;
  ciudad: string | null;
  activo: boolean;
  creado_en: string;
};

// Fila de GET /empresas (la lista general): lo de Empresa más el dueño,
// los contactos activos y la fecha de la última actividad.
export type EmpresaListado = Empresa & {
  propietario_id: number | null;
  propietario_nombre: string | null;
  contactos_activos: number;
  ultima_actividad: string | null;
};

export type EmpresaDetalle = Empresa & {
  tamano: "micro" | "pequena" | "mediana" | "grande" | null;
  pais: string;
  sitio_web: string | null;
  linkedin_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  propietario_id: number | null;
  actualizado_en: string;
  contactos: ContactoConMedio[];
};

// Una fila por medio de contacto (GET /empresas/:id) -- distinto de
// /contactos, que trae los medios anidados en `medios` (ver README del
// backend, sección "Módulos construidos").
export type ContactoConMedio = {
  id: number;
  empresa_id: number;
  nombre: string;
  puesto: string | null;
  area: string | null;
  linkedin_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  activo: boolean;
  medio_id: number | null;
  medio_tipo: MedioContacto["tipo"] | null;
  medio_valor: string | null;
  estado_contacto: MedioContacto["estado_contacto"] | null;
};

// GET /actividades?empresaId= (src/crm/actividades.service.ts): mezcla
// actividades capturadas a mano con envíos/respuestas de n8n, tareas
// cerradas y cambios de estado de prospecto. `detalle` cambia de forma
// según `tipo`, por eso queda como registro abierto.
export type TimelineEvento = {
  tipo: "llamada" | "whatsapp" | "comentario" | "correo_enviado" | "correo_recibido" | "correo_respondido" | "tarea" | "cambio_estado_prospecto";
  fecha: string;
  responsable_id: number | null;
  canal: string | null;
  resultado: string | null;
  proxima_accion: string | null;
  detalle: Record<string, unknown>;
};

// GET /respuestas/:id/contestar (etapa 3, 20-oct-2026): lo que hace falta
// para contestarle al prospecto desde el CRM y si se puede.
export type ContextoRespuesta = {
  respuesta_id: number;
  prospecto_id: number;
  empresa_id: number;
  empresa_nombre: string;
  contacto_nombre: string;
  contenido: string | null;
  clasificacion: string | null;
  recibido_en: string;
  para: string | null;
  asunto: string;
  firma: string;
  en_conversacion: boolean;
  tarea_id: number | null;
  tarea_abierta: boolean;
  puede_responder: boolean;
  motivo: string | null;
  // false mientras la API use la IA falsa (IA_DRIVER=falso, 21-oct-2026).
  ia_activa: boolean;
};

// --- Etapa 4: resumen con IA en la ficha (src/resumen-ficha/) ---

// GET y POST /empresas/:id/resumen-ia. El resumen es el último de esta
// persona para esta empresa (cada quien resume lo que ve).
export type ResumenFicha = {
  resumen: { texto: string; siguiente_paso: string | null; creado_en: string } | null;
  desactualizado: boolean;
  ia_activa: boolean;
  puede_generar: boolean;
  motivo: string | null;
};

export type Oportunidad = {
  id: number;
  empresa_id: number;
  titulo: string;
  etapa_clave: string;
  etapa_nombre: string;
  probabilidad: number;
  responsable_id: number | null;
  // DECIMAL de MySQL: llega como string ("125000.00"), no como number.
  valor_estimado: string | null;
  fecha_cierre_estimada: string | null;
  cerrada: boolean;
  // 032: su expediente pide la constancia de situación fiscal.
  lleva_factura: boolean;
  actualizado_en: string;
};

// GET /oportunidades/:id
export type OportunidadDetalle = Oportunidad & {
  contacto_id: number | null;
  motivo_perdida_detalle: string | null;
  historial: {
    id: number;
    etapa_clave: string;
    etapa_nombre: string;
    usuario_id: number | null;
    motivo_perdida_id: number | null;
    comentario: string | null;
    creado_en: string;
  }[];
};

// GET /oportunidades/catalogos
export type CatalogosOportunidad = {
  etapas: { clave: string; nombre: string; probabilidad: number; orden: number; es_cierre: boolean; es_ganada: boolean }[];
  motivos_perdida: { clave: string; nombre: string; requiere_explicacion: boolean }[];
};

export type EstadoCotizacion = "borrador" | "enviada" | "aceptada" | "rechazada" | "vencida" | "obsoleta";

// GET /cotizaciones?empresaId= (solo la versión vigente de cada cadena).
// Montos DECIMAL: llegan como string.
export type Cotizacion = {
  id: number;
  empresa_id: number;
  oportunidad_id: number;
  contacto_id: number | null;
  cotizacion_raiz_id: number | null;
  version: number;
  moneda: string;
  subtotal: string;
  descuento: string;
  impuestos: string;
  total: string;
  fecha_emision: string;
  fecha_envio: string | null;
  fecha_esperada_cierre: string | null;
  probabilidad: number | null;
  estado: EstadoCotizacion;
  creado_en: string;
};

export type CotizacionDetalle = Cotizacion & {
  // detalle: segunda línea opcional de la partida (028, 12-oct-2026).
  partidas: { id: number; descripcion: string; detalle: string | null; cantidad: string; precio_unitario: string; importe: string; orden: number }[];
  versiones: { id: number; version: number; estado: EstadoCotizacion; total: string; creado_en: string }[];
};

export type Documento = {
  id: number;
  empresa_id: number;
  oportunidad_id: number | null;
  contacto_id: number | null;
  version: number;
  nombre_original: string;
  mime_type: string;
  tipo_documento_id: number | null;
  tamano_bytes: number;
  estado: "vigente" | "archivado" | "obsoleto";
  subido_por: number | null;
  revisado_por: number | null;
  revisado_en: string | null;
  creado_en: string;
  // Aprobar / rechazar (migración 029, 12-oct-2026).
  documento_raiz_id: number | null;
  revision: "por_revisar" | "aprobado" | "rechazado";
  motivo_rechazo: string | null;
  motivo_rechazo_detalle: string | null;
  actualizado_en: string;
};

// GET /documentos (bandeja): el documento con los nombres que pinta la lista.
export type DocumentoBandeja = Documento & { empresa_nombre: string; tipo_nombre: string | null; revisado_por_nombre: string | null };

// GET /documentos/:id: además, sus versiones.
export type DocumentoDetalle = Documento & { versiones: { id: number; version: number; estado: Documento["estado"]; creado_en: string }[] };

export type ConteosDocumentos = { por_revisar: number; aprobados: number; rechazados: number; expedientes_incompletos: number };

// alcance (migración 032, 16-oct-2026): "venta" = el papel es de una
// oportunidad (al subirlo hay que elegirla); "empresa" = de la empresa.
// solo_con_factura: solo se pide si la venta lleva factura.
export type TipoDocumento = { id: number; clave: string; nombre: string; obligatorio: boolean; alcance: "venta" | "empresa"; solo_con_factura: boolean };

export type CatalogosDocumentos = {
  tipos_documento: TipoDocumento[];
  motivos_rechazo: { clave: string; nombre: string }[];
};

// Un papel obligatorio del expediente de una venta. La cotización puede
// cumplirse sola con la cotización aceptada del CRM (origen "cotizacion_crm").
export type PapelExpediente = {
  tipo_id: number;
  clave: string;
  nombre: string;
  alcance: TipoDocumento["alcance"];
  estado: "falta" | Documento["revision"];
  origen: "documento" | "cotizacion_crm" | null;
  documento: { id: number; nombre_original: string; version: number; creado_en: string; revisado_en: string | null; motivo_rechazo: string | null; motivo_rechazo_detalle: string | null } | null;
  cotizacion: { id: number; version: number } | null;
};

// El expediente de una venta (oportunidad abierta o ganada). Solo las
// ganadas cuentan en "Expedientes incompletos".
export type ExpedienteVenta = {
  oportunidad_id: number;
  titulo: string;
  ganada: boolean;
  lleva_factura: boolean;
  papeles: PapelExpediente[];
  aprobados: number;
  total: number;
  completo: boolean;
};

// GET /documentos/expediente/:empresaId: por venta desde el 16-oct-2026,
// las ganadas primero (antes era uno solo por empresa).
export type Expediente = { empresa_id: number; ventas: ExpedienteVenta[] };

export type EstadoBorrador = "pendiente_revision" | "duplicado" | "importado" | "rechazado" | "expirado";

// GET /prospectos/importaciones
export type LoteImportacion = {
  lote_id: string;
  fuente: string;
  creado_en: string;
  creado_por: number;
  total: number;
  resumen: Record<EstadoBorrador, number>;
};

// Una fila de GET /prospectos/importaciones/:loteId
export type Borrador = {
  id: number;
  lote_id: string;
  fila_numero: number;
  empresa_nombre_legal: string | null;
  contacto_nombre: string | null;
  correo: string | null;
  telefono: string | null;
  canal_inicial: "correo" | "telefono" | "whatsapp" | null;
  prioridad: "alta" | "media" | "baja" | null;
  estado: EstadoBorrador;
  match_contacto_id: number | null;
  match_motivo: "correo" | "telefono" | null;
  errores: { campo: string; mensaje: string }[] | null;
  prospecto_id: number | null;
};

// GET /prospectos
export type ProspectoResumen = {
  id: number;
  estado: string;
  score: string | null;
  prioridad: "alta" | "media" | "baja" | null;
  contacto_nombre: string;
  empresa_id: number;
  empresa_nombre_legal: string;
  creado_en: string;
};

// Lo de la fila de automatización que traen la lista y el detalle
// (16-oct-2026). Las fechas vienen de Drizzle (ISO); fila_posicion: 1 = el
// siguiente en salir, null si no está en la fila o PT1 ya lo tomó.
// campana_vigencia (shared/campana-vigente.ts): en_espera = pausada o aún
// no empieza (espera sin aviso), inactiva = "campaña terminada".
export type DatosFila = {
  fila_desde: string | null;
  fila_tomado_en: string | null;
  fila_posicion: number | null;
  campana_vigencia: "activa" | "en_espera" | "inactiva" | null;
  // Solo en los excluidos: por qué se excluyó la vez pasada (claves de
  // Validaciones o el texto de PT1); null si no se sabe.
  motivo_exclusion_anterior: string[] | null;
};

// GET /prospectos/:id (ProspectosService.getProspecto).
export type ProspectoDetalle = DatosFila & {
  id: number;
  estado: string;
  score: string | null;
  prioridad: "alta" | "media" | "baja" | null;
  confianza: "alta" | "media" | "baja" | null;
  fuente_url: string | null;
  campana_id: number | null;
  creado_en: string;
  contacto: {
    id: number;
    nombre: string;
    puesto: string | null;
    medios: Pick<MedioContacto, "tipo" | "valor" | "estado_contacto">[];
  };
  empresa: { id: number; nombre_legal: string };
};

export type Tarea = {
  id: number;
  tipo: "seguimiento" | "clasificacion" | "revision_documento" | "otro";
  titulo: string;
  descripcion: string | null;
  estado: "pendiente" | "en_progreso" | "cerrada" | "cancelada";
  prioridad: "baja" | "media" | "alta" | "urgente";
  responsable_id: number | null;
  empresa_id: number | null;
  // Solo en GET /tareas y /cola-clasificacion (join con empresas).
  empresa_nombre?: string | null;
  prospecto_id: number | null;
  respuesta_id: number | null;
  fecha_limite: string | null;
  clasificacion: Clasificacion | null;
  resultado: string | null;
  cerrada_en: string | null;
  creado_en: string;
};

// GET /tareas/:id: la tarea con lo necesario para trabajarla (Mi día y el
// detalle de "Ver todas"). respuesta = la que la originó, si la hay.
export type TareaDetalle = Tarea & {
  empresa_nombre: string | null;
  contacto_nombre: string | null;
  contacto_puesto: string | null;
  contacto_telefono: { tipo: "telefono" | "whatsapp"; valor: string } | null;
  campana_nombre: string | null;
  responsable_nombre: string | null;
  respuesta: {
    id: number;
    contenido: string | null;
    recibido_en: string | null;
    clasificacion: string | null;
    clasificacion_sugerida: string | null;
    confianza_sugerida: number | null;
    motivo_sugerencia: string | null;
  } | null;
};

// GET /tareas/:id/historial, lo más nuevo primero.
export type EventoTarea =
  | { tipo: "creada"; fecha: string }
  | { tipo: "asignada"; fecha: string; usuario_nombre: string | null; responsable_id: number | null }
  | { tipo: "reprogramada"; fecha: string; usuario_nombre: string | null; fecha_limite: string | null }
  | { tipo: "cerrada"; fecha: string; usuario_nombre: string | null; resultado: string | null }
  | { tipo: "envio"; fecha: string; numero_contacto: number; canal: string }
  | { tipo: "respuesta"; fecha: string; clasificacion: string | null; contenido: string | null };

// GET /tareas/conteos (Mi día y el numerito de Tareas del menú): siempre
// de quien pregunta, días en hora de México.
export type ConteosTareas = {
  cerradas_hoy: number;
  cerradas_ayer: number;
  pendientes_hoy: number; // abiertas que vencen hoy
  vencidas: number; // abiertas con fecha límite antes de hoy
};

export type Clasificacion = "interesado" | "no_interesado" | "baja" | "invalido" | "reagendar";

// GET /cola-clasificacion: la tarea más lo necesario para decidir.
export type TareaClasificacion = Tarea & {
  contacto_nombre: string | null;
  contacto_puesto: string | null;
  respuesta: {
    id: number;
    canal: "correo" | "whatsapp" | null;
    contenido: string | null;
    recibido_en: string | null;
    // Lo que propone la IA (migración 023; si no hay sugerencia, lo que
    // decidió n8n, normalmente "ambigua"), qué tan segura está (0-100) y por qué.
    clasificacion_sugerida: string | null;
    confianza_sugerida: number | null;
    motivo_sugerencia: string | null;
    // El "From" del correo (migración 024); null en respuestas anteriores.
    remitente: string | null;
  } | null;
};

// --- Reportes (solo administrador/supervisor; src/reportes/reportes.service.ts) ---

export type Usuario = {
  id: number;
  nombre: string;
  correo: string;
  rol: Rol;
  activo: boolean;
  creado_en?: string;
  // Migración 030 (12-oct-2026); null si nunca ha entrado desde entonces.
  ultimo_acceso_en?: string | null;
};

// --- Administración (rediseño, 13-oct-2026; src/admin) ---

// GET /admin/salud
export type SaludSistema = {
  revisado_en: string;
  api: { estado: "ok"; revision: string | null };
  base_datos: { estado: "ok" | "error"; responde_ms: number | null };
  avisos_n8n: { estado: "ok" | "atencion"; configurado: boolean; en_espera: number; fallidos: number } | null;
  correos: { enviados_hoy: number; ultimo_envio_en: string | null } | null;
  por_configurar: { clave: string; texto: string }[];
  resumen: { por_configurar: number; problemas_abiertos: number } | null;
};

// GET /admin/problemas → { grupos }
export type GrupoProblemas = {
  clave: string;
  tipo: "aviso_api" | "workflow_n8n" | "otro";
  cantidad: number;
  mensaje: string;
  workflow: string | null;
  nodo: string | null;
  tipos_evento: { tipo: string; cantidad: number }[];
  desde: string;
  hasta: string;
  acciones: ("reintentar" | "resolver")[];
};

export type TipoRegistro = "usuarios_roles" | "ediciones" | "borrados" | "descargas" | "configuracion";

// GET /admin/registro-cambios → { page, limit, total, data }
export type FilaRegistro = {
  id: number;
  fecha: string;
  usuario: { id: number; nombre: string };
  tipo: TipoRegistro;
  accion: string;
  registro: { entidad: string; id: number; nombre: string | null };
  texto: string;
  cambios: { campo: string; etiqueta: string; antes: string; despues: string }[];
  antes: Record<string, unknown> | null;
};

export type PipelineResumen = {
  // valor_ponderado: desde el 13-oct-2026 (Inicio); opcional hasta que ese
  // backend esté desplegado.
  abiertas: { cantidad: number; valor_pipeline: string; valor_ponderado?: string };
  ganadas: { cantidad: number; ingresos_cerrados: string };
  perdidas: { cantidad: number; valor_perdido: string };
  cierre_este_mes: { cantidad: number; valor: string };
  cierre_vencido: { cantidad: number; valor: string };
};

export type ReporteTareas = {
  cerradas: { total: number; por_tipo: { tipo: Tarea["tipo"]; cantidad: number }[] };
  vencidas: { total: number; por_tipo: { tipo: Tarea["tipo"]; cantidad: number }[] };
};

export type ConversionEtapas = {
  base_calificadas: number;
  etapas: { etapa_clave: string; etapa_nombre: string; orden: number; oportunidades_alcanzadas: number; conversion_desde_calificada_pct: number | null }[];
  perdidas: { oportunidades: number; tasa_perdida_pct: number | null };
};

export type ForecastMes = { mes: string; cantidad: number; valor_estimado_total: string; valor_ponderado: string };

export type DesempenoAgente = {
  responsable_id: number;
  responsable_nombre: string;
  actividades: { llamada: number; whatsapp: number; comentario: number; total: number };
  tareas: { cerradas: number; vencidas: number };
  oportunidades: { ganadas: number; ingresos_cerrados: string };
};

// GET /reportes/prospeccion: envíos y respuestas de la automatización. Las
// respuestas automáticas (fuera de oficina) van aparte y no cuentan para la
// tasa; tasa_respuesta_pct es null sin personas contactadas.
export type ReporteProspeccion = {
  envios: { total: number; inicial: number; recordatorio_1: number; recordatorio_2: number; personas_contactadas: number };
  respuestas: {
    total: number;
    automaticas: number;
    tardias: number;
    pendientes_clasificar: number;
    por_clasificacion: { clasificacion: string; cantidad: number }[];
    personas_que_respondieron: number;
  };
  tasa_respuesta_pct: number | null;
  por_campana: {
    campana_id: number | null;
    campana_nombre: string;
    envios: number;
    personas_contactadas: number;
    personas_que_respondieron: number;
    interesados: number;
    tasa_respuesta_pct: number | null;
  }[];
};

// --- Inicio (rediseño, 13-oct-2026) ---

// GET /reportes/prospeccion/por-dia: un renglón por día de México del rango,
// los días sin movimiento en cero.
export type ProspeccionDia = { fecha: string; envios: number; respuestas: number };

// GET /reportes/actividad-reciente ("Lo que acaba de pasar"), lo más nuevo
// primero. Los envíos vienen uno por uno; la pantalla los agrupa.
type PersonaEvento = {
  fecha: string;
  prospecto_id: number;
  contacto_nombre: string;
  empresa_id: number;
  empresa_nombre: string;
  campana_id: number | null;
  campana_nombre: string | null;
};
export type EventoReciente =
  | (PersonaEvento & { tipo: "respuesta"; clasificacion: string | null; estado: "pendiente_clasificacion" | "clasificada"; tardia: boolean })
  | (PersonaEvento & { tipo: "envio"; numero_contacto: number; canal: string })
  | (PersonaEvento & { tipo: "baja"; motivo: string | null });

export type MetricaDiaria = {
  fecha: string;
  oportunidades_abiertas: number;
  valor_pipeline: string;
  oportunidades_ganadas: number;
  ingresos_cerrados: string;
  oportunidades_perdidas: number;
  valor_perdido: string;
  calculado_en: string;
};

// --- Administración (src/usuarios, src/outbox) ---

export type RegistroAuditoria = {
  id: number;
  usuario_id: number | null;
  entidad: string;
  entidad_id: number;
  accion: string;
  antes: unknown;
  despues: unknown;
  creado_en: string;
};

export type EventoPendiente = {
  id: number;
  evento_uuid: string;
  tipo: string;
  entidad_tipo: string;
  entidad_id: number;
  payload: unknown;
  estado: "pendiente" | "procesando" | "enviado" | "fallido";
  intentos: number;
  proximo_intento_en: string | null;
  ultimo_error: string | null;
  creado_en: string;
};

export type ProcesoFallido = {
  id: number;
  evento_id: number | null;
  execution_id: string | null;
  workflow: string | null;
  nodo: string | null;
  endpoint: string | null;
  codigo_http: number | null;
  tipo: string;
  payload: unknown;
  mensaje: string | null;
  estado: "abierto" | "en_revision" | "resuelto";
  creado_en: string;
  actualizado_en: string;
};

// GET /contactos (src/crm/contactos.service.ts): cada contacto con su
// empresa y todos sus medios (incluidos los no_contactar/obsoletos).
export type ContactoLista = {
  id: number;
  empresa_id: number;
  empresa_nombre: string;
  nombre: string;
  puesto: string | null;
  area: string | null;
  linkedin_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  medios: { id: number; tipo: MedioContacto["tipo"]; valor: string; estado_contacto: MedioContacto["estado_contacto"] }[];
};

// --- Prospectos (rediseño, Mich; src/crm/prospectos.service.ts) ---

// Fila de GET /prospectos: lo de ProspectoResumen más lo que la lista nueva
// enseña sin pedir cada ficha. `envios` es el "1/3"; `ultimo_envio_en` sale
// crudo de MySQL ("YYYY-MM-DD HH:MM:SS", UTC), leerlo con fechaUtc().
export type ProspectoFila = ProspectoResumen & DatosFila & {
  confianza: "alta" | "media" | "baja" | null;
  contacto_id: number;
  contacto_puesto: string | null;
  empresa_giro: string | null;
  empresa_estado: string | null;
  campana_id: number | null;
  campana_nombre: string | null;
  envios: number;
  ultimo_envio_en: string | null;
};

// GET /prospectos/conteos: cuántos hay en cada estado y cuántos ya
// recibieron al menos un correo (de cualquier estado).
export type ConteosProspectos = {
  total: number;
  contactados: number;
  // Validados con al menos un correo (15-oct-2026); undefined antes de ese deploy.
  en_campana?: number;
  por_estado: { estado: string; cantidad: number }[];
};

// Una campaña de GET /reportes/prospeccion (por_campana), que desde el
// 12-oct también trae cuántas personas resultaron interesadas.
export type CampanaProspeccion = ReporteProspeccion["por_campana"][number] & { interesados: number };

// --- Empresas + ficha (rediseño, Mich; src/crm/empresas.service.ts) ---

// Qué fue lo último que pasó con la empresa (GET /empresas →
// ultima_actividad_detalle): una actividad registrada, un correo de la
// secuencia (con su número) o una respuesta (con su clasificación).
export type UltimaActividadDetalle =
  | { tipo: "actividad"; actividad_tipo: "llamada" | "whatsapp" | "comentario" }
  | { tipo: "envio"; numero_contacto: number }
  | { tipo: "respuesta"; clasificacion: string | null };

export type EmpresaFila = EmpresaListado & {
  // Su prospecto más reciente y cuántos correos lleva; null si nunca fue prospecto.
  prospeccion: { estado: string; envios: number } | null;
  ultima_actividad_detalle: UltimaActividadDetalle | null;
};

// GET /empresas/conteos (tarjetas de arriba de la lista).
export type ConteosEmpresas = {
  total: number;
  sin_responsable: number;
  sin_actividad_30_dias: number;
  con_oportunidad_abierta: number;
  valor_oportunidades_abiertas: string;
};

// GET /empresas/:id desde el 12-oct: de dónde vino (fuente del prospecto más reciente).
export type EmpresaFicha = EmpresaDetalle & { fuente_url: string | null; prospeccion: EmpresaFila["prospeccion"] };

// --- Contactos (rediseño, Mich; src/crm/contactos.service.ts) ---

// Fila de GET /contactos desde el 9-oct: con el prospecto más reciente de la
// persona (estado y correos que lleva); null si nunca fue prospecto.
export type ContactoFila = ContactoLista & { prospeccion: { estado: string; envios: number } | null };

// GET /contactos/conteos. escribibles = algún correo, teléfono o WhatsApp
// activo; no_contactar = ninguno activo y alguno en no_contactar; sin_medio
// = ni lo uno ni lo otro.
export type ConteosContactos = { total: number; escribibles: number; no_contactar: number; sin_medio: number };

// --- Oportunidades (rediseño, Mich; src/comercial/oportunidades.service.ts) ---

// Fila de GET /oportunidades desde el 12-oct: con empresa, responsable y
// cuántos días lleva en su etapa (null si no hay historial).
export type OportunidadTablero = Oportunidad & {
  empresa_nombre: string | null;
  responsable_nombre: string | null;
  etapa_desde: string | null;
  dias_en_etapa: number | null;
};

// GET /reportes/pipeline/conversion-etapas desde el 12-oct: el ciclo medio de
// venta (días de creada a ganada, promedio) de las ganadas en el rango.
export type ConversionConCiclo = ConversionEtapas & { ciclo_medio_venta: { dias: number | null; ganadas: number } };

// --- Cotizaciones (rediseño, Mich; src/comercial/cotizaciones.service.ts) ---

export type MotivoRechazoCotizacion = "precio" | "tiempo_entrega" | "otro_proveedor" | "sin_presupuesto" | "ya_no_lo_necesita" | "otro";

// Fila de GET /cotizaciones desde el 12-oct: con empresa, oportunidad,
// responsable, el motivo si se rechazó y los días para los avisos del
// tablero (días de calendario de México; dias_para_cierre es negativo si
// el cierre ya pasó y null sin fecha).
export type CotizacionTablero = Cotizacion & {
  motivo_rechazo: MotivoRechazoCotizacion | null;
  motivo_rechazo_detalle: string | null;
  actualizado_en: string;
  empresa_nombre: string | null;
  oportunidad_titulo: string | null;
  responsable_nombre: string | null;
  dias_desde_envio: number | null;
  dias_para_cierre: number | null;
};

// GET /cotizaciones/:id desde el 12-oct: lo que dice el documento arriba
// ("Para" y "Oportunidad").
export type CotizacionDocumento = CotizacionDetalle & {
  motivo_rechazo: MotivoRechazoCotizacion | null;
  motivo_rechazo_detalle: string | null;
  actualizado_en: string;
  empresa_nombre: string | null;
  empresa_nombre_legal: string | null;
  contacto_nombre: string | null;
  contacto_puesto: string | null;
  oportunidad_titulo: string | null;
  etapa_nombre: string | null;
};

// GET /cotizaciones/conteos. Montos DECIMAL como string. La tasa es
// aceptadas / (aceptadas + rechazadas); pct null si nadie ha respondido.
type ConteoEstado = { cantidad: number; total: string };
export type ConteosCotizaciones = {
  borrador: ConteoEstado;
  enviada: ConteoEstado;
  aceptada: ConteoEstado;
  rechazada: ConteoEstado;
  vencida: ConteoEstado;
  obsoleta: { cantidad: number };
  aceptadas_este_mes: ConteoEstado;
  tasa_aceptacion: { aceptadas: number; respondidas: number; pct: number | null };
};

// --- Reportes (rediseño, Mich; src/reportes/reportes.service.ts y reporte-dia.service.ts) ---

// GET /reportes/tareas desde el 11-oct: además de cerradas y vencidas, qué
// tanto se cierra a tiempo, lo resuelto esta semana y lo creado por tipo.
export type ReporteTareasPanel = ReporteTareas & {
  a_tiempo: { a_tiempo: number; con_fecha_limite: number; pct: number | null };
  cerradas_esta_semana: number;
  creadas: { total: number; por_tipo: { tipo: Tarea["tipo"]; cantidad: number }[] };
};

// GET /reportes/actividades: una fila por persona con actividades en el rango.
export type ActividadesPorAgente = { responsable_id: number; responsable_nombre: string; llamada: number; whatsapp: number; comentario: number; total: number }[];

export type TipoBitacora = "tareas" | "correos" | "respuestas" | "bajas" | "documentos" | "sistema";

// Un movimiento de la bitácora. usuario_id = quién lo hizo (null = la
// automatización, un contacto o el sistema); texto va sin ese nombre.
export type MovimientoDia = {
  tipo: TipoBitacora;
  subtipo: string;
  fecha: string;
  usuario_id: number | null;
  usuario_nombre: string | null;
  responsable_id?: number | null;
  responsable_nombre?: string | null;
  contacto_nombre?: string;
  empresa_id: number | null;
  empresa_nombre: string | null;
  entidad: { tipo: string; id: number } | null;
  texto: string;
};

// GET /reportes/dia. Con persona (usuarioId, y siempre para un agente), lo
// que no es de una persona (correos, respuestas, bajas, avisos) llega null.
export type ReporteDia = {
  fecha: string;
  resumen: {
    correos: { enviados: number; campanas: number; ultimo_en: string | null } | null;
    respuestas: { recibidas: number; interesados: number } | null;
    tareas_cerradas: { cerradas: number; vencian_ese_dia: number };
    tareas_creadas: { creadas: number; por_automatizacion: number };
    bajas: { total: number; ultima: { contacto_nombre: string; fecha: string } | null } | null;
  };
  para_revisar: { vencidas_sin_cerrar: number; avisos_fallidos: number | null };
  bitacora: { total: number; page: number; limit: number; data: MovimientoDia[] };
  por_persona: { usuario_id: number; nombre: string | null; primera_accion: string | null; ultima_accion: string | null; tareas_que_cerro: number; tomadas: number; vencidas: number }[];
  automatizacion: { correos: number; tareas_creadas: number } | null;
  quedo_pendiente: { tarea_id: number; titulo: string; estado: string; fecha_limite: string; responsable_id: number | null; responsable_nombre: string | null; empresa_id: number | null; empresa_nombre: string | null }[];
};
