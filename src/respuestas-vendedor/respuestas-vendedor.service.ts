import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { auditoria, contactos, correosRespuesta, empresas, listaSupresion, mediosContacto, prospectos, respuestas, tareas, usoIa } from "../database/schema.js";
import { CORREO_SERVICE, type CorreoService } from "../integraciones/correo.types.js";
import { IA_SERVICE, type IaService } from "../integraciones/ia.types.js";
import { iaActiva } from "../integraciones/ia-activa.js";
import { HttpError } from "../shared/http-error.js";
import { recortarTexto } from "../shared/texto.js";
import { armarCorreo } from "../shared/plantillas.js";
import { firmarReplyTo } from "../shared/reply-to.js";
import { fechaMx, inicioDelDiaMxSql } from "../shared/dia-habil.js";
import { vendedorDeLaConversacion } from "../shared/conversacion.js";
import { correoDeEnvio, leerPie } from "../plantillas/plantillas.correo.js";
import { TITULO_TAREA_INTERESADO, TareasService } from "../tareas/tareas.service.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import type { ContestarInput } from "./dto/respuestas-vendedor.schema.js";

// Responder al prospecto desde el CRM (etapa 3 de las mejoras, plan aprobado
// por Fabián el 20-oct-2026). El correo sale como "<vendedor> · NANOBRIDGE"
// con el Reply-To firmado del envío: si el cliente contesta, PT2 lo identifica
// y la respuesta regresa sola (shared/conversacion.ts). No es un envío de
// prospección: no va a `envios` ni cuenta para el límite de 3 (P3.5).

// P3.1: a qué se le contesta. Fuera de conversación, solo a estas.
const CLASIFICACIONES_CONTESTABLES = new Set(["interesado", "reagendar", "ambigua"]);
// En conversación también a las que nadie ha clasificado, pero nunca a estas.
const CLASIFICACIONES_NUNCA = new Set(["baja", "no_interesado", "invalido", "automatica"]);
export const CODIGO_NO_SE_PUEDE_RESPONDER = "NO_SE_PUEDE_RESPONDER";
export const CODIGO_RESPUESTA_ENVIANDO = "RESPUESTA_ENVIANDO";
// Un 'enviando' solo traba la respuesta estos minutos (revisión de Fabián,
// 21-oct-2026). Si Cloud Run reinicia entre el insert y el update, la fila se
// quedaría en 'enviando' y daría 409 para siempre; pasados estos minutos se
// toma como fallida. Riesgo aceptado: si el correo sí salió, el siguiente
// clic lo manda otra vez.
const MINUTOS_CANDADO_ENVIANDO = 5;
const ERROR_SIN_CONFIRMACION = `Sin confirmación: se quedó más de ${MINUTOS_CANDADO_ENVIANDO} minutos en enviando`;
// P3.12.
export const MAX_BORRADORES_POR_DIA = 20;
const TIPO_BORRADOR = "borrador_respuesta";
const RESULTADO_TAREA = "Respondido por correo desde el CRM";
const CATEGORIA = "respuesta_vendedor";

// P3.10.
const INSTRUCCIONES_BORRADOR = [
  "Eres asistente de un vendedor de NANOBRIDGE (empresa mexicana). Redacta en español la respuesta del vendedor al correo de un prospecto.",
  "Reglas:",
  "- Trata al cliente de usted. Tono cordial y profesional, sin exagerar.",
  "- Máximo 120 palabras.",
  "- Nunca menciones precios, montos, descuentos, fechas de entrega ni plazos, y no prometas nada. Si el cliente pregunta por precios o fechas, di que el vendedor se los confirma en una llamada o en una cotización.",
  "- No inventes datos de la empresa, del cliente ni de los servicios. Usa solo lo que viene en el contexto.",
  "- Propón un siguiente paso concreto (por ejemplo, una llamada breve).",
  "- Empieza con un saludo con el nombre del cliente. No pongas firma ni despedida con nombre: la firma se agrega sola.",
  "Contesta solo el JSON pedido, con el texto del correo en `texto`."
].join("\n");
const ESQUEMA_BORRADOR = { type: "OBJECT", properties: { texto: { type: "STRING" } }, required: ["texto"] };

type Contexto = Awaited<ReturnType<RespuestasVendedorService["cargar"]>>;

