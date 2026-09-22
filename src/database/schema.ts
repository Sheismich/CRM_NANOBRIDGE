import { sql } from "drizzle-orm";
import { bigint, boolean, char, date, datetime, int, json, mysqlEnum, mysqlTable, smallint, uniqueIndex, varchar, decimal, index, text } from "drizzle-orm/mysql-core";

/**
 * Espejo tipado de src/database/migrations/001_initial_schema.sql.
 *
 * La fuente de verdad del esquema sigue siendo esa migración SQL, aplicada
 * por src/database/migrate.ts (npm run migrate) — este archivo NO se usa
 * para generar ni aplicar migraciones (no se corre `drizzle-kit generate`
 * ni `drizzle-kit push` contra él). Solo describe las tablas ya existentes
 * para que las queries de la app tengan tipos reales en vez de
 * RowDataPacket[] + casts manuales.
 *
 * Si agregas una migración nueva (o modificas una existente), refleja el
 * cambio aquí a mano.
 */

export const roles = mysqlTable("roles", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  clave: varchar("clave", { length: 30 }).notNull(),
  nombre: varchar("nombre", { length: 100 }).notNull(),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  uniqueIndex("uq_roles_clave").on(table.clave)
]);

export const usuarios = mysqlTable("usuarios", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  rolId: bigint("rol_id", { mode: "number", unsigned: true }).notNull(),
  nombre: varchar("nombre", { length: 160 }).notNull(),
  correo: varchar("correo", { length: 254 }).notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  activo: boolean("activo").notNull().default(true),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`),
  actualizadoEn: datetime("actualizado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  uniqueIndex("uq_usuarios_correo").on(table.correo)
]);

export const sesiones = mysqlTable("sesiones", {
  id: char("id", { length: 64 }).primaryKey(),
  usuarioId: bigint("usuario_id", { mode: "number", unsigned: true }).notNull(),
  expiraEn: datetime("expira_en").notNull(),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  index("idx_sesiones_expira").on(table.expiraEn)
]);

export const empresas = mysqlTable("empresas", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  nombreLegal: varchar("nombre_legal", { length: 255 }).notNull(),
  nombreComercial: varchar("nombre_comercial", { length: 255 }),
  giro: varchar("giro", { length: 120 }),
  tamano: mysqlEnum("tamano", ["micro", "pequena", "mediana", "grande"]),
  region: varchar("region", { length: 120 }),
  estado: varchar("estado", { length: 120 }),
  ciudad: varchar("ciudad", { length: 120 }),
  pais: char("pais", { length: 2 }).notNull().default("MX"),
  sitioWeb: varchar("sitio_web", { length: 2048 }),
  linkedinUrl: varchar("linkedin_url", { length: 2048 }),
  facebookUrl: varchar("facebook_url", { length: 2048 }),
  instagramUrl: varchar("instagram_url", { length: 2048 }),
  propietarioId: bigint("propietario_id", { mode: "number", unsigned: true }),
  activo: boolean("activo").notNull().default(true),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`),
  actualizadoEn: datetime("actualizado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  index("idx_empresas_propietario").on(table.propietarioId)
]);

