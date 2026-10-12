import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { auditoria, campanas, catalogoEtapaEmbudo, catalogoTipoDocumento, contactos, cotizaciones, documentos, empresas, mediosContacto, oportunidades, prospectos, usuarios } from "../database/schema.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import { compactConditions, patronLike } from "../shared/drizzle-utils.js";
import { diaSiguiente, fechaMx, horaMx, inicioDelDiaMxSql, sumarDiasFecha } from "../shared/dia-habil.js";
import { toCsv } from "../shared/csv.js";
import { COLOR, FUENTE, MARGEN, anchoUtil, asegurarEspacio, crearDocumentoCarta, tabla, terminar } from "../shared/pdf/molde.js";
import { fechaCorta, fechaHoraMx, numero } from "../shared/pdf/formato.js";
import { condicionRegistro, tipoDeFila, type TipoRegistro } from "./registro-cambios.catalogo.js";
import { cambiosDe, frase, nombreDelRegistro, type FilaAuditoria, type Nombres } from "./registro-cambios.textos.js";
import type { RegistroCambiosExportQuery, RegistroCambiosQuery } from "./dto/admin.schema.js";

// Registro de cambios de Administración (12-oct-2026; punto 53): quién movió
// qué, solo el administrador. Qué entra y en qué filtro: registro-cambios.
// catalogo.ts; las frases y el antes → después con nombres:
// registro-cambios.textos.ts. La pantalla, el PDF y el CSV salen de aquí.

// La exportación (Fabián, 12-oct): sin fechas son los últimos 30 días, y el
// PDF lleva a lo más 2,000 renglones (más serían cientos de hojas); el CSV
// va completo.
const DIAS_POR_OMISION = 30;
export const TOPE_PDF = 2_000;
// Un renglón de la tabla del PDF no se parte entre hojas (ver molde.ts).
const MAXIMO_TEXTO_PDF = 600;

const ETIQUETAS_TIPO: Record<TipoRegistro | "todo", string> = {
  todo: "Todo",
  usuarios_roles: "Usuarios y roles",
  ediciones: "Ediciones",
  borrados: "Borrados",
  descargas: "Descargas",
  configuracion: "Configuración"
};

type Filtros = Omit<RegistroCambiosQuery, "page" | "limit">;
type FilaDb = typeof auditoria.$inferSelect;

export interface FilaRegistro {
  id: number;
  fecha: Date;
  usuario: { id: number; nombre: string };
  tipo: TipoRegistro | null;
  accion: string;
  registro: { entidad: string; id: number; nombre: string | null };
  texto: string;
  cambios: ReturnType<typeof cambiosDe>;
  antes: unknown;
}

function recortar(texto: string) {
  return texto.length > MAXIMO_TEXTO_PDF ? `${texto.slice(0, MAXIMO_TEXTO_PDF - 1)}…` : texto;
}

