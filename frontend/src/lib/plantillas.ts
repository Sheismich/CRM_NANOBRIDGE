// Correos de prospección (GET /api/v1/plantillas, etapa 1 de las mejoras,
// 19-oct-2026). Solo administrador y supervisor.

export interface PlantillaCorreo {
  id: number;
  giro: string;
  numero: 1 | 2 | 3;
  nombre: string;
  asunto: string;
  cuerpo: string;
  actualizado_por: { id: number; nombre: string } | null;
  actualizado_en: string;
}

export interface PlantillasRespuesta {
  plantillas: PlantillaCorreo[];
  pie: { texto: string; actualizado_en: string | null };
  variables: { clave: string; descripcion: string }[];
}

export interface CorreoArmado {
  asunto: string;
  texto: string;
  html: string;
}

// Cuándo sale cada uno, para que quien edita sepa qué está cambiando.
export const CUANDO_SALE: Record<number, string> = {
  1: "El primer correo que recibe el prospecto",
  2: "Si no contesta en 5 días hábiles",
  3: "El último, 5 días hábiles después del recordatorio 1"
};