export const contactos = mysqlTable("contactos", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  empresaId: bigint("empresa_id", { mode: "number", unsigned: true }).notNull(),
  nombre: varchar("nombre", { length: 160 }).notNull(),
  puesto: varchar("puesto", { length: 160 }),
  area: varchar("area", { length: 160 }),
  linkedinUrl: varchar("linkedin_url", { length: 2048 }),
  facebookUrl: varchar("facebook_url", { length: 2048 }),
  instagramUrl: varchar("instagram_url", { length: 2048 }),
  activo: boolean("activo").notNull().default(true),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`),
  actualizadoEn: datetime("actualizado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  index("idx_contactos_empresa").on(table.empresaId)
]);

export const mediosContacto = mysqlTable("medios_contacto", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  empresaId: bigint("empresa_id", { mode: "number", unsigned: true }),
  contactoId: bigint("contacto_id", { mode: "number", unsigned: true }),
  tipo: mysqlEnum("tipo", ["correo", "telefono", "whatsapp", "linkedin", "sitio_web"]).notNull(),
  valor: varchar("valor", { length: 512 }).notNull(),
  valorNormalizado: varchar("valor_normalizado", { length: 512 }).notNull(),
  esPrincipal: boolean("es_principal").notNull().default(false),
  estadoContacto: mysqlEnum("estado_contacto", ["activo", "no_contactar", "obsoleto"]).notNull().default("activo"),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  index("idx_medios_empresa").on(table.empresaId),
  index("idx_medios_contacto").on(table.contactoId)
]);

export const campanas = mysqlTable("campanas", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  nombre: varchar("nombre", { length: 160 }).notNull(),
  canal: mysqlEnum("canal", ["correo", "whatsapp"]).notNull().default("correo"),
  estado: mysqlEnum("estado", ["borrador", "activa", "pausada", "finalizada"]).notNull().default("borrador"),
  fechaInicio: date("fecha_inicio", { mode: "string" }),
  fechaFin: date("fecha_fin", { mode: "string" }),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`),
  actualizadoEn: datetime("actualizado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const prospectos = mysqlTable("prospectos", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  contactoId: bigint("contacto_id", { mode: "number", unsigned: true }).notNull(),
  campanaId: bigint("campana_id", { mode: "number", unsigned: true }),
  executionId: varchar("execution_id", { length: 100 }),
  estado: varchar("estado", { length: 60 }).notNull().default("capturado"),
  score: decimal("score", { precision: 5, scale: 2 }),
  prioridad: mysqlEnum("prioridad", ["alta", "media", "baja"]),
  fuenteUrl: varchar("fuente_url", { length: 2048 }),
  confianza: mysqlEnum("confianza", ["alta", "media", "baja"]),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`),
  actualizadoEn: datetime("actualizado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  index("idx_prospectos_contacto").on(table.contactoId)
]);

export const catalogoEtapaEmbudo = mysqlTable("catalogo_etapa_embudo", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  clave: varchar("clave", { length: 40 }).notNull(),
  nombre: varchar("nombre", { length: 80 }).notNull(),
  probabilidad: int("probabilidad").notNull(),
  orden: int("orden").notNull(),
  esCierre: boolean("es_cierre").notNull().default(false),
  esGanada: boolean("es_ganada").notNull().default(false),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  uniqueIndex("uq_etapa_embudo_clave").on(table.clave)
]);

export const catalogoMotivoPerdida = mysqlTable("catalogo_motivo_perdida", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  clave: varchar("clave", { length: 40 }).notNull(),
  nombre: varchar("nombre", { length: 120 }).notNull(),
  requiereExplicacion: boolean("requiere_explicacion").notNull().default(false),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  uniqueIndex("uq_motivo_perdida_clave").on(table.clave)
]);

export const oportunidades = mysqlTable("oportunidades", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  empresaId: bigint("empresa_id", { mode: "number", unsigned: true }).notNull(),
  contactoId: bigint("contacto_id", { mode: "number", unsigned: true }),
  prospectoId: bigint("prospecto_id", { mode: "number", unsigned: true }),
  titulo: varchar("titulo", { length: 255 }).notNull(),
  etapaId: bigint("etapa_id", { mode: "number", unsigned: true }).notNull(),
  responsableId: bigint("responsable_id", { mode: "number", unsigned: true }).notNull(),
  valorEstimado: decimal("valor_estimado", { precision: 12, scale: 2 }),
  fechaCierreEstimada: date("fecha_cierre_estimada", { mode: "string" }),
  motivoPerdidaId: bigint("motivo_perdida_id", { mode: "number", unsigned: true }),
  motivoPerdidaDetalle: varchar("motivo_perdida_detalle", { length: 500 }),
  cerrada: boolean("cerrada").notNull().default(false),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`),
  actualizadoEn: datetime("actualizado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  index("idx_oportunidades_empresa").on(table.empresaId),
  index("idx_oportunidades_responsable").on(table.responsableId)
]);

