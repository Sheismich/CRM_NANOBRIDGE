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
  region: string | null;
  estado: string | null;
  ciudad: string | null;
  activo: boolean;
  creado_en: string;
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
  tipo: "llamada" | "whatsapp" | "comentario" | "correo_enviado" | "correo_recibido" | "tarea" | "cambio_estado_prospecto";
  fecha: string;
  responsable_id: number | null;
  canal: string | null;
  resultado: string | null;
  proxima_accion: string | null;
  detalle: Record<string, unknown>;
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
  partidas: { id: number; descripcion: string; cantidad: string; precio_unitario: string; importe: string; orden: number }[];
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
};

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

// GET /prospectos/:id (ProspectosService.getProspecto).
export type ProspectoDetalle = {
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
};

export type PipelineResumen = {
  abiertas: { cantidad: number; valor_pipeline: string };
  ganadas: { cantidad: number; ingresos_cerrados: string };
  perdidas: { cantidad: number; valor_perdido: string };
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
    tasa_respuesta_pct: number | null;
  }[];
};

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
