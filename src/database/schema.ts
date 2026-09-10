import { sql } from "drizzle-orm";
import { bigint, boolean, char, date, datetime, int, json, mysqlEnum, mysqlTable, uniqueIndex, varchar, decimal, index, text } from "drizzle-orm/mysql-core";

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
  index("idx_tareas_tipo_estado").on(table.tipo, table.estado)
]);

export const eventosPendientes = mysqlTable("eventos_pendientes", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
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
  index("idx_eventos_estado_intento").on(table.estado, table.proximoIntentoEn),
  index("idx_eventos_entidad").on(table.entidadTipo, table.entidadId)
]);

export const procesosFallidos = mysqlTable("procesos_fallidos", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  eventoId: bigint("evento_id", { mode: "number", unsigned: true }),
  tipo: varchar("tipo", { length: 100 }).notNull(),
  payload: json("payload").notNull(),
  error: text("error").notNull(),
  resuelto: boolean("resuelto").notNull().default(false),
  creadoEn: datetime("creado_en").notNull().default(sql`CURRENT_TIMESTAMP`)
}, (table) => [
  index("idx_procesos_fallidos_resuelto").on(table.resuelto)
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