@Injectable()
export class RespuestasVendedorService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Inject(CORREO_SERVICE) private readonly correo: CorreoService,
    @Inject(IA_SERVICE) private readonly ia: IaService,
    private readonly tareasService: TareasService
  ) {}

  // Todo lo que hace falta para contestar, y si se puede (con el motivo si no).
  // Un agente que no es dueño de la empresa ni responsable de la tarea no la
  // ve (404), igual que la ficha (P3.2).
  private async cargar(user: CurrentUser, respuestaId: number) {
    const [fila] = await this.db
      .select({
        respuestaId: respuestas.id,
        prospectoId: respuestas.prospectoId,
        envioId: respuestas.envioId,
        contenido: respuestas.contenido,
        clasificacion: respuestas.clasificacion,
        messageId: respuestas.messageId,
        asunto: respuestas.asunto,
        recibidoEn: respuestas.recibidoEn,
        estadoProspecto: prospectos.estado,
        contactoId: contactos.id,
        contactoNombre: contactos.nombre,
        empresaId: empresas.id,
        empresaNombre: sql<string>`COALESCE(${empresas.nombreComercial}, ${empresas.nombreLegal})`,
        giro: empresas.giro,
        propietarioId: empresas.propietarioId
      })
      .from(respuestas)
      .innerJoin(prospectos, eq(prospectos.id, respuestas.prospectoId))
      .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
      .innerJoin(empresas, eq(empresas.id, contactos.empresaId))
      .where(and(eq(respuestas.id, respuestaId), eq(empresas.activo, true)))
      .limit(1);
    if (!fila) throw new HttpError(404, "Respuesta no encontrada");

    // La tarea de esta respuesta o, si se juntaron (P3.9) o viene de una
    // conversación, la abierta del prospecto.
    const tareasDelProspecto = await this.db
      .select({ id: tareas.id, responsableId: tareas.responsableId, respuestaId: tareas.respuestaId, estado: tareas.estado })
      .from(tareas)
      .where(and(eq(tareas.prospectoId, fila.prospectoId), eq(tareas.titulo, TITULO_TAREA_INTERESADO)))
      .orderBy(asc(tareas.id));
    const abierta = (t: { estado: string }) => t.estado !== "cerrada" && t.estado !== "cancelada";
    const tarea = tareasDelProspecto.find((t) => t.respuestaId === respuestaId && abierta(t)) ?? tareasDelProspecto.find(abierta) ?? tareasDelProspecto.find((t) => t.respuestaId === respuestaId) ?? null;

    if (user.rol === "agente" && fila.propietarioId !== user.id && tarea?.responsableId !== user.id) {
      throw new HttpError(404, "Respuesta no encontrada");
    }

    const [medio] = await this.db
      .select({ valor: mediosContacto.valor, valorNormalizado: mediosContacto.valorNormalizado, estado: mediosContacto.estadoContacto })
      .from(mediosContacto)
      .where(and(eq(mediosContacto.contactoId, fila.contactoId), eq(mediosContacto.tipo, "correo")))
      .orderBy(sql`${mediosContacto.estadoContacto} = 'activo' DESC`, asc(mediosContacto.id))
      .limit(1);
    const [suprimido] = medio
      ? await this.db.select({ id: listaSupresion.id }).from(listaSupresion).where(and(eq(listaSupresion.tipo, "correo"), eq(listaSupresion.valorNormalizado, medio.valorNormalizado))).limit(1)
      : [];
    const enConversacion = (await vendedorDeLaConversacion(this.db, fila.prospectoId)) !== null;

    let motivo: string | null = null;
    if (fila.estadoProspecto === "baja") motivo = "El prospecto pidió la baja: no se le puede escribir.";
    else if (!medio) motivo = "El contacto no tiene correo.";
    else if (medio.estado !== "activo" || suprimido) motivo = "El correo del contacto está en no contactar.";
    else if (fila.envioId === null) motivo = "La respuesta no está ligada a un correo enviado.";
    else if (fila.clasificacion !== null && CLASIFICACIONES_NUNCA.has(fila.clasificacion)) motivo = `A una respuesta "${fila.clasificacion}" no se le contesta.`;
    else if (!enConversacion && (fila.clasificacion === null || !CLASIFICACIONES_CONTESTABLES.has(fila.clasificacion))) motivo = "Primero hay que clasificar la respuesta.";

    const asunto = await this.asuntoDe(fila.asunto, fila.envioId);
    return { ...fila, tarea, para: medio?.valor ?? null, asunto, enConversacion, motivo };
  }

  // "Re: <asunto>": el del correo del cliente si PT2 lo mandó, o el del
  // correo que se le mandó. Sin "Re: Re:".
  private async asuntoDe(asuntoCliente: string | null, envioId: number | null) {
    const base = asuntoCliente?.trim() || (envioId !== null ? (await correoDeEnvio(this.db, envioId)).asunto : "");
    if (/^(re|rv|fw|fwd)\s*:/i.test(base)) return base;
    return base ? `Re: ${base}` : "Re: NANOBRIDGE";
  }

  private firma(user: CurrentUser) {
    return `${user.nombre}\nNANOBRIDGE`;
  }

  async contexto(user: CurrentUser, respuestaId: number) {
    const c = await this.cargar(user, respuestaId);
    return {
      respuesta_id: c.respuestaId,
      prospecto_id: c.prospectoId,
      empresa_id: c.empresaId,
      empresa_nombre: c.empresaNombre,
      contacto_nombre: c.contactoNombre,
      contenido: c.contenido,
      clasificacion: c.clasificacion,
      recibido_en: c.recibidoEn,
      para: c.para,
      asunto: c.asunto,
      firma: this.firma(user),
      // Con la IA apagada, "Redactar con IA" se enseña desactivado (21-oct-2026).
      ia_activa: iaActiva(),
      en_conversacion: c.enConversacion,
      tarea_id: c.tarea?.id ?? null,
      tarea_abierta: c.tarea ? c.tarea.estado !== "cerrada" && c.tarea.estado !== "cancelada" : false,
      puede_responder: c.motivo === null,
      motivo: c.motivo
    };
  }

  private exigirQueSePueda(c: Contexto) {
    if (c.motivo !== null) throw new HttpError(409, c.motivo, CODIGO_NO_SE_PUEDE_RESPONDER);
  }

  // P3.7: lo que ve la IA. Sin montos ni cotizaciones.
  async borrador(user: CurrentUser, respuestaId: number) {
    const c = await this.cargar(user, respuestaId);
    this.exigirQueSePueda(c);

    const [{ hoy }] = await this.db
      .select({ hoy: sql<number>`COUNT(*)` })
      .from(usoIa)
      .where(and(eq(usoIa.usuarioId, user.id), eq(usoIa.tipo, TIPO_BORRADOR), gte(usoIa.creadoEn, sql`${inicioDelDiaMxSql(fechaMx(new Date()))}`)));
    if (Number(hoy) >= MAX_BORRADORES_POR_DIA) {
      throw new HttpError(429, `Ya usaste los ${MAX_BORRADORES_POR_DIA} borradores con IA de hoy. Escríbelo tú o inténtalo mañana.`);
    }

    const correoMandado = c.envioId !== null ? await correoDeEnvio(this.db, c.envioId) : null;
    const texto = [
      `Vendedor: ${user.nombre}`,
      `Cliente: ${c.contactoNombre}`,
      `Empresa del cliente: ${c.empresaNombre}`,
      `Giro: ${c.giro ?? "(sin giro)"}`,
      "",
      "Correo que NANOBRIDGE le mandó:",
      correoMandado ? `Asunto: ${correoMandado.asunto}\n${correoMandado.texto}` : "(no disponible)",
      "",
      "Lo que contestó el cliente:",
      c.contenido ?? "(sin texto)"
    ].join("\n");

    let resultado: { texto?: unknown };
    try {
      resultado = await this.ia.generarJson<{ texto?: unknown }>({ instrucciones: INSTRUCCIONES_BORRADOR, texto, esquema: ESQUEMA_BORRADOR });
    } catch {
      throw new HttpError(502, "No se pudo redactar con IA en este momento; escríbelo tú.");
    }
    const propuesta = typeof resultado.texto === "string" ? recortarTexto(resultado.texto.trim(), 5000) : "";
    if (!propuesta) throw new HttpError(502, "La IA no regresó un borrador; escríbelo tú.");

    const [fila] = await this.db.insert(usoIa).values({ usuarioId: user.id, tipo: TIPO_BORRADOR, respuestaId, resultado: propuesta });
    return { borrador_id: fila.insertId, texto: propuesta };
  }

  // Orden (propuesta de Fabián): se guarda 'enviando', se manda, y se marca
  // 'enviado' o 'fallido'. Nunca queda un correo que salió sin registro.
  async contestar(user: CurrentUser, respuestaId: number, input: ContestarInput) {
    const c = await this.cargar(user, respuestaId);
    this.exigirQueSePueda(c);
    const usoDeIa = await this.usoDeIa(user, respuestaId, input);
    const textoVendedor = input.texto.trim();

    const correoId = await this.db.transaction(async (tx) => {
      // Bloquea la respuesta: dos clics a la vez no pasan los dos.
      await tx.select({ id: respuestas.id }).from(respuestas).where(eq(respuestas.id, respuestaId)).for("update");
      // Hora de la base en los dos lados: creado_en es DEFAULT CURRENT_TIMESTAMP.
      const hace = sql`NOW() - INTERVAL ${sql.raw(String(MINUTOS_CANDADO_ENVIANDO))} MINUTE`;
      await tx.update(correosRespuesta)
        .set({ estado: "fallido", error: ERROR_SIN_CONFIRMACION })
        .where(and(eq(correosRespuesta.respuestaId, respuestaId), eq(correosRespuesta.estado, "enviando"), lt(correosRespuesta.creadoEn, hace)));
      const [enviando] = await tx.select({ id: correosRespuesta.id }).from(correosRespuesta).where(and(eq(correosRespuesta.respuestaId, respuestaId), eq(correosRespuesta.estado, "enviando"), gte(correosRespuesta.creadoEn, hace))).limit(1);
      if (enviando) throw new HttpError(409, "Ya se está mandando una respuesta a este correo.", CODIGO_RESPUESTA_ENVIANDO);
      const [fila] = await tx.insert(correosRespuesta).values({
        respuestaId,
        prospectoId: c.prospectoId,
        usuarioId: user.id,
        para: c.para!,
        asunto: c.asunto,
        texto: textoVendedor,
        usoIa: usoDeIa,
        estado: "enviando"
      });
      await tx.insert(auditoria).values({ usuarioId: user.id, entidad: "respuesta", entidadId: respuestaId, accion: "contestar", despues: { correo_respuesta_id: fila.insertId, uso_ia: usoDeIa } });
      return fila.insertId;
    });

    const mensaje = await this.armar(user, c, textoVendedor);
    let proveedorId: string | null;
    try {
      ({ id: proveedorId } = await this.correo.enviar({
        para: c.para!,
        nombrePara: c.contactoNombre,
        asunto: c.asunto,
        texto: mensaje.texto,
        html: mensaje.html,
        nombreRemitente: `${user.nombre} · NANOBRIDGE`,
        replyTo: firmarReplyTo(c.envioId!),
        ...(c.messageId ? { cabeceras: { "In-Reply-To": c.messageId, References: c.messageId } } : {}),
        categoria: CATEGORIA,
        linkDeBaja: true
      }));
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      await this.db.update(correosRespuesta).set({ estado: "fallido", error: recortarTexto(detalle, 300) }).where(eq(correosRespuesta.id, correoId));
      throw new HttpError(502, "No se pudo mandar el correo; intenta otra vez.");
    }
    await this.db.update(correosRespuesta).set({ estado: "enviado", proveedorId, enviadoEn: sql`CURRENT_TIMESTAMP` }).where(eq(correosRespuesta.id, correoId));

    // P3.8: casilla "Marcar la tarea como hecha". Si no se puede (ya la
    // cerraron, o es de otra persona), el correo ya salió: solo se avisa.
    let tareaCerrada = false;
    if (input.cerrar_tarea && c.tarea && c.tarea.estado !== "cerrada" && c.tarea.estado !== "cancelada") {
      try {
        await this.tareasService.cerrar(user, c.tarea.id, RESULTADO_TAREA);
        tareaCerrada = true;
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
      }
    }
    return { id: correoId, estado: "enviado" as const, tarea_cerrada: tareaCerrada };
  }

  // P3.11: tal cual o editado, comparando con el borrador que la IA le dio a
  // esta persona para esta respuesta.
  private async usoDeIa(user: CurrentUser, respuestaId: number, input: ContestarInput): Promise<"sin_ia" | "tal_cual" | "editado"> {
    if (input.borrador_id === undefined) return "sin_ia";
    const [b] = await this.db
      .select({ resultado: usoIa.resultado })
      .from(usoIa)
      .where(and(eq(usoIa.id, input.borrador_id), eq(usoIa.usuarioId, user.id), eq(usoIa.respuestaId, respuestaId), eq(usoIa.tipo, TIPO_BORRADOR)))
      .limit(1);
    if (!b) return "sin_ia";
    const igual = (t: string) => t.replace(/\s+/g, " ").trim();
    return igual(b.resultado ?? "") === igual(input.texto) ? "tal_cual" : "editado";
  }

  // El texto del vendedor + su firma con logo + el pie de siempre + el link
  // de baja que el pie promete, y abajo lo que escribió el cliente, citado.
  private async armar(user: CurrentUser, c: Contexto, texto: string) {
    const nombre = { nombre: c.contactoNombre, empresa: c.empresaNombre, giro: c.giro };
    const cuando = new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeStyle: "short", timeZone: "America/Mexico_City" }).format(c.recibidoEn);
    const cita = c.contenido ? { encabezado: `El ${cuando}, ${c.contactoNombre} escribió:`, contenido: c.contenido } : undefined;
    return armarCorreo({ asunto: c.asunto, cuerpo: texto }, nombre, await leerPie(this.db), { firma: user.nombre, linkDeBaja: true, cita });
  }
}
