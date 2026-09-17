import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../database/drizzle.constants.js";

// Catálogos derivados en vivo de los ENUM ya declarados en las migraciones
// (INFORMATION_SCHEMA), para que nunca se desincronicen de una lista
// hardcodeada por separado. Compartido entre AutomatizacionService
// (GET /automatizacion/catalogos, X-API-Key) y CatalogosService
// (GET /catalogos, sesión CRM) -- mismo contenido, dos audiencias distintas.
export const ENUM_CATALOGOS: Record<string, { tabla: string; columna: string }> = {
  tamano_empresa: { tabla: "empresas", columna: "tamano" },
  tipo_medio_contacto: { tabla: "medios_contacto", columna: "tipo" },
  estado_medio_contacto: { tabla: "medios_contacto", columna: "estado_contacto" },
  prioridad_prospecto: { tabla: "prospectos", columna: "prioridad" },
  confianza_scoring: { tabla: "resultados_scoring", columna: "confianza" },
  metodo_scoring: { tabla: "resultados_scoring", columna: "metodo" },
  canal_campana: { tabla: "campanas", columna: "canal" },
  estado_campana: { tabla: "campanas", columna: "estado" },
  tarea_tipo: { tabla: "tareas", columna: "tipo" },
  tarea_prioridad: { tabla: "tareas", columna: "prioridad" },
  clasificacion_respuesta: { tabla: "respuestas", columna: "clasificacion" }
};

function parseEnumValues(columnType: string): string[] {
  const match = /^enum\((.*)\)$/i.exec(columnType.trim());
  if (!match) return [];
  return match[1]!.split(",").map((value) => value.trim().replace(/^'|'$/g, "").replace(/''/g, "'"));
}

export async function obtenerCatalogosEnum(db: DrizzleDb): Promise<Record<string, string[]>> {
  const entries = Object.entries(ENUM_CATALOGOS);
  const conditions = entries.map(([, { tabla, columna }]) => sql`(TABLE_NAME = ${tabla} AND COLUMN_NAME = ${columna})`);
  const [rows] = (await db.execute<{ tabla: string; columna: string; tipo: string }[]>(sql`
    SELECT TABLE_NAME AS tabla, COLUMN_NAME AS columna, COLUMN_TYPE AS tipo
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND (${sql.join(conditions, sql` OR `)})
  `)) as unknown as [{ tabla: string; columna: string; tipo: string }[], unknown];

  return Object.fromEntries(
    entries.map(([nombre, { tabla, columna }]) => {
      const row = rows.find((candidate) => candidate.tabla === tabla && candidate.columna === columna);
      return [nombre, row ? parseEnumValues(row.tipo) : []];
    })
  );
}
