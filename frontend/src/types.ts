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

export type Tarea = {
  id: number;
  tipo: "seguimiento" | "clasificacion" | "revision_documento" | "otro";
  titulo: string;
  descripcion: string | null;
  estado: "pendiente" | "en_progreso" | "cerrada" | "cancelada";
  prioridad: "baja" | "media" | "alta" | "urgente";
  responsable_id: number | null;
  empresa_id: number | null;
  fecha_limite: string | null;
  creado_en: string;
};
