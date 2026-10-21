import { z } from "zod";

// Buscador general (etapa 5, 21-oct-2026). Desde 1 letra (decisión de
// Fabián). Sin `grupo`: los 6 grupos, 5 cada uno. Con `grupo`: solo ese,
// 5 a partir de `desde` ("Ver más" en la misma ventana).
export const GRUPOS_BUSCADOR = ["empresas", "contactos", "prospectos", "oportunidades", "cotizaciones", "tareas"] as const;
export type GrupoBuscador = (typeof GRUPOS_BUSCADOR)[number];

export const buscarQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  grupo: z.enum(GRUPOS_BUSCADOR).optional(),
  desde: z.coerce.number().int().min(0).max(1000).default(0)
});
export type BuscarQuery = z.infer<typeof buscarQuerySchema>;
