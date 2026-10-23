import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { empresas, usoIa } from "../database/schema.js";
import { IA_SERVICE, type IaService } from "../integraciones/ia.types.js";
import { iaActiva } from "../integraciones/ia-activa.js";
import { ActividadesService } from "../crm/actividades.service.js";
import { OportunidadesService } from "../comercial/oportunidades.service.js";
import { CotizacionesService } from "../comercial/cotizaciones.service.js";
import { listOportunidadesQuerySchema } from "../comercial/dto/oportunidad.schema.js";
import { listCotizacionesQuerySchema } from "../comercial/dto/cotizacion.schema.js";
import { TareasService } from "../tareas/tareas.service.js";
import { HttpError } from "../shared/http-error.js";
import { recortarTexto } from "../shared/texto.js";
import { fechaMx, inicioDelDiaMxSql } from "../shared/dia-habil.js";
import type { CurrentUser } from "../auth/current-user.type.js";

// Resumen con IA en la ficha del cliente (etapa 4 de las mejoras). La IA lee
// lo que ESA persona puede ver de la empresa: se arma con las mismas funciones
// que llenan la ficha (historial, oportunidades, cotizaciones y tareas), que
// ya aplican lo de cada rol. Así un agente nunca manda (ni lee) oportunidades
// de otro agente. Se guarda el último por empresa y por persona (P4.2) en
// uso_ia, tipo 'resumen_ficha' (036).

export const CODIGO_SIN_INFORMACION = "SIN_INFORMACION";
// P4.8.
export const MAX_RESUMENES_POR_DIA = 20;
const TIPO = "resumen_ficha";
// P4.4: lo que sea menos.
const MAX_MOVIMIENTOS = 50;
const MESES_ATRAS = 12;
const MAX_CERRADAS = 20;
const MAX_COTIZACIONES = 20;
// P4.3: cada texto largo se recorta.
const MAX_TEXTO = 300;
const MOTIVO_SIN_INFORMACION = "Todavía no hay suficiente información para resumir.";

const INSTRUCCIONES = [
  "Eres asistente de un vendedor de NANOBRIDGE (empresa mexicana). Lee lo que ha pasado con un cliente y resume para el vendedor.",
  "Reglas:",
  "- En español y de tú: lo lee el vendedor, no el cliente.",
  "- `resumen`: máximo 3 oraciones (unas 60 palabras) con lo más importante: en qué va la relación, qué quiere el cliente y qué está pendiente.",
  "- `siguiente_paso`: una sola oración con la acción concreta que conviene hacer ahora.",
  "- Usa solo los datos que vienen abajo. No inventes nada. Si algo no está, no lo supongas.",
  "- Los montos y las fechas, tal como vienen. No recomiendes descuentos ni prometas nada.",
  "Contesta solo el JSON pedido."
].join("\n");
const ESQUEMA = {
  type: "OBJECT",
  properties: { resumen: { type: "STRING" }, siguiente_paso: { type: "STRING" } },
  required: ["resumen", "siguiente_paso"]
};

const moneda = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const dia = (fecha: Date | string | null | undefined) => (fecha ? fechaMx(new Date(fecha)) : null);

// P4.3: nada de correos ni teléfonos, aunque vengan dentro de un texto (la
// firma de un correo del cliente, un comentario del vendedor).
export function sinDatosDeContacto(texto: string): string {
  return texto
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[correo]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, (coincidencia) => (coincidencia.replace(/\D/g, "").length >= 7 ? "[teléfono]" : coincidencia));
}
// La tarea automática de un documento rechazado se llama "Corregir documento:
// <nombre del archivo>" (documentos.service.ts), y el nombre a veces trae el de
// una persona ("INE Rosa Peña.pdf"). A la IA le basta con saber que es un archivo.
export function sinNombreDeArchivo(titulo: unknown): unknown {
  return typeof titulo === "string" ? titulo.replace(/^(Corregir documento:\s*).+$/s, "$1[archivo]") : titulo;
}
const limpio = (texto: unknown) => (typeof texto === "string" && texto.trim() ? recortarTexto(sinDatosDeContacto(texto.trim().replace(/\s+/g, " ")), MAX_TEXTO) : null);