export const historialEtapaOportunidad = mysqlTable("historial_etapa_oportunidad", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  oportunidadId: bigint("oportunidad_id", { mode: "number", unsigned: true }).notNull(),
  etapaId: bigint("etapa_id", { mode: "number", unsigned: true }).notNull(),
  usuarioId: bigint("usuario_id", { mode: "number", unsigned: true }).notNull(),
  motivoPerdidaId: bigint("motivo_perdida_id", { mode: "number", unsigned: true }),
  comentario: varchar("comentario", { length: 500 }),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  index("idx_historial_etapa_oportunidad").on(table.oportunidadId)
]);

// Cotizaciones (PLAN_CRM_DEFINITIVO.md #7): cada fila es una versión.
// version=1 y cotizacionRaizId=null para la primera; las siguientes
// apuntan a la fila de la versión 1 vía cotizacionRaizId, así se recupera
// toda la cadena con (id = X OR cotizacionRaizId = X).
export const cotizaciones = mysqlTable("cotizaciones", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  empresaId: bigint("empresa_id", { mode: "number", unsigned: true }).notNull(),
  oportunidadId: bigint("oportunidad_id", { mode: "number", unsigned: true }).notNull(),
  contactoId: bigint("contacto_id", { mode: "number", unsigned: true }),
  cotizacionRaizId: bigint("cotizacion_raiz_id", { mode: "number", unsigned: true }),
  version: int("version").notNull().default(1),
  moneda: char("moneda", { length: 3 }).notNull().default("MXN"),
  subtotal: decimal("subtotal", { precision: 12, scale: 2 }).notNull(),
  descuento: decimal("descuento", { precision: 12, scale: 2 }).notNull().default("0"),
  impuestos: decimal("impuestos", { precision: 12, scale: 2 }).notNull().default("0"),
  total: decimal("total", { precision: 12, scale: 2 }).notNull(),
  fechaEmision: date("fecha_emision", { mode: "string" }).notNull(),
  fechaEnvio: date("fecha_envio", { mode: "string" }),
  fechaEsperadaCierre: date("fecha_esperada_cierre", { mode: "string" }),
  probabilidad: int("probabilidad"),
  estado: mysqlEnum("estado", ["borrador", "enviada", "aceptada", "rechazada", "vencida", "obsoleta"]).notNull().default("borrador"),
  creadoPor: bigint("creado_por", { mode: "number", unsigned: true }).notNull(),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`),
  actualizadoEn: datetime("actualizado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  index("idx_cotizaciones_empresa").on(table.empresaId),
  index("idx_cotizaciones_oportunidad").on(table.oportunidadId),
  index("idx_cotizaciones_raiz").on(table.cotizacionRaizId)
]);

export const cotizacionPartidas = mysqlTable("cotizacion_partidas", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  cotizacionId: bigint("cotizacion_id", { mode: "number", unsigned: true }).notNull(),
  descripcion: varchar("descripcion", { length: 255 }).notNull(),
  cantidad: decimal("cantidad", { precision: 10, scale: 2 }).notNull(),
  precioUnitario: decimal("precio_unitario", { precision: 12, scale: 2 }).notNull(),
  importe: decimal("importe", { precision: 12, scale: 2 }).notNull(),
  orden: int("orden").notNull().default(0),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  index("idx_cotizacion_partidas_cotizacion").on(table.cotizacionId)
]);

// Historial integral (PLAN_CRM_DEFINITIVO.md #4): solo lo que no tiene
// tabla propia -- llamadas/WhatsApp manuales y comentarios del asesor. El
// resto de la línea de tiempo (correos, tareas, cambios de estado) se lee
// en vivo de envios/respuestas/tareas/auditoria, no se duplica aquí.
export const actividades = mysqlTable("actividades", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  empresaId: bigint("empresa_id", { mode: "number", unsigned: true }).notNull(),
  contactoId: bigint("contacto_id", { mode: "number", unsigned: true }),
  oportunidadId: bigint("oportunidad_id", { mode: "number", unsigned: true }),
  tipo: mysqlEnum("tipo", ["llamada", "whatsapp", "comentario"]).notNull(),
  resultado: varchar("resultado", { length: 255 }),
  proximaAccion: varchar("proxima_accion", { length: 255 }),
  comentario: text("comentario"),
  responsableId: bigint("responsable_id", { mode: "number", unsigned: true }).notNull(),
  ocurridaEn: datetime("ocurrida_en").notNull().default(sql`CURRENT_TIMESTAMP`),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  index("idx_actividades_empresa").on(table.empresaId),
  index("idx_actividades_contacto").on(table.contactoId)
]);

export const tareas = mysqlTable("tareas", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  tipo: mysqlEnum("tipo", ["seguimiento", "clasificacion", "revision_documento", "otro"]).notNull().default("seguimiento"),
  titulo: varchar("titulo", { length: 255 }).notNull(),
  descripcion: text("descripcion"),
  estado: mysqlEnum("estado", ["pendiente", "en_progreso", "cerrada", "cancelada"]).notNull().default("pendiente"),
  prioridad: mysqlEnum("prioridad", ["baja", "media", "alta", "urgente"]).notNull().default("media"),
  // Nullable desde 006_tareas_automatizacion.sql: n8n crea tareas sin
  // responsable (bandeja sin asignar), a diferencia de las que crea un
  // usuario de sesión en POST /api/v1/tareas.
  responsableId: bigint("responsable_id", { mode: "number", unsigned: true }),
  empresaId: bigint("empresa_id", { mode: "number", unsigned: true }),
  contactoId: bigint("contacto_id", { mode: "number", unsigned: true }),
  prospectoId: bigint("prospecto_id", { mode: "number", unsigned: true }),
  executionId: varchar("execution_id", { length: 100 }),
  fechaLimite: datetime("fecha_limite"),
  alertadoEn: datetime("alertado_en"),
  clasificacion: varchar("clasificacion", { length: 60 }),
  resultado: text("resultado"),
  cerradaEn: datetime("cerrada_en"),
  // Nullable desde 006_tareas_automatizacion.sql: NULL = creada por
  // automatización (n8n), no por un usuario de sesión.
  creadaPor: bigint("creada_por", { mode: "number", unsigned: true }),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`),
  actualizadoEn: datetime("actualizado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  index("idx_tareas_responsable_estado").on(table.responsableId, table.estado),
  index("idx_tareas_tipo_estado").on(table.tipo, table.estado),
  index("idx_tareas_fecha_limite").on(table.fechaLimite)
]);

