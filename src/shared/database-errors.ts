// Compartido entre automatizacion.service.ts y tareas.service.ts: ambos
// necesitan distinguir una violación de UNIQUE (retry idempotente) de
// cualquier otro error de base de datos.
//
// Drizzle envuelve el error real del driver (mysql2) en un
// DrizzleQueryError y lo deja en `.cause`, no en el error mismo — chequear
// solo `error.code` (como se hacía en Express/Next.js, donde el driver se
// llamaba directo) no detecta el duplicado aquí y el catch cae al 500
// genérico en vez de responder 200 + ya_existia.
export function isDuplicateEntry(error: unknown): boolean {
  return hasDuplicateCode(error) || hasDuplicateCode((error as { cause?: unknown } | null)?.cause);
}

function hasDuplicateCode(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as { code?: string }).code === "ER_DUP_ENTRY";
}