type Evento = { tipo: string; fecha: Date; resultado: string | null; proxima_accion: string | null; detalle: Record<string, unknown> };

function lineaDeEvento(e: Evento): string | null {
  const d = e.detalle;
  const partes: (string | null)[] = [];
  switch (e.tipo) {
    case "llamada":
    case "whatsapp":
    case "comentario":
      partes.push(e.tipo === "comentario" ? "Comentario del vendedor" : e.tipo === "llamada" ? "Llamada" : "WhatsApp");
      partes.push(limpio(e.resultado) && `resultado: ${limpio(e.resultado)}`);
      partes.push(limpio(e.proxima_accion) && `próxima acción: ${limpio(e.proxima_accion)}`);
      partes.push(limpio(d.comentario));
      break;
    case "correo_enviado":
      partes.push(`Correo de prospección número ${String(d.numero_contacto ?? "")} enviado`);
      break;
    case "correo_recibido":
      partes.push(`El cliente contestó${e.resultado ? ` (clasificado como ${e.resultado})` : ""}`);
      partes.push(limpio(d.contenido));
      break;
    case "correo_respondido":
      partes.push(`El vendedor le respondió por correo${d.usuario_nombre ? ` (${String(d.usuario_nombre)})` : ""}`);
      partes.push(limpio(d.texto));
      break;
    case "tarea":
      partes.push(`Tarea cerrada: ${limpio(sinNombreDeArchivo(d.titulo)) ?? "(sin título)"}`);
      partes.push(limpio(e.resultado) && `resultado: ${limpio(e.resultado)}`);
      break;
    // Sin el nombre del archivo ni la explicación del rechazo: a veces traen
    // nombres de personas o datos de una identificación.
    case "documento_subido":
      partes.push(`Se subió ${limpio(d.tipo_nombre) ?? "un documento"}${typeof d.version === "number" && d.version > 1 ? ` (versión ${d.version})` : ""}`);
      break;
    case "documento_revisado":
      partes.push(`${limpio(d.tipo_nombre) ?? "Documento"} ${e.resultado === "rechazado" ? "rechazado" : "aprobado"}${e.resultado === "rechazado" && limpio(d.motivo) ? `: ${limpio(d.motivo)}` : ""}`);
      break;
    case "cambio_estado_prospecto":
      partes.push(`El prospecto pasó a ${e.resultado ?? "otro estado"}`);
      break;
    default:
      return null;
  }
  const texto = partes.filter(Boolean).join(" · ");
  return texto ? `- ${dia(e.fecha)} · ${texto}` : null;
}

