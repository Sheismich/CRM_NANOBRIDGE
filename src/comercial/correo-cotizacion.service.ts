import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { auditoria, contactos, correosCotizacion, empresas, listaSupresion, mediosContacto, oportunidades } from "../database/schema.js";
import { CORREO_SERVICE, type CorreoService } from "../integraciones/correo.types.js";
import { HttpError } from "../shared/http-error.js";
import { recortarTexto } from "../shared/texto.js";
import { armarCorreo } from "../shared/plantillas.js";
import { personaEnBaja } from "../shared/baja-prospecto.js";
import { leerPie } from "../plantillas/plantillas.correo.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import { CotizacionesService } from "./cotizaciones.service.js";
import { cotizacionPdf, nombreArchivoCotizacion } from "./cotizacion-pdf.js";
import type { CambiarEstadoCotizacionInput, MandarCotizacionInput } from "./dto/cotizacion.schema.js";

// Mandar la cotización por correo desde el CRM (Fabián, 3-nov-2026): el PDF
// adjunto, la firma del vendedor con logo y el pie corto de Administración,
// sin link de baja (es algo que el cliente pidió, no prospección). El
// Reply-To es el correo del vendedor: a esta altura ya es plática directa, y
// la respuesta no pasa por el CRM. No va en `envios` ni cuenta como contacto.
export const CODIGO_COTIZACION_NO_SE_MANDA = "COTIZACION_NO_SE_MANDA";
export const CODIGO_CONTACTO_NO_CONTACTAR = "CONTACTO_NO_CONTACTAR";
export const CODIGO_COTIZACION_ENVIANDO = "COTIZACION_ENVIANDO";
const CATEGORIA = "cotizacion";
// Mismo candado que responder al prospecto (respuestas-vendedor.service.ts).
const MINUTOS_CANDADO_ENVIANDO = 5;
const ERROR_SIN_CONFIRMACION = `Sin confirmación: se quedó más de ${MINUTOS_CANDADO_ENVIANDO} minutos en enviando`;

const MOTIVO_ESTADO: Record<string, string> = {
  aceptada: "La cotización ya está aceptada.",
  rechazada: "La cotización está rechazada: saca una versión nueva para mandarla.",
  vencida: "La cotización está vencida: saca una versión nueva para mandarla.",
  obsoleta: "Hay una versión más nueva de esta cotización: manda esa."
};

type ContactoConCorreo = { id: number; nombre: string; correo: string; motivo: string | null };