// eventoUuid (020_eventos_pendientes_uuid.sql): clave de idempotencia hacia
// los webhooks de n8n (B3) -- se manda en el payload de deliver() para que
// n8n pueda deduplicar si un reintento reenvía un evento ya entregado.
// Nombrada evento_uuid (no evento_id) para no chocar con
// procesosFallidos.eventoId, que es una FK BIGINT con significado distinto.
export const eventosPendientes = mysqlTable("eventos_pendientes", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  eventoUuid: char("evento_uuid", { length: 36 }).notNull(),
  tipo: varchar("tipo", { length: 100 }).notNull(),
  entidadTipo: varchar("entidad_tipo", { length: 50 }).notNull(),
  entidadId: bigint("entidad_id", { mode: "number", unsigned: true }).notNull(),
  payload: json("payload").notNull(),
  estado: mysqlEnum("estado", ["pendiente", "procesando", "enviado", "fallido"]).notNull().default("pendiente"),
  intentos: int("intentos", { unsigned: true }).notNull().default(0),
  proximoIntentoEn: datetime("proximo_intento_en"),
  ultimoError: text("ultimo_error"),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`),
  actualizadoEn: datetime("actualizado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  uniqueIndex("uq_eventos_pendientes_uuid").on(table.eventoUuid),
  index("idx_eventos_estado_intento").on(table.estado, table.proximoIntentoEn),
  index("idx_eventos_entidad").on(table.entidadTipo, table.entidadId)
]);

// B4 Error Workflow (PLAN_API_DEFINITIVO.md / PLAN_N8N_DEFINITIVO.md):
// extendida en 016_procesos_fallidos_b4.sql más allá de su alcance
// original de outbox interno (eventoId/tipo/payload) para también recibir
// los reportes de falla de n8n (executionId/workflow/nodo/endpoint/
// codigoHttp). `estado` reemplaza al antiguo `resuelto` booleano, mismo
// patrón que `incidencias`.
export const procesosFallidos = mysqlTable("procesos_fallidos", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  eventoId: bigint("evento_id", { mode: "number", unsigned: true }),
  executionId: varchar("execution_id", { length: 100 }),
  workflow: varchar("workflow", { length: 120 }),
  nodo: varchar("nodo", { length: 120 }),
  endpoint: varchar("endpoint", { length: 160 }),
  codigoHttp: smallint("codigo_http", { unsigned: true }),
  tipo: varchar("tipo", { length: 100 }).notNull(),
  payload: json("payload").notNull(),
  mensaje: text("mensaje").notNull(),
  estado: mysqlEnum("estado", ["abierto", "en_revision", "resuelto"]).notNull().default("abierto"),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`),
  actualizadoEn: datetime("actualizado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  uniqueIndex("uq_procesos_fallidos_execution_id").on(table.executionId),
  index("idx_procesos_fallidos_estado").on(table.estado)
]);