@Injectable()
export class ResumenFichaService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Inject(IA_SERVICE) private readonly ia: IaService,
    private readonly actividades: ActividadesService,
    private readonly oportunidades: OportunidadesService,
    private readonly cotizaciones: CotizacionesService,
    private readonly tareas: TareasService
  ) {}

  // Todo lo que la persona ve de la empresa, ya acotado a P4.4. El 404 de un
  // agente con empresa ajena sale de timeline().
  private async reunir(user: CurrentUser, empresaId: number) {
    const { data: historial } = await this.actividades.timeline(user, { empresaId, limit: MAX_MOVIMIENTOS });
    const desde = new Date();
    desde.setMonth(desde.getMonth() - MESES_ATRAS);
    const reciente = (fecha: Date | string | null | undefined) => fecha != null && new Date(fecha) >= desde;

    const [{ data: ops }, { data: cots }, { data: pendientes }, [empresa]] = await Promise.all([
      this.oportunidades.list(user, listOportunidadesQuerySchema.parse({ empresaId, limit: 100 })),
      this.cotizaciones.list(user, listCotizacionesQuerySchema.parse({ empresaId, limit: MAX_COTIZACIONES })),
      this.tareas.list(user, { empresaId }, 1, 100),
      this.db.select({ nombre: sql<string>`COALESCE(${empresas.nombreComercial}, ${empresas.nombreLegal})`, giro: empresas.giro, ciudad: empresas.ciudad, estado: empresas.estado }).from(empresas).where(eq(empresas.id, empresaId)).limit(1)
    ]);

    const movimientos = (historial as Evento[]).filter((e) => reciente(e.fecha));
    const abiertas = ops.filter((o) => !o.cerrada);
    const cerradas = ops.filter((o) => o.cerrada && reciente(o.actualizado_en)).slice(0, MAX_CERRADAS);
    const cotizaciones = cots.filter((c) => reciente(c.creado_en));
    const tareasAbiertas = pendientes.filter((t) => t.estado === "pendiente" || t.estado === "en_progreso");
    // Lo más nuevo que hay, para saber si el resumen guardado se quedó atrás.
    const ultimoMovimiento = [movimientos[0]?.fecha, ...ops.map((o) => o.actualizado_en), ...cots.map((c) => c.actualizado_en)]
      .filter((f) => f != null)
      .map((f) => new Date(f as Date | string).getTime())
      .reduce((max, t) => Math.max(max, t), 0);
    return { empresa, movimientos, abiertas, cerradas, cotizaciones, tareasAbiertas, ultimoMovimiento, hayInformacion: movimientos.length > 0 || ops.length > 0 };
  }

  private async ultimo(user: CurrentUser, empresaId: number) {
    const [fila] = await this.db
      .select({ resultado: usoIa.resultado, creadoEn: usoIa.creadoEn })
      .from(usoIa)
      .where(and(eq(usoIa.empresaId, empresaId), eq(usoIa.usuarioId, user.id), eq(usoIa.tipo, TIPO)))
      .orderBy(desc(usoIa.creadoEn), desc(usoIa.id))
      .limit(1);
    if (!fila?.resultado) return null;
    try {
      const datos = JSON.parse(fila.resultado) as { resumen?: unknown; siguiente_paso?: unknown; hasta?: unknown };
      if (typeof datos.resumen !== "string" || !datos.resumen) return null;
      return {
        resumen: { texto: datos.resumen, siguiente_paso: typeof datos.siguiente_paso === "string" ? datos.siguiente_paso : null, creado_en: fila.creadoEn },
        hasta: typeof datos.hasta === "number" ? datos.hasta : new Date(fila.creadoEn).getTime()
      };
    } catch {
      return null;
    }
  }

  // `hasta` es el movimiento más nuevo que ya entró al resumen. Se compara movimiento contra movimiento y no
  // contra la hora del resumen: esa la pone MySQL y las actividades llevan la hora de la API (redondeada al
  // segundo), así que un movimiento del mismo segundo salía como "nuevo" justo después de resumir.
  private respuesta(datos: Awaited<ReturnType<ResumenFichaService["reunir"]>>, guardado: Awaited<ReturnType<ResumenFichaService["ultimo"]>>) {
    return {
      resumen: guardado?.resumen ?? null,
      desactualizado: guardado !== null && datos.ultimoMovimiento > guardado.hasta,
      ia_activa: iaActiva(),
      puede_generar: datos.hayInformacion,
      motivo: datos.hayInformacion ? null : MOTIVO_SIN_INFORMACION
    };
  }

  async estado(user: CurrentUser, empresaId: number) {
    const datos = await this.reunir(user, empresaId);
    return this.respuesta(datos, await this.ultimo(user, empresaId));
  }

  async generar(user: CurrentUser, empresaId: number) {
    const datos = await this.reunir(user, empresaId);
    if (!datos.hayInformacion) throw new HttpError(409, MOTIVO_SIN_INFORMACION, CODIGO_SIN_INFORMACION);

    const [{ hoy }] = await this.db
      .select({ hoy: sql<number>`COUNT(*)` })
      .from(usoIa)
      .where(and(eq(usoIa.usuarioId, user.id), eq(usoIa.tipo, TIPO), gte(usoIa.creadoEn, sql`${inicioDelDiaMxSql(fechaMx(new Date()))}`)));
    if (Number(hoy) >= MAX_RESUMENES_POR_DIA) {
      throw new HttpError(429, `Ya usaste los ${MAX_RESUMENES_POR_DIA} resúmenes con IA de hoy. Inténtalo mañana.`);
    }

    let resultado: { resumen?: unknown; siguiente_paso?: unknown };
    try {
      resultado = await this.ia.generarJson({ instrucciones: INSTRUCCIONES, texto: this.texto(datos), esquema: ESQUEMA });
    } catch {
      throw new HttpError(502, "No se pudo resumir con IA en este momento; inténtalo más tarde.");
    }
    const resumen = typeof resultado.resumen === "string" ? recortarTexto(resultado.resumen.trim(), 1000) : "";
    const siguiente = typeof resultado.siguiente_paso === "string" ? recortarTexto(resultado.siguiente_paso.trim(), 500) : "";
    if (!resumen) throw new HttpError(502, "La IA no regresó un resumen; inténtalo más tarde.");

    await this.db.insert(usoIa).values({ usuarioId: user.id, tipo: TIPO, empresaId, resultado: JSON.stringify({ resumen, siguiente_paso: siguiente || null, hasta: datos.ultimoMovimiento }) });
    return this.respuesta(datos, await this.ultimo(user, empresaId));
  }

  // Lo que se le manda a la IA (P4.3): sin correos ni teléfonos.
  private texto(d: Awaited<ReturnType<ResumenFichaService["reunir"]>>) {
    const e = d.empresa;
    const lineas = [
      `Hoy: ${fechaMx(new Date())}`,
      `Cliente: ${e?.nombre ?? "(sin nombre)"}${e?.giro ? ` · giro: ${e.giro}` : ""}${e?.ciudad || e?.estado ? ` · ${[e?.ciudad, e?.estado].filter(Boolean).join(", ")}` : ""}`,
      "",
      "Historial (más reciente primero):",
      ...(d.movimientos.map(lineaDeEvento).filter((l): l is string => l !== null)),
      d.movimientos.length === 0 ? "(sin movimientos en los últimos 12 meses)" : "",
      "",
      "Oportunidades abiertas:",
      ...(d.abiertas.length === 0 ? ["(ninguna)"] : d.abiertas.map((o) => `- ${limpio(o.titulo)} · etapa ${o.etapa_nombre} (${o.probabilidad}%)${o.valor_estimado ? ` · valor ${moneda.format(Number(o.valor_estimado))}` : ""}${o.fecha_cierre_estimada ? ` · cierre estimado ${o.fecha_cierre_estimada}` : ""}`)),
      "",
      "Oportunidades cerradas (últimos 12 meses):",
      ...(d.cerradas.length === 0 ? ["(ninguna)"] : d.cerradas.map((o) => `- ${limpio(o.titulo)} · ${o.etapa_nombre}${o.valor_estimado ? ` · valor ${moneda.format(Number(o.valor_estimado))}` : ""}${limpio(o.motivo_perdida_detalle) ? ` · motivo: ${limpio(o.motivo_perdida_detalle)}` : ""}`)),
      "",
      "Cotizaciones:",
      ...(d.cotizaciones.length === 0 ? ["(ninguna)"] : d.cotizaciones.map((c) => `- #${c.id} v${c.version} · ${c.estado} · total ${moneda.format(Number(c.total))} ${c.moneda} · emitida ${dia(c.fecha_emision)}${c.fecha_envio ? ` · enviada ${dia(c.fecha_envio)}` : ""}`)),
      "",
      "Tareas abiertas:",
      ...(d.tareasAbiertas.length === 0 ? ["(ninguna)"] : d.tareasAbiertas.map((t) => `- ${limpio(sinNombreDeArchivo(t.titulo))}${t.fecha_limite ? ` · vence ${dia(t.fecha_limite)}` : ""}`))
    ];
    return lineas.join("\n");
  }
}
