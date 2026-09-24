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