export const listaSupresion = mysqlTable("lista_supresion", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  tipo: mysqlEnum("tipo", ["correo", "telefono", "whatsapp"]).notNull(),
  valorNormalizado: varchar("valor_normalizado", { length: 512 }).notNull(),
  motivo: varchar("motivo", { length: 255 }).notNull(),
  executionId: varchar("execution_id", { length: 100 }),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  uniqueIndex("uq_supresion_tipo_valor").on(table.tipo, table.valorNormalizado)
]);

export const envios = mysqlTable("envios", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  prospectoId: bigint("prospecto_id", { mode: "number", unsigned: true }).notNull(),
  canal: mysqlEnum("canal", ["correo", "whatsapp"]).notNull().default("correo"),
  numeroContacto: int("numero_contacto").notNull(),
  ventanaVenceEn: datetime("ventana_vence_en").notNull(),
  ventanaEstado: mysqlEnum("ventana_estado", ["abierta", "vencida", "cerrada"]).notNull().default("abierta"),
  executionId: varchar("execution_id", { length: 100 }),
  enviadoEn: datetime("enviado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  uniqueIndex("uq_envios_execution_id").on(table.executionId),
  uniqueIndex("uq_envios_prospecto_canal_numero").on(table.prospectoId, table.canal, table.numeroContacto),
  index("idx_envios_prospecto_canal").on(table.prospectoId, table.canal)
]);

export const respuestas = mysqlTable("respuestas", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  prospectoId: bigint("prospecto_id", { mode: "number", unsigned: true }).notNull(),
  envioId: bigint("envio_id", { mode: "number", unsigned: true }),
  canal: mysqlEnum("canal", ["correo", "whatsapp"]).notNull().default("correo"),
  contenido: text("contenido"),
  tardia: boolean("tardia").notNull().default(false),
  estado: mysqlEnum("estado", ["pendiente_clasificacion", "clasificada"]).notNull().default("pendiente_clasificacion"),
  clasificacion: mysqlEnum("clasificacion", ["interesado", "no_interesado", "baja", "automatica", "ambigua"]),
  comentario: varchar("comentario", { length: 500 }),
  executionId: varchar("execution_id", { length: 100 }),
  executionIdClasificacion: varchar("execution_id_clasificacion", { length: 100 }),
  recibidoEn: datetime("recibido_en").notNull().default(sql`CURRENT_TIMESTAMP`),
  clasificadoEn: datetime("clasificado_en")
}, (table) => [
  uniqueIndex("uq_respuestas_execution_id").on(table.executionId),
  uniqueIndex("uq_respuestas_execution_id_clasificacion").on(table.executionIdClasificacion),
  index("idx_respuestas_prospecto").on(table.prospectoId)
]);

