import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, like, ne, or, sql, type SQL } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { catalogoEtapaEmbudo, contactos, cotizaciones, empresas, mediosContacto, oportunidades, prospectos, tareas } from "../database/schema.js";
import { compactConditions, patronEmpiezaCon, patronLike } from "../shared/drizzle-utils.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import { GRUPOS_BUSCADOR, type BuscarQuery, type GrupoBuscador } from "./dto/buscar.schema.js";

const POR_GRUPO = 5;

// Una fila del buscador, igual para los 6 grupos: el front pinta título y
// detalle y arma la liga con id / empresa_id.
export type FilaBuscador = { id: number; titulo: string; detalle: string | null; empresa_id: number | null };
type Grupo = { data: FilaBuscador[]; hay_mas: boolean };

const nombreEmpresa = sql<string>`COALESCE(${empresas.nombreComercial}, ${empresas.nombreLegal})`;
const juntar = (...partes: (string | null | undefined)[]) => partes.filter(Boolean).join(" · ") || null;

// Buscador general (etapa 5, 21-oct-2026). Cada grupo copia las reglas de su
// lista (P5.3): un agente ve empresas, contactos y prospectos de empresas
// suyas; oportunidades y cotizaciones donde él es el responsable; y solo las
// tareas que tiene asignadas. Lo que empieza con el texto sale primero.
@Injectable()
export class BuscadorService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async buscar(user: CurrentUser, query: BuscarQuery) {
    const grupos = query.grupo ? [query.grupo] : GRUPOS_BUSCADOR;
    const desde = query.grupo ? query.desde : 0;
    const resultados = await Promise.all(grupos.map((g) => this.grupo(g, user, query.q, desde)));
    return Object.fromEntries(grupos.map((g, i) => [g, resultados[i]!])) as Partial<Record<GrupoBuscador, Grupo>>;
  }

  private async grupo(grupo: GrupoBuscador, user: CurrentUser, q: string, desde: number): Promise<Grupo> {
    // Se pide una de más para saber si hay "Ver más".
    const filas = await this[grupo](user, q, desde, POR_GRUPO + 1);
    return { data: filas.slice(0, POR_GRUPO), hay_mas: filas.length > POR_GRUPO };
  }

  // Lista de Empresas (EmpresasService.list), pero sin giro ni ciudad (P5.2).
  private async empresas(user: CurrentUser, q: string, desde: number, limite: number): Promise<FilaBuscador[]> {
    const patron = patronLike(q);
    const inicio = patronEmpiezaCon(q);
    const rows = await this.db
      .select({ id: empresas.id, nombreLegal: empresas.nombreLegal, nombreComercial: empresas.nombreComercial, ciudad: empresas.ciudad })
      .from(empresas)
      .where(and(...compactConditions([
        eq(empresas.activo, true),
        user.rol === "agente" ? eq(empresas.propietarioId, user.id) : undefined,
        or(like(empresas.nombreLegal, patron), like(empresas.nombreComercial, patron))
      ])))
      .orderBy(primeroSi(or(like(empresas.nombreLegal, inicio), like(empresas.nombreComercial, inicio))), asc(empresas.nombreLegal), asc(empresas.id))
      .limit(limite)
      .offset(desde);
    return rows.map((r) => ({
      id: r.id,
      titulo: r.nombreComercial ?? r.nombreLegal,
      detalle: juntar(r.nombreComercial && r.nombreComercial !== r.nombreLegal ? r.nombreLegal : null, r.ciudad),
      empresa_id: r.id
    }));
  }

  // Lista de Contactos (ContactosService.alcanceLista): activos, de
  // empresas activas; por nombre, correo o teléfono.
  private async contactos(user: CurrentUser, q: string, desde: number, limite: number): Promise<FilaBuscador[]> {
    const rows = await this.db
      .select({ id: contactos.id, nombre: contactos.nombre, puesto: contactos.puesto, empresaId: contactos.empresaId, empresa: nombreEmpresa })
      .from(contactos)
      .innerJoin(empresas, eq(empresas.id, contactos.empresaId))
      .where(and(...compactConditions([
        eq(contactos.activo, true),
        eq(empresas.activo, true),
        user.rol === "agente" ? eq(empresas.propietarioId, user.id) : undefined,
        or(like(contactos.nombre, patronLike(q)), tieneMedioQueDiga(q))
      ])))
      .orderBy(primeroSi(like(contactos.nombre, patronEmpiezaCon(q))), asc(contactos.nombre), asc(contactos.id))
      .limit(limite)
      .offset(desde);
    return rows.map((r) => ({ id: r.id, titulo: r.nombre, detalle: juntar(r.puesto, r.empresa), empresa_id: r.empresaId }));
  }

  // Lista de Prospectos (ProspectosService.listProspectos): el agente, los
  // de empresas suyas. Por persona, empresa, correo o teléfono.
  private async prospectos(user: CurrentUser, q: string, desde: number, limite: number): Promise<FilaBuscador[]> {
    const patron = patronLike(q);
    const rows = await this.db
      .select({ id: prospectos.id, nombre: contactos.nombre, empresaId: empresas.id, empresa: nombreEmpresa })
      .from(prospectos)
      .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
      .innerJoin(empresas, eq(empresas.id, contactos.empresaId))
      .where(and(...compactConditions([
        user.rol === "agente" ? eq(empresas.propietarioId, user.id) : undefined,
        or(like(contactos.nombre, patron), like(empresas.nombreLegal, patron), like(empresas.nombreComercial, patron), tieneMedioQueDiga(q))
      ])))
      .orderBy(primeroSi(like(contactos.nombre, patronEmpiezaCon(q))), desc(prospectos.creadoEn), desc(prospectos.id))
      .limit(limite)
      .offset(desde);
    return rows.map((r) => ({ id: r.id, titulo: r.nombre, detalle: r.empresa, empresa_id: r.empresaId }));
  }

  // Lista de Oportunidades (OportunidadesService.scopedResponsable): el
  // agente, las suyas. Abiertas primero.
  private async oportunidades(user: CurrentUser, q: string, desde: number, limite: number): Promise<FilaBuscador[]> {
    const patron = patronLike(q);
    const rows = await this.db
      .select({ id: oportunidades.id, titulo: oportunidades.titulo, empresaId: oportunidades.empresaId, empresa: nombreEmpresa, etapa: catalogoEtapaEmbudo.nombre })
      .from(oportunidades)
      .innerJoin(empresas, eq(empresas.id, oportunidades.empresaId))
      .innerJoin(catalogoEtapaEmbudo, eq(catalogoEtapaEmbudo.id, oportunidades.etapaId))
      .where(and(...compactConditions([
        user.rol === "agente" ? eq(oportunidades.responsableId, user.id) : undefined,
        or(like(oportunidades.titulo, patron), like(empresas.nombreLegal, patron), like(empresas.nombreComercial, patron))
      ])))
      .orderBy(primeroSi(like(oportunidades.titulo, patronEmpiezaCon(q))), asc(oportunidades.cerrada), desc(oportunidades.actualizadoEn), desc(oportunidades.id))
      .limit(limite)
      .offset(desde);
    return rows.map((r) => ({ id: r.id, titulo: r.titulo, detalle: juntar(r.empresa, r.etapa), empresa_id: r.empresaId }));
  }

  // Lista de Cotizaciones (CotizacionesService.condicionResponsable y
  // condicionBusqueda): sin obsoletas; empresa, oportunidad o folio ("#12").
  private async cotizaciones(user: CurrentUser, q: string, desde: number, limite: number): Promise<FilaBuscador[]> {
    const patron = patronLike(q);
    const folio = /^#?\d+$/.test(q) ? Number(q.replace("#", "")) : undefined;
    const rows = await this.db
      .select({ id: cotizaciones.id, empresaId: cotizaciones.empresaId, empresa: nombreEmpresa, oportunidad: oportunidades.titulo })
      .from(cotizaciones)
      .innerJoin(oportunidades, eq(oportunidades.id, cotizaciones.oportunidadId))
      .innerJoin(empresas, eq(empresas.id, cotizaciones.empresaId))
      .where(and(...compactConditions([
        ne(cotizaciones.estado, "obsoleta"),
        user.rol === "agente" ? eq(oportunidades.responsableId, user.id) : undefined,
        or(...compactConditions([like(empresas.nombreLegal, patron), like(empresas.nombreComercial, patron), like(oportunidades.titulo, patron), folio ? eq(cotizaciones.id, folio) : undefined]))
      ])))
      .orderBy(...compactConditions([folio ? primeroSi(eq(cotizaciones.id, folio)) : undefined, desc(cotizaciones.actualizadoEn), desc(cotizaciones.id)]))
      .limit(limite)
      .offset(desde);
    return rows.map((r) => ({ id: r.id, titulo: `Cotización #${r.id}`, detalle: juntar(r.empresa, r.oportunidad), empresa_id: r.empresaId }));
  }

  // Bandeja de Tareas (TareasService.scopedFilters): el agente, las que
  // tiene asignadas. Solo abiertas (P5.3); la más urgente primero.
  private async tareas(user: CurrentUser, q: string, desde: number, limite: number): Promise<FilaBuscador[]> {
    const patron = patronLike(q);
    const rows = await this.db
      .select({ id: tareas.id, titulo: tareas.titulo, empresaId: tareas.empresaId, empresa: nombreEmpresa })
      .from(tareas)
      .leftJoin(empresas, eq(empresas.id, tareas.empresaId))
      .where(and(...compactConditions([
        inArray(tareas.estado, ["pendiente", "en_progreso"]),
        user.rol === "agente" ? eq(tareas.responsableId, user.id) : undefined,
        or(like(tareas.titulo, patron), like(empresas.nombreLegal, patron), like(empresas.nombreComercial, patron))
      ])))
      .orderBy(primeroSi(like(tareas.titulo, patronEmpiezaCon(q))), sql`${tareas.fechaLimite} IS NULL`, asc(tareas.fechaLimite), asc(tareas.id))
      .limit(limite)
      .offset(desde);
    return rows.map((r) => ({ id: r.id, titulo: r.titulo, detalle: r.empresa, empresa_id: r.empresaId }));
  }
}

// Ordena primero las filas que cumplen la condición.
function primeroSi(condicion: SQL | undefined) {
  return sql`CASE WHEN ${condicion} THEN 0 ELSE 1 END`;
}

// Mismo criterio que la lista de Contactos: el texto en el correo o el
// teléfono, tal cual o normalizado.
function tieneMedioQueDiga(q: string) {
  const patron = patronLike(q);
  return sql`EXISTS (SELECT 1 FROM ${mediosContacto} WHERE ${mediosContacto.contactoId} = ${contactos.id} AND (${mediosContacto.valor} LIKE ${patron} OR ${mediosContacto.valorNormalizado} LIKE ${patron}))`;
}
