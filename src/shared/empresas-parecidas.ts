import { and, eq } from "drizzle-orm";
import type { DrizzleDb, DrizzleTx } from "../database/drizzle.constants.js";
import { empresas } from "../database/schema.js";
import type { CurrentUser } from "../auth/current-user.type.js";

// Empresas parecidas (control G-01, 28-oct-2026): la base no deduplica empresas
// por nombre, así que al importar o dar de alta se AVISA cuando ya hay una con
// el mismo nombre. Solo avisa: decidir si es la misma sigue siendo de una
// persona (PLAN_CRM_DEFINITIVO.md: "la razón social nunca fusiona
// automáticamente").

// Forma jurídica al final del nombre, ya sin puntuación: "s a de c v",
// "sa de cv", "sapi de cv", "s de rl de cv", "sc", "sas", "ac"…
const FORMA_JURIDICA = /\s+(s ?a ?p ?i|s ?a ?b|s ?de ?r ?l|s ?en ?c|s ?a ?s|s ?c|s ?a|a ?c)( de c ?v)?$|\s+de c ?v$/;

// "Moldes del Bajío, S.A. de C.V." y "moldes del bajio" → "moldes del bajio".
export function normalizarNombreEmpresa(nombre: string): string {
  const base = nombre
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  // El espacio de adelante deja que "s a de c v" a secas también se quite
  // entero (y caiga en el nombre completo), no solo la parte de "de c v".
  let actual = base;
  let previo;
  do {
    previo = actual;
    actual = ` ${actual}`.replace(FORMA_JURIDICA, "").trim();
  } while (actual !== previo);
  // Un nombre que era solo la forma jurídica se compara completo.
  return actual || base;
}

export type EmpresaParecida = {
  id: number;
  nombre_legal: string;
  nombre_comercial: string | null;
  giro: string | null;
  tamano: "micro" | "pequena" | "mediana" | "grande" | null;
  region: string | null;
  estado: string | null;
  ciudad: string | null;
  activo: boolean;
  creado_en: Date;
};

// Índice nombre normalizado → empresas, con las empresas activas que el usuario
// puede ver (un agente, solo las suyas: no se le revela que existe la de otro).
// Se arma una vez por petición; por nombre legal y por nombre comercial.
export async function indiceDeEmpresas(db: DrizzleDb | DrizzleTx, user: CurrentUser) {
  const filas = await db
    .select({
      id: empresas.id,
      nombre_legal: empresas.nombreLegal,
      nombre_comercial: empresas.nombreComercial,
      giro: empresas.giro,
      tamano: empresas.tamano,
      region: empresas.region,
      estado: empresas.estado,
      ciudad: empresas.ciudad,
      activo: empresas.activo,
      creado_en: empresas.creadoEn
    })
    .from(empresas)
    .where(and(eq(empresas.activo, true), user.rol === "agente" ? eq(empresas.propietarioId, user.id) : undefined));
  const indice = new Map<string, EmpresaParecida[]>();
  for (const empresa of filas) agregarAlIndice(indice, empresa);
  return indice;
}

// También para sumar las empresas que se van creando mientras se usa el índice
// (ProspectosService.confirmarTodos).
export function agregarAlIndice(indice: Map<string, EmpresaParecida[]>, empresa: EmpresaParecida) {
  const claves = new Set([empresa.nombre_legal, empresa.nombre_comercial].filter((n): n is string => Boolean(n)).map(normalizarNombreEmpresa));
  for (const clave of claves) {
    const lista = indice.get(clave) ?? [];
    lista.push(empresa);
    indice.set(clave, lista);
  }
}

export function parecidasEn(indice: Map<string, EmpresaParecida[]>, nombre: string, excluirId?: number, maximo = 5): EmpresaParecida[] {
  const clave = normalizarNombreEmpresa(nombre);
  if (clave.length < 2) return [];
  return (indice.get(clave) ?? []).filter((e) => e.id !== excluirId).slice(0, maximo);
}