export const parametrosAutomatizacion = mysqlTable("parametros_automatizacion", {
  clave: varchar("clave", { length: 80 }).primaryKey(),
  valor: json("valor").notNull(),
  descripcion: varchar("descripcion", { length: 255 }),
  actualizadoEn: datetime("actualizado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const resultadosScoring = mysqlTable("resultados_scoring", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  executionId: varchar("execution_id", { length: 100 }).notNull(),
  prospectoId: bigint("prospecto_id", { mode: "number", unsigned: true }).notNull(),
  score: decimal("score", { precision: 5, scale: 2 }).notNull(),
  prioridad: mysqlEnum("prioridad", ["alta", "media", "baja"]),
  confianza: mysqlEnum("confianza", ["alta", "media", "baja"]),
  metodo: mysqlEnum("metodo", ["gemini", "reglas"]).notNull().default("gemini"),
  detalle: json("detalle"),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  uniqueIndex("uq_resultados_scoring_execution_id").on(table.executionId),
  index("idx_resultados_scoring_prospecto").on(table.prospectoId)
]);

export const incidencias = mysqlTable("incidencias", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  executionId: varchar("execution_id", { length: 100 }),
  prospectoId: bigint("prospecto_id", { mode: "number", unsigned: true }),
  tipo: varchar("tipo", { length: 60 }).notNull(),
  severidad: mysqlEnum("severidad", ["baja", "media", "alta"]).notNull().default("media"),
  mensaje: text("mensaje").notNull(),
  detalle: json("detalle"),
  estado: mysqlEnum("estado", ["abierta", "resuelta"]).notNull().default("abierta"),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`),
  actualizadoEn: datetime("actualizado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  index("idx_incidencias_prospecto").on(table.prospectoId),
  index("idx_incidencias_estado").on(table.estado)
]);

// Expediente documental (PLAN_CRM_DEFINITIVO.md #8): cada fila es una
// versión de un documento (mismo criterio que `cotizaciones`, ver
// 014_documentos.sql para el detalle de la decisión de versionado y
// estados).
// Alta manual e importación CSV de prospectos (PLAN_CRM_DEFINITIVO.md
// módulo 3). Ver comentario completo en
// src/database/migrations/015_prospectos_importacion.sql -- este es solo
// el espejo tipado para Drizzle, la migración sigue siendo la fuente de
// verdad.
export const borradoresCaptura = mysqlTable("borradores_captura", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  loteId: varchar("lote_id", { length: 64 }).notNull(),
  fuente: varchar("fuente", { length: 255 }).notNull(),
  filaNumero: int("fila_numero", { unsigned: true }).notNull(),
  filaOriginal: json("fila_original").notNull(),

  empresaNombreLegal: varchar("empresa_nombre_legal", { length: 255 }),
  empresaGiro: varchar("empresa_giro", { length: 120 }),
  empresaTamano: mysqlEnum("empresa_tamano", ["micro", "pequena", "mediana", "grande"]),
  empresaRegion: varchar("empresa_region", { length: 120 }),
  empresaEstado: varchar("empresa_estado", { length: 120 }),
  empresaCiudad: varchar("empresa_ciudad", { length: 120 }),
  empresaPais: char("empresa_pais", { length: 2 }).notNull().default("MX"),
  empresaSitioWeb: varchar("empresa_sitio_web", { length: 2048 }),

  contactoNombre: varchar("contacto_nombre", { length: 160 }),
  contactoPuesto: varchar("contacto_puesto", { length: 160 }),

  correo: varchar("correo", { length: 254 }),
  correoNormalizado: varchar("correo_normalizado", { length: 254 }),
  telefono: varchar("telefono", { length: 40 }),
  telefonoNormalizado: varchar("telefono_normalizado", { length: 40 }),
  canalInicial: mysqlEnum("canal_inicial", ["correo", "telefono", "whatsapp"]),

  confianza: mysqlEnum("confianza", ["alta", "media", "baja"]),
  prioridad: mysqlEnum("prioridad", ["alta", "media", "baja"]),
  score: decimal("score", { precision: 5, scale: 2 }),
  fuenteUrl: varchar("fuente_url", { length: 2048 }),
  observaciones: text("observaciones"),

  estado: mysqlEnum("estado", ["pendiente_revision", "duplicado", "importado", "rechazado", "expirado"]).notNull().default("pendiente_revision"),
  matchContactoId: bigint("match_contacto_id", { mode: "number", unsigned: true }),
  matchMotivo: mysqlEnum("match_motivo", ["correo", "telefono"]),
  errores: json("errores"),

  prospectoId: bigint("prospecto_id", { mode: "number", unsigned: true }),
  campanaId: bigint("campana_id", { mode: "number", unsigned: true }),

  creadoPor: bigint("creado_por", { mode: "number", unsigned: true }).notNull(),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiraEn: datetime("expira_en").notNull(),
  procesadoEn: datetime("procesado_en"),
  procesadoPor: bigint("procesado_por", { mode: "number", unsigned: true })
}, (table) => [
  index("idx_borradores_lote").on(table.loteId),
  index("idx_borradores_estado_expira").on(table.estado, table.expiraEn)
]);

export const catalogoTipoDocumento = mysqlTable("catalogo_tipo_documento", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  clave: varchar("clave", { length: 40 }).notNull(),
  nombre: varchar("nombre", { length: 120 }).notNull(),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  uniqueIndex("uq_tipo_documento_clave").on(table.clave)
]);

export const documentos = mysqlTable("documentos", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  empresaId: bigint("empresa_id", { mode: "number", unsigned: true }).notNull(),
  tipoDocumentoId: bigint("tipo_documento_id", { mode: "number", unsigned: true }),
  oportunidadId: bigint("oportunidad_id", { mode: "number", unsigned: true }),
  contactoId: bigint("contacto_id", { mode: "number", unsigned: true }),
  documentoRaizId: bigint("documento_raiz_id", { mode: "number", unsigned: true }),
  version: int("version").notNull().default(1),
  nombreOriginal: varchar("nombre_original", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 120 }).notNull(),
  tamanoBytes: bigint("tamano_bytes", { mode: "number", unsigned: true }).notNull(),
  storageDriver: varchar("storage_driver", { length: 20 }).notNull(),
  storageKey: varchar("storage_key", { length: 1024 }).notNull(),
  estado: mysqlEnum("estado", ["vigente", "obsoleto", "archivado"]).notNull().default("vigente"),
  politicaRetencion: varchar("politica_retencion", { length: 60 }),
  subidoPor: bigint("subido_por", { mode: "number", unsigned: true }).notNull(),
  revisadoPor: bigint("revisado_por", { mode: "number", unsigned: true }),
  revisadoEn: datetime("revisado_en"),
  alertadoEn: datetime("alertado_en"),
  activo: boolean("activo").notNull().default(true),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`),
  actualizadoEn: datetime("actualizado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  index("idx_documentos_empresa").on(table.empresaId),
  index("idx_documentos_oportunidad").on(table.oportunidadId),
  index("idx_documentos_contacto").on(table.contactoId),
  index("idx_documentos_raiz").on(table.documentoRaizId),
  index("idx_documentos_alertado").on(table.estado, table.alertadoEn)
]);