@Injectable()
export class CorreoCotizacionService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Inject(CORREO_SERVICE) private readonly correo: CorreoService,
    private readonly cotizacionesService: CotizacionesService
  ) {}

  // La cotización con el mismo alcance que GET /cotizaciones/:id (un agente,
  // solo las de sus oportunidades: si no, 404), los contactos de la empresa
  // con correo y, si no se puede mandar, por qué.
  private async cargar(user: CurrentUser, id: number) {
    const cotizacion = await this.cotizacionesService.get(user, id);
    let motivo = MOTIVO_ESTADO[cotizacion.estado] ?? null;
    if (!motivo && cotizacion.estado === "borrador") {
      const [op] = await this.db.select({ cerrada: oportunidades.cerrada }).from(oportunidades).where(eq(oportunidades.id, cotizacion.oportunidad_id)).limit(1);
      if (!op || op.cerrada) motivo = "La oportunidad ya está cerrada.";
    }
    const [empresa] = await this.db.select({ giro: empresas.giro }).from(empresas).where(eq(empresas.id, cotizacion.empresa_id)).limit(1);
    return { cotizacion, motivo, giro: empresa?.giro ?? null, contactos: await this.contactosConCorreo(cotizacion.empresa_id) };
  }

  // Un correo por contacto (el activo primero). No se le puede mandar si ese
  // correo está en no contactar o en la lista de supresión, o si la persona
  // pidió la baja.
  private async contactosConCorreo(empresaId: number): Promise<ContactoConCorreo[]> {
    const filas = await this.db
      .select({ id: contactos.id, nombre: contactos.nombre, correo: mediosContacto.valor, valorNormalizado: mediosContacto.valorNormalizado, estado: mediosContacto.estadoContacto })
      .from(contactos)
      .innerJoin(mediosContacto, and(eq(mediosContacto.contactoId, contactos.id), eq(mediosContacto.tipo, "correo")))
      .where(and(eq(contactos.empresaId, empresaId), eq(contactos.activo, true)))
      .orderBy(asc(contactos.id), sql`${mediosContacto.estadoContacto} = 'activo' DESC`, asc(mediosContacto.id));
    const unoPorContacto = filas.filter((f, i) => filas.findIndex((g) => g.id === f.id) === i);
    if (unoPorContacto.length === 0) return [];
    const suprimidos = new Set(
      (await this.db.select({ valor: listaSupresion.valorNormalizado }).from(listaSupresion)
        .where(and(eq(listaSupresion.tipo, "correo"), inArray(listaSupresion.valorNormalizado, unoPorContacto.map((f) => f.valorNormalizado))))).map((s) => s.valor)
    );
    return Promise.all(unoPorContacto.map(async (f) => {
      let motivo: string | null = null;
      if (await personaEnBaja(this.db, f.id)) motivo = "Pidió la baja: no se le puede escribir.";
      else if (f.estado !== "activo" || suprimidos.has(f.valorNormalizado)) motivo = "El correo está en no contactar.";
      return { id: f.id, nombre: f.nombre, correo: f.correo, motivo };
    }));
  }

  private textoListo(cotizacion: { id: number; oportunidad_titulo: string | null }, nombre: string | null) {
    const para = cotizacion.oportunidad_titulo ? ` para ${cotizacion.oportunidad_titulo}` : "";
    return `${nombre ? `Hola ${nombre},` : "Hola,"}\n\nLe comparto la cotización #${cotizacion.id}${para}, que va adjunta en PDF.\n\nQuedo atento a cualquier duda.`;
  }

  async contexto(user: CurrentUser, id: number) {
    const { cotizacion, motivo, contactos: lista } = await this.cargar(user, id);
    const elegido = lista.find((c) => c.id === cotizacion.contacto_id && !c.motivo) ?? lista.find((c) => !c.motivo) ?? null;
    return {
      cotizacion_id: cotizacion.id,
      estado: cotizacion.estado,
      motivo,
      contactos: lista,
      contacto_id: elegido?.id ?? null,
      asunto: `Cotización #${cotizacion.id} · NANOBRIDGE`,
      texto: this.textoListo(cotizacion, elegido?.nombre ?? null),
      archivo: nombreArchivoCotizacion(cotizacion)
    };
  }

  // Orden igual que responder al prospecto: se guarda 'enviando', se manda y
  // se marca 'enviado' o 'fallido'. Nunca queda un correo que salió sin
  // registro. Si estaba en borrador, al salir pasa a 'enviada'.
  async mandar(user: CurrentUser, id: number, input: MandarCotizacionInput) {
    const { cotizacion, motivo, giro, contactos: lista } = await this.cargar(user, id);
    if (motivo) throw new HttpError(409, motivo, CODIGO_COTIZACION_NO_SE_MANDA);
    const contacto = lista.find((c) => c.id === input.contactoId);
    if (!contacto) throw new HttpError(404, "Contacto no encontrado: tiene que ser de la empresa de la cotización y tener correo");
    if (contacto.motivo) throw new HttpError(409, contacto.motivo, CODIGO_CONTACTO_NO_CONTACTAR);

    const correoId = await this.db.transaction(async (tx) => {
      // Hora de la base en los dos lados: creado_en es DEFAULT CURRENT_TIMESTAMP.
      const hace = sql`NOW() - INTERVAL ${sql.raw(String(MINUTOS_CANDADO_ENVIANDO))} MINUTE`;
      await tx.update(correosCotizacion)
        .set({ estado: "fallido", error: ERROR_SIN_CONFIRMACION })
        .where(and(eq(correosCotizacion.cotizacionId, id), eq(correosCotizacion.estado, "enviando"), lt(correosCotizacion.creadoEn, hace)));
      const [enviando] = await tx.select({ id: correosCotizacion.id }).from(correosCotizacion)
        .where(and(eq(correosCotizacion.cotizacionId, id), eq(correosCotizacion.estado, "enviando"), gte(correosCotizacion.creadoEn, hace))).limit(1).for("update");
      if (enviando) throw new HttpError(409, "Ya se está mandando esta cotización.", CODIGO_COTIZACION_ENVIANDO);
      const [fila] = await tx.insert(correosCotizacion).values({
        cotizacionId: id,
        empresaId: cotizacion.empresa_id,
        contactoId: contacto.id,
        usuarioId: user.id,
        para: contacto.correo,
        asunto: input.asunto,
        texto: input.texto,
        estado: "enviando"
      });
      await tx.insert(auditoria).values({ usuarioId: user.id, entidad: "cotizacion", entidadId: id, accion: "mandar_por_correo", despues: { correo_cotizacion_id: fila.insertId, contacto_id: contacto.id, version: cotizacion.version } });
      return fila.insertId;
    });

    let proveedorId: string | null;
    try {
      const pdf = await cotizacionPdf(cotizacion);
      const armado = armarCorreo(
        { asunto: input.asunto, cuerpo: input.texto },
        { nombre: contacto.nombre, empresa: cotizacion.empresa_nombre, giro },
        await leerPie(this.db),
        { firma: user.nombre, logo: true }
      );
      ({ id: proveedorId } = await this.correo.enviar({
        para: contacto.correo,
        nombrePara: contacto.nombre,
        asunto: armado.asunto,
        texto: armado.texto,
        html: armado.html,
        nombreRemitente: `${user.nombre} · NANOBRIDGE`,
        replyTo: user.correo,
        categoria: CATEGORIA,
        adjuntos: [{ nombre: nombreArchivoCotizacion(cotizacion), tipo: "application/pdf", contenidoBase64: pdf.toString("base64") }]
      }));
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      await this.db.update(correosCotizacion).set({ estado: "fallido", error: recortarTexto(detalle, 300) }).where(eq(correosCotizacion.id, correoId));
      throw new HttpError(502, "No se pudo mandar el correo; intenta otra vez.");
    }
    await this.db.update(correosCotizacion).set({ estado: "enviado", proveedorId, enviadoEn: sql`CURRENT_TIMESTAMP` }).where(eq(correosCotizacion.id, correoId));

    // El correo ya salió: si alguien la movió mientras tanto, solo se deja
    // como está.
    let estado = cotizacion.estado;
    if (estado === "borrador") {
      try {
        estado = (await this.cotizacionesService.cambiarEstado(user, id, { estado: "enviada" } as CambiarEstadoCotizacionInput)).estado;
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
      }
    }
    return { id: correoId, estado: "enviado" as const, cotizacion_estado: estado };
  }
}