@Injectable()
export class RegistroCambiosService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async listar(query: RegistroCambiosQuery) {
    const where = await this.condiciones(query);
    const [[total], filas] = await Promise.all([
      this.db.select({ n: sql<number>`COUNT(*)` }).from(auditoria).where(where),
      this.db.select().from(auditoria).where(where).orderBy(desc(auditoria.creadoEn), desc(auditoria.id)).limit(query.limit).offset((query.page - 1) * query.limit)
    ]);
    return { page: query.page, limit: query.limit, total: Number(total?.n ?? 0), data: await this.describir(filas) };
  }

  /** Exportación en PDF o CSV con los mismos filtros. `tope` solo se cambia en pruebas. */
  async exportar(query: RegistroCambiosExportQuery, user: CurrentUser, opciones: { tope?: number } = {}) {
    const tope = opciones.tope ?? TOPE_PDF;
    const hoy = fechaMx(new Date());
    const hasta = query.hasta ?? hoy;
    const desde = query.desde ?? sumarDiasFecha(hasta, -(DIAS_POR_OMISION - 1));
    const filtros: Filtros = { ...query, tipo: query.tipo ?? "todo", desde, hasta };
    const where = await this.condiciones(filtros);
    const orden = [desc(auditoria.creadoEn), desc(auditoria.id)] as const;

    const [[total], filasDb] = await Promise.all([
      this.db.select({ n: sql<number>`COUNT(*)` }).from(auditoria).where(where),
      query.formato === "pdf"
        ? this.db.select().from(auditoria).where(where).orderBy(...orden).limit(tope)
        : this.db.select().from(auditoria).where(where).orderBy(...orden)
    ]);
    const filas = await this.describir(filasDb);
    const nombreBase = `registro-de-cambios-${desde}-a-${hasta}`;

    let resultado: { nombreArchivo: string; contenido: string | Buffer };
    if (query.formato === "csv") {
      resultado = {
        nombreArchivo: `${nombreBase}.csv`,
        contenido: toCsv(filas.map((f) => ({
          fecha: `${fechaMx(f.fecha)} ${horaMx(f.fecha)}`,
          quien: f.usuario.nombre,
          accion: f.texto,
          registro: f.registro.nombre ?? `${f.registro.entidad} #${f.registro.id}`,
          antes: f.cambios.map((c) => `${c.etiqueta}: ${c.antes}`).join("; "),
          despues: f.cambios.map((c) => `${c.etiqueta}: ${c.despues}`).join("; ")
        })), ["fecha", "quien", "accion", "registro", "antes", "despues"])
      };
    } else {
      resultado = { nombreArchivo: `${nombreBase}.pdf`, contenido: await this.pdf(filas, Number(total?.n ?? 0), filtros, user) };
    }

    // La exportación misma queda en el registro (Descargas).
    await this.db.insert(auditoria).values({
      usuarioId: user.id,
      entidad: "registro_cambios",
      entidadId: 0,
      accion: "exportar",
      despues: { formato: query.formato, filtros: { ...filtros }, renglones: filas.length }
    });
    return resultado;
  }

  private async pdf(filas: FilaRegistro[], total: number, filtros: Filtros, user: CurrentUser) {
    const periodo = `Del ${fechaCorta(filtros.desde!)} al ${fechaCorta(filtros.hasta!)}`;
    const doc = crearDocumentoCarta({
      titulo: "Registro de cambios",
      lineas: [`${periodo} · ${ETIQUETAS_TIPO[filtros.tipo ?? "todo"]}${filtros.q ? ` · "${filtros.q}"` : ""}`, `Generado el ${fechaHoraMx(new Date())} por ${user.nombre}`]
    });
    doc.y += 15;
    tabla(doc, {
      columnas: [
        { titulo: "Fecha", ancho: 1.3 },
        { titulo: "Quién", ancho: 1.6 },
        { titulo: "Qué pasó", ancho: 5 }
      ],
      filas: filas.map((f) => [
        { texto: fechaCorta(fechaMx(f.fecha)), secundario: horaMx(f.fecha) },
        f.usuario.nombre,
        { texto: recortar(f.texto), secundario: f.cambios.length > 0 ? recortar(f.cambios.map((c) => `${c.etiqueta}: ${c.antes} → ${c.despues}`).join(" · ")) : null }
      ]),
      vacio: "No hay cambios con estos filtros."
    });
    if (total > filas.length) {
      asegurarEspacio(doc, 30);
      doc.font(FUENTE.normal).fontSize(8.5).fillColor(COLOR.gris)
        .text(`Se muestran ${numero(filas.length)} de ${numero(total)} cambios; para verlos todos use el CSV.`, MARGEN.lados, doc.y + 10, { width: anchoUtil(doc) });
    }
    return terminar(doc);
  }

  private async condiciones(filtros: Filtros): Promise<SQL> {
    const partes = compactConditions<SQL | undefined>([
      condicionRegistro(filtros.tipo ?? "todo"),
      filtros.usuarioId ? eq(auditoria.usuarioId, filtros.usuarioId) : undefined,
      filtros.entidad ? eq(auditoria.entidad, filtros.entidad) : undefined,
      filtros.entidadId ? eq(auditoria.entidadId, filtros.entidadId) : undefined,
      filtros.desde ? sql`${auditoria.creadoEn} >= ${inicioDelDiaMxSql(filtros.desde)}` : undefined,
      filtros.hasta ? sql`${auditoria.creadoEn} < ${inicioDelDiaMxSql(diaSiguiente(filtros.hasta))}` : undefined,
      filtros.q ? await this.condicionBusqueda(filtros.q) : undefined
    ]);
    return and(...partes)!;
  }

  // "Buscar usuario o registro": primero los ids cuyo nombre coincide (quien
  // lo hizo, o el registro afectado), luego se filtra por esos ids. Más
  // simple y rápido que buscar dentro del JSON de antes/después.
  private async condicionBusqueda(q: string): Promise<SQL> {
    const patron = patronLike(q);
    const ids = async (consulta: Promise<{ id: number }[]>) => (await consulta).map((f) => f.id);
    const LIMITE = 500;
    const [deUsuarios, deEmpresas, deContactos, deOportunidades, deCampanas, deDocumentos] = await Promise.all([
      ids(this.db.select({ id: usuarios.id }).from(usuarios).where(like(usuarios.nombre, patron)).limit(LIMITE)),
      ids(this.db.select({ id: empresas.id }).from(empresas).where(or(like(empresas.nombreLegal, patron), like(empresas.nombreComercial, patron))).limit(LIMITE)),
      ids(this.db.select({ id: contactos.id }).from(contactos).where(like(contactos.nombre, patron)).limit(LIMITE)),
      ids(this.db.select({ id: oportunidades.id }).from(oportunidades).where(like(oportunidades.titulo, patron)).limit(LIMITE)),
      ids(this.db.select({ id: campanas.id }).from(campanas).where(like(campanas.nombre, patron)).limit(LIMITE)),
      ids(this.db.select({ id: documentos.id }).from(documentos).where(like(documentos.nombreOriginal, patron)).limit(LIMITE))
    ]);
    const deEntidad = (entidad: string, lista: number[]) => (lista.length > 0 ? and(eq(auditoria.entidad, entidad), inArray(auditoria.entidadId, lista)) : undefined);
    const opciones = compactConditions<SQL | undefined>([
      deUsuarios.length > 0 ? inArray(auditoria.usuarioId, deUsuarios) : undefined,
      deEntidad("usuario", deUsuarios),
      deEntidad("empresa", deEmpresas),
      deEntidad("contacto", deContactos),
      deEntidad("oportunidad", deOportunidades),
      deEntidad("campana", deCampanas),
      deEntidad("documento", deDocumentos)
    ]);
    return opciones.length > 0 ? or(...opciones)! : sql`FALSE`;
  }

  /** De filas crudas a lo que muestra la pantalla: frase, cambios y nombres. */
  async describir(filas: FilaDb[]): Promise<FilaRegistro[]> {
    const nombres = await this.nombres(filas);
    return filas.map((fila) => {
      const tipo = tipoDeFila(fila.entidad, fila.accion, fila.despues);
      const quien = nombres.usuarios.get(fila.usuarioId!) ?? `Usuario #${fila.usuarioId}`;
      const base: FilaAuditoria = fila;
      return {
        id: fila.id,
        fecha: fila.creadoEn,
        usuario: { id: fila.usuarioId!, nombre: quien },
        tipo,
        accion: fila.accion,
        registro: { entidad: fila.entidad, id: fila.entidadId, nombre: nombreDelRegistro(base, nombres) },
        texto: frase(base, quien, nombres),
        cambios: cambiosDe(base, nombres),
        // Lo que había antes, para "ver cómo estaba" en los borrados.
        antes: tipo === "borrados" ? fila.antes : null
      };
    });
  }

  // Una consulta por tabla con los ids que aparecen en la página (nunca una
  // por fila). En dos vueltas: primero lo que apunta a una empresa o a un
  // contacto, luego esas empresas y contactos.
  private async nombres(filas: FilaDb[]): Promise<Nombres> {
    const de = (entidad: string) => [...new Set(filas.filter((f) => f.entidad === entidad).map((f) => f.entidadId))];
    const idsUsuarios = new Set<number>();
    for (const f of filas) {
      if (f.usuarioId != null) idsUsuarios.add(f.usuarioId);
      if (f.entidad === "usuario") idsUsuarios.add(f.entidadId);
      for (const lado of [f.antes, f.despues]) {
        const o = lado && typeof lado === "object" ? (lado as Record<string, unknown>) : {};
        for (const campo of ["propietario_id", "responsable_id"]) if (o[campo] != null) idsUsuarios.add(Number(o[campo]));
      }
    }
    const si = <T>(lista: number[], consulta: () => Promise<T[]>) => (lista.length > 0 ? consulta() : Promise.resolve([] as T[]));

    const [filasProspectos, filasMedios, filasDocumentos, filasCotizaciones, filasOportunidades, filasCampanas, filasTipos, filasEtapas, filasUsuarios] = await Promise.all([
      si(de("prospecto"), () => this.db.select({ id: prospectos.id, contactoId: prospectos.contactoId }).from(prospectos).where(inArray(prospectos.id, de("prospecto")))),
      si(de("medio_contacto"), () => this.db.select({ id: mediosContacto.id, valor: mediosContacto.valor, contactoId: mediosContacto.contactoId }).from(mediosContacto).where(inArray(mediosContacto.id, de("medio_contacto")))),
      si(de("documento"), () => this.db.select({ id: documentos.id, nombre: documentos.nombreOriginal, version: documentos.version, empresaId: documentos.empresaId }).from(documentos).where(inArray(documentos.id, de("documento")))),
      si(de("cotizacion"), () => this.db.select({ id: cotizaciones.id, version: cotizaciones.version, empresaId: cotizaciones.empresaId, raizId: cotizaciones.cotizacionRaizId }).from(cotizaciones).where(inArray(cotizaciones.id, de("cotizacion")))),
      si(de("oportunidad"), () => this.db.select({ id: oportunidades.id, titulo: oportunidades.titulo }).from(oportunidades).where(inArray(oportunidades.id, de("oportunidad")))),
      si(de("campana"), () => this.db.select({ id: campanas.id, nombre: campanas.nombre }).from(campanas).where(inArray(campanas.id, de("campana")))),
      si(de("catalogo_tipo_documento"), () => this.db.select({ id: catalogoTipoDocumento.id, nombre: catalogoTipoDocumento.nombre }).from(catalogoTipoDocumento).where(inArray(catalogoTipoDocumento.id, de("catalogo_tipo_documento")))),
      this.db.select({ clave: catalogoEtapaEmbudo.clave, nombre: catalogoEtapaEmbudo.nombre }).from(catalogoEtapaEmbudo),
      si([...idsUsuarios], () => this.db.select({ id: usuarios.id, nombre: usuarios.nombre }).from(usuarios).where(inArray(usuarios.id, [...idsUsuarios])))
    ]);

    const idsContactos = [...new Set([...de("contacto"), ...filasProspectos.map((p) => p.contactoId), ...filasMedios.map((m) => m.contactoId).filter((id): id is number => id != null)])];
    const filasContactos = await si(idsContactos, () => this.db.select({ id: contactos.id, nombre: contactos.nombre, empresaId: contactos.empresaId }).from(contactos).where(inArray(contactos.id, idsContactos)));
    const idsEmpresas = [...new Set([...de("empresa"), ...filasContactos.map((c) => c.empresaId), ...filasDocumentos.map((d) => d.empresaId), ...filasCotizaciones.map((c) => c.empresaId)].filter((id): id is number => id != null))];
    const filasEmpresas = await si(idsEmpresas, () => this.db.select({ id: empresas.id, nombre: sql<string>`COALESCE(${empresas.nombreComercial}, ${empresas.nombreLegal})` }).from(empresas).where(inArray(empresas.id, idsEmpresas)));

    return {
      usuarios: new Map(filasUsuarios.map((u) => [u.id, u.nombre])),
      empresas: new Map(filasEmpresas.map((e) => [e.id, e.nombre])),
      contactos: new Map(filasContactos.map((c) => [c.id, { nombre: c.nombre, empresaId: c.empresaId }])),
      oportunidades: new Map(filasOportunidades.map((o) => [o.id, o.titulo])),
      cotizaciones: new Map(filasCotizaciones.map((c) => [c.id, { version: c.version, empresaId: c.empresaId, raizId: c.raizId }])),
      documentos: new Map(filasDocumentos.map((d) => [d.id, { nombre: d.nombre, version: d.version, empresaId: d.empresaId }])),
      campanas: new Map(filasCampanas.map((c) => [c.id, c.nombre])),
      tiposDocumento: new Map(filasTipos.map((t) => [t.id, t.nombre])),
      prospectos: new Map(filasProspectos.map((p) => [p.id, { contactoId: p.contactoId }])),
      medios: new Map(filasMedios.map((m) => [m.id, { valor: m.valor, contactoId: m.contactoId }])),
      etapas: new Map(filasEtapas.map((e) => [e.clave, e.nombre]))
    };
  }
}