export const auditoria = mysqlTable("auditoria", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  usuarioId: bigint("usuario_id", { mode: "number", unsigned: true }),
  entidad: varchar("entidad", { length: 80 }).notNull(),
  entidadId: bigint("entidad_id", { mode: "number", unsigned: true }).notNull(),
  accion: varchar("accion", { length: 80 }).notNull(),
  antes: json("antes"),
  despues: json("despues"),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  index("idx_auditoria_entidad").on(table.entidad, table.entidadId)
]);

// Job diario de métricas comerciales (017_metricas_comerciales_diarias.sql):
// ver el comentario ahí sobre por qué estas columnas y por qué `fecha` es
// la propia llave primaria (a lo más una fila por día, upsert sobre ella).
export const metricasComercialesDiarias = mysqlTable("metricas_comerciales_diarias", {
  fecha: date("fecha", { mode: "string" }).primaryKey(),
  oportunidadesAbiertas: int("oportunidades_abiertas", { unsigned: true }).notNull(),
  valorPipeline: decimal("valor_pipeline", { precision: 12, scale: 2 }).notNull(),
  oportunidadesGanadas: int("oportunidades_ganadas", { unsigned: true }).notNull(),
  ingresosCerrados: decimal("ingresos_cerrados", { precision: 12, scale: 2 }).notNull(),
  oportunidadesPerdidas: int("oportunidades_perdidas", { unsigned: true }).notNull(),
  valorPerdido: decimal("valor_perdido", { precision: 12, scale: 2 }).notNull(),
  calculadoEn: datetime("calculado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
});
