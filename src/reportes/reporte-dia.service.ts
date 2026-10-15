import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gte, gt, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { auditoria, campanas, contactos, documentos, empresas, envios, eventosPendientes, procesosFallidos, prospectos, respuestas, tareas, usuarios } from "../database/schema.js";
import { toCsv } from "../shared/csv.js";
import { diaSiguiente, horaMx, inicioDelDiaMxSql } from "../shared/dia-habil.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import { TIPO_ERROR_WORKFLOW } from "../automatizacion/automatizacion.service.js";
import type { ReporteDiaQuery, TipoBitacora } from "./dto/reporte.schema.js";

// "17 oct, 10:00" en hora de México (la fecha nueva de una tarea reprogramada).
const FECHA_HORA_MX = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// Un movimiento de la bitácora. usuario_id = quién lo hizo (null = la
// automatización, un contacto o el sistema). texto va sin el nombre de quien
// lo hizo: la pantalla lo antepone ("Fabián cerró ...").
export type MovimientoDia = {
  tipo: TipoBitacora;
  subtipo: string;
  fecha: Date;
  usuario_id: number | null;
  usuario_nombre: string | null;
  responsable_id?: number | null;
  empresa_id: number | null;
  empresa_nombre: string | null;
  entidad: { tipo: string; id: number } | null;
  texto: string;
  [extra: string]: unknown;
};

const NUMERO_CONTACTO = ["", "correo inicial", "1er recordatorio", "2º recordatorio"];
const TAREA_ABIERTA = ["pendiente", "en_progreso"] as const;

// Reportes · Día = bitácora (Fabián lo aprobó el 11-oct-2026; punto 52):
// todo lo que pasó en el CRM un día de México, en orden de hora. Sale de
// tablas que ya existen -- auditoría (quién cerró, tomó, subió, aprobó),
// tareas, envíos, respuestas, procesos fallidos y outbox --, sin tabla nueva.
// Separación acordada: esto es el TRABAJO del día; el "Registro de cambios"
// de Administración es el CONTROL (quién movió qué).
//
// Con persona (usuarioId, y siempre para un agente): solo lo que hizo esa
// persona más sus tareas que vencieron; los números que no son de una
// persona (correos, respuestas, bajas, avisos a n8n) salen en null.
@Injectable()
export class ReporteDiaService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async dia(user: CurrentUser, query: ReporteDiaQuery) {
    const usuarioId = user.rol === "agente" ? user.id : query.usuarioId;
    const datos = await this.reunir(query.fecha, usuarioId);
    const filtrados = query.tipo === "todo" ? datos.movimientos : datos.movimientos.filter((m) => m.tipo === query.tipo);
    const inicio = (query.page - 1) * query.limit;
    return {
      fecha: query.fecha,
      resumen: datos.resumen,
      para_revisar: datos.paraRevisar,
      bitacora: { total: filtrados.length, page: query.page, limit: query.limit, data: filtrados.slice(inicio, inicio + query.limit) },
      por_persona: datos.porPersona,
      automatizacion: datos.automatizacion,
      quedo_pendiente: datos.quedoPendiente
    };
  }

  // Toda la bitácora del día (sin páginas), en hora de México.
  async exportarCsv(user: CurrentUser, query: ReporteDiaQuery) {
    const usuarioId = user.rol === "agente" ? user.id : query.usuarioId;
    const { movimientos } = await this.reunir(query.fecha, usuarioId);
    const filas = (query.tipo === "todo" ? movimientos : movimientos.filter((m) => m.tipo === query.tipo)).map((m) => ({
      hora: horaMx(m.fecha),
      tipo: m.tipo,
      quien: m.usuario_nombre ?? quienSinUsuario(m),
      que: m.texto,
      empresa: m.empresa_nombre ?? ""
    }));
    return { nombreArchivo: `bitacora_${query.fecha}.csv`, contenido: toCsv(filas, ["hora", "tipo", "quien", "que", "empresa"]) };
  }

  private async reunir(fecha: string, usuarioId: number | undefined) {
    const ini = sql`${inicioDelDiaMxSql(fecha)}`;
    const fin = sql`${inicioDelDiaMxSql(diaSiguiente(fecha))}`;
    const delDia = (columna: Parameters<typeof gte>[0]) => and(gte(columna, ini), lt(columna, fin));
    const empresaNombre = sql<string | null>`COALESCE(${empresas.nombreComercial}, ${empresas.nombreLegal})`;
    const responsable = alias(usuarios, "responsable");

    const [filasEnvios, filasRespuestas, filasBajas, filasCreadas, filasAuditTareas, filasVencian, filasDocs, filasFallos, filasReintentos, [cerradas]] = await Promise.all([
      this.db
        .select({ fecha: envios.enviadoEn, numeroContacto: envios.numeroContacto, campanaId: prospectos.campanaId, campanaNombre: campanas.nombre })
        .from(envios)
        .innerJoin(prospectos, eq(prospectos.id, envios.prospectoId))
        .leftJoin(campanas, eq(campanas.id, prospectos.campanaId))
        .where(delDia(envios.enviadoEn)),
      this.db
        .select({ id: respuestas.id, fecha: respuestas.recibidoEn, clasificacion: respuestas.clasificacion, estado: respuestas.estado, contactoNombre: contactos.nombre, empresaId: empresas.id, empresaNombre })
        .from(respuestas)
        .innerJoin(prospectos, eq(prospectos.id, respuestas.prospectoId))
        .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
        .innerJoin(empresas, eq(empresas.id, contactos.empresaId))
        .where(delDia(respuestas.recibidoEn)),
      // Igual que actividadReciente(): la baja sale de la auditoría del
      // prospecto, venga del link, de una queja o de la cola.
      this.db
        .select({ fecha: auditoria.creadoEn, prospectoId: prospectos.id, contactoId: contactos.id, contactoNombre: contactos.nombre, empresaId: empresas.id, empresaNombre, motivo: sql<string | null>`JSON_UNQUOTE(JSON_EXTRACT(${auditoria.despues}, '$.motivo'))` })
        .from(auditoria)
        .innerJoin(prospectos, eq(prospectos.id, auditoria.entidadId))
        .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
        .innerJoin(empresas, eq(empresas.id, contactos.empresaId))
        .where(and(eq(auditoria.entidad, "prospecto"), sql`JSON_UNQUOTE(JSON_EXTRACT(${auditoria.despues}, '$.estado')) = 'baja'`, delDia(auditoria.creadoEn))),
      this.db
        .select({ id: tareas.id, fecha: tareas.creadoEn, titulo: tareas.titulo, creadaPor: tareas.creadaPor, responsableId: tareas.responsableId, responsableNombre: responsable.nombre, empresaId: tareas.empresaId, empresaNombre })
        .from(tareas)
        .leftJoin(empresas, eq(empresas.id, tareas.empresaId))
        .leftJoin(responsable, eq(responsable.id, tareas.responsableId))
        .where(delDia(tareas.creadoEn)),
      this.db
        .select({ fecha: auditoria.creadoEn, accion: auditoria.accion, usuarioId: auditoria.usuarioId, antes: auditoria.antes, despues: auditoria.despues, tareaId: tareas.id, titulo: tareas.titulo, empresaId: tareas.empresaId, empresaNombre })
        .from(auditoria)
        .innerJoin(tareas, eq(tareas.id, auditoria.entidadId))
        .leftJoin(empresas, eq(empresas.id, tareas.empresaId))
        .where(and(eq(auditoria.entidad, "tarea"), inArray(auditoria.accion, ["cerrar", "clasificar", "asignar", "reprogramar"]), delDia(auditoria.creadoEn))),
      // Las que vencían ese día (fecha límite dentro del día), sin canceladas.
      this.db
        .select({ id: tareas.id, titulo: tareas.titulo, estado: tareas.estado, fechaLimite: tareas.fechaLimite, cerradaEn: tareas.cerradaEn, responsableId: tareas.responsableId, responsableNombre: responsable.nombre, empresaId: tareas.empresaId, empresaNombre })
        .from(tareas)
        .leftJoin(empresas, eq(empresas.id, tareas.empresaId))
        .leftJoin(responsable, eq(responsable.id, tareas.responsableId))
        .where(and(delDia(tareas.fechaLimite), ne(tareas.estado, "cancelada"), usuarioId ? eq(tareas.responsableId, usuarioId) : undefined)),
      this.db
        .select({ fecha: auditoria.creadoEn, accion: auditoria.accion, usuarioId: auditoria.usuarioId, documentoId: documentos.id, nombre: documentos.nombreOriginal, motivo: documentos.motivoRechazo, empresaId: documentos.empresaId, empresaNombre })
        .from(auditoria)
        .innerJoin(documentos, eq(documentos.id, auditoria.entidadId))
        .leftJoin(empresas, eq(empresas.id, documentos.empresaId))
        .where(and(eq(auditoria.entidad, "documento"), inArray(auditoria.accion, ["subir", "nueva_version", "aprobar", "rechazar", "revisar"]), delDia(auditoria.creadoEn))),
      this.db.select({ id: procesosFallidos.id, fecha: procesosFallidos.creadoEn, tipo: procesosFallidos.tipo, workflow: procesosFallidos.workflow, nodo: procesosFallidos.nodo, mensaje: procesosFallidos.mensaje }).from(procesosFallidos).where(delDia(procesosFallidos.creadoEn)),
      // Avisos que llegaron a n8n después de fallar: no queda cada intento,
      // solo cuántos llevó y cuándo salió.
      this.db.select({ id: eventosPendientes.id, fecha: eventosPendientes.actualizadoEn, tipo: eventosPendientes.tipo, intentos: eventosPendientes.intentos })
        .from(eventosPendientes)
        .where(and(eq(eventosPendientes.estado, "enviado"), gt(eventosPendientes.intentos, 1), delDia(eventosPendientes.actualizadoEn))),
      this.db.select({ n: sql<number>`COUNT(*)` }).from(tareas)
        .where(and(eq(tareas.estado, "cerrada"), isNotNull(tareas.cerradaEn), delDia(tareas.cerradaEn), usuarioId ? eq(tareas.responsableId, usuarioId) : undefined))
    ]);

    const ahora = Date.now();
    const finDelDia = new Date(`${inicioDelDiaMxSql(diaSiguiente(fecha)).replace(" ", "T")}Z`).getTime();
    const actores = new Set<number>();
    for (const f of [...filasAuditTareas, ...filasDocs]) if (f.usuarioId) actores.add(f.usuarioId);
    for (const f of filasCreadas) if (f.creadaPor) actores.add(f.creadaPor);
    const nombres = new Map<number, string>();
    if (actores.size > 0) {
      for (const u of await this.db.select({ id: usuarios.id, nombre: usuarios.nombre }).from(usuarios).where(inArray(usuarios.id, [...actores]))) nombres.set(u.id, u.nombre);
    }
    const nombre = (id: number | null) => (id ? nombres.get(id) ?? null : null);

    // El orden de este arreglo desempata movimientos con la misma hora (sort
    // estable): lo hecho por personas primero, la automatización al final.
    const movimientos: MovimientoDia[] = [];

    for (const f of filasAuditTareas) {
      const base = { tipo: "tareas" as const, fecha: f.fecha, usuario_id: f.usuarioId, usuario_nombre: nombre(f.usuarioId), empresa_id: f.empresaId, empresa_nombre: f.empresaNombre, entidad: { tipo: "tarea", id: f.tareaId } };
      if (f.accion === "asignar") {
        const antes = (f.antes as { responsable_id?: number | null } | null)?.responsable_id ?? null;
        const despues = (f.despues as { responsable_id?: number | null } | null)?.responsable_id ?? null;
        const tomada = despues !== null && despues === f.usuarioId;
        movimientos.push({
          ...base,
          subtipo: tomada ? "tomada" : "asignada",
          texto: tomada ? `tomó “${f.titulo}”${antes === null ? " (estaba sin asignar)" : ""}` : `le asignó “${f.titulo}” a ${nombre(despues) ?? "otra persona"}`
        });
      } else if (f.accion === "reprogramar") {
        // Mi día (13-oct-2026): mover la fecha límite. La auditoría guarda
        // la fecha nueva como texto ISO (JSON).
        const nueva = (f.despues as { fecha_limite?: string | null } | null)?.fecha_limite;
        movimientos.push({ ...base, subtipo: "reprogramada", texto: `movió “${f.titulo}” ${nueva ? `al ${FECHA_HORA_MX.format(new Date(nueva))}` : "de fecha"}` });
      } else {
        const d = (f.despues ?? {}) as { resultado?: string; clasificacion?: string };
        const detalle = f.accion === "clasificar" ? ` — la marcó como ${d.clasificacion ?? "clasificada"}` : d.resultado ? ` — resultado: ${d.resultado}` : "";
        movimientos.push({ ...base, subtipo: "cerrada", texto: `cerró “${f.titulo}”${detalle}` });
      }
    }

    // procesos_fallidos junta dos cosas distintas: un workflow de n8n que
    // falló (lo reporta el Error Workflow B4) y un aviso de la API a n8n
    // que agotó sus reintentos (outbox).
    for (const f of filasFallos) {
      const texto = f.tipo === TIPO_ERROR_WORKFLOW
        ? `falló ${f.workflow ? `el workflow ${f.workflow}` : "un workflow"} de n8n${f.nodo ? ` (nodo ${f.nodo})` : ""}`
        : `falló un aviso a n8n: ${f.mensaje}`;
      movimientos.push({ tipo: "sistema", subtipo: "fallo", fecha: f.fecha, usuario_id: null, usuario_nombre: null, empresa_id: null, empresa_nombre: null, entidad: { tipo: "proceso_fallido", id: f.id }, workflow: f.workflow, nodo: f.nodo, texto });
    }
    for (const f of filasReintentos) {
      movimientos.push({ tipo: "sistema", subtipo: "reintento_ok", fecha: f.fecha, usuario_id: null, usuario_nombre: null, empresa_id: null, empresa_nombre: null, entidad: { tipo: "evento", id: f.id }, texto: `un aviso a n8n (${f.tipo}) llegó bien al intento ${f.intentos}` });
    }

    for (const f of filasDocs) {
      const subtipo = { subir: "subido", nueva_version: "nueva_version", aprobar: "aprobado", rechazar: "rechazado", revisar: "aprobado" }[f.accion] ?? f.accion;
      const texto = {
        subido: `subió “${f.nombre}” — queda por revisar`,
        nueva_version: `subió una versión nueva de “${f.nombre}”`,
        aprobado: `aprobó “${f.nombre}”`,
        rechazado: `rechazó “${f.nombre}”`
      }[subtipo] ?? `${f.accion} “${f.nombre}”`;
      movimientos.push({ tipo: "documentos", subtipo, fecha: f.fecha, usuario_id: f.usuarioId, usuario_nombre: nombre(f.usuarioId), empresa_id: f.empresaId, empresa_nombre: f.empresaNombre, entidad: { tipo: "documento", id: f.documentoId }, texto });
    }

    // Venció sin cerrarse: ya pasó su fecha límite y no se cerró antes.
    const vencidas = filasVencian.filter((t) => t.fechaLimite && t.fechaLimite.getTime() < ahora && (t.cerradaEn === null || t.cerradaEn > t.fechaLimite));
    for (const t of vencidas) {
      movimientos.push({ tipo: "tareas", subtipo: "vencida", fecha: t.fechaLimite!, usuario_id: null, usuario_nombre: null, responsable_id: t.responsableId, responsable_nombre: t.responsableNombre, empresa_id: t.empresaId, empresa_nombre: t.empresaNombre, entidad: { tipo: "tarea", id: t.id }, texto: `“${t.titulo}” venció sin cerrarse` });
    }

    for (const f of filasBajas) {
      movimientos.push({ tipo: "bajas", subtipo: "baja", fecha: f.fecha, usuario_id: null, usuario_nombre: null, contacto_nombre: f.contactoNombre, empresa_id: f.empresaId, empresa_nombre: f.empresaNombre, entidad: { tipo: "contacto", id: f.contactoId }, texto: `${f.contactoNombre} pidió su baja${f.motivo === "link" ? " desde el link del correo" : ""}; ya no se le escribe` });
    }

    // Los correos van por lote: campaña + número de contacto + hora de México
    // ("Salieron 18 correos de la campaña X (2º recordatorio)").
    const lotes = new Map<string, { fecha: Date; cantidad: number; campanaId: number | null; campanaNombre: string | null; numeroContacto: number }>();
    for (const e of filasEnvios) {
      const clave = `${e.campanaId ?? "-"}|${e.numeroContacto}|${horaMx(e.fecha).slice(0, 2)}`;
      const lote = lotes.get(clave);
      if (lote) {
        lote.cantidad++;
        if (e.fecha > lote.fecha) lote.fecha = e.fecha;
      } else {
        lotes.set(clave, { fecha: e.fecha, cantidad: 1, campanaId: e.campanaId, campanaNombre: e.campanaNombre, numeroContacto: e.numeroContacto });
      }
    }
    for (const l of lotes.values()) {
      movimientos.push({
        tipo: "correos", subtipo: "lote", fecha: l.fecha, usuario_id: null, usuario_nombre: null, empresa_id: null, empresa_nombre: null,
        entidad: l.campanaId ? { tipo: "campana", id: l.campanaId } : null,
        cantidad: l.cantidad, numero_contacto: l.numeroContacto, campana_id: l.campanaId, campana_nombre: l.campanaNombre,
        texto: `salieron ${l.cantidad} ${l.cantidad === 1 ? "correo" : "correos"}${l.campanaNombre ? ` de la campaña ${l.campanaNombre}` : ""} (${NUMERO_CONTACTO[l.numeroContacto] ?? `contacto ${l.numeroContacto}`})`
      });
    }

    for (const f of filasRespuestas) {
      movimientos.push({ tipo: "respuestas", subtipo: "respuesta", fecha: f.fecha, usuario_id: null, usuario_nombre: null, contacto_nombre: f.contactoNombre, clasificacion: f.clasificacion, estado: f.estado, empresa_id: f.empresaId, empresa_nombre: f.empresaNombre, entidad: { tipo: "respuesta", id: f.id }, texto: `${f.contactoNombre} respondió${f.clasificacion ? ` — ${f.clasificacion.replace("_", " ")}` : " — falta clasificar"}` });
    }

    for (const f of filasCreadas) {
      const para = f.responsableNombre ? ` para ${f.responsableNombre}` : " (sin asignar)";
      movimientos.push({ tipo: "tareas", subtipo: "creada", fecha: f.fecha, usuario_id: f.creadaPor, usuario_nombre: nombre(f.creadaPor), responsable_id: f.responsableId, empresa_id: f.empresaId, empresa_nombre: f.empresaNombre, entidad: { tipo: "tarea", id: f.id }, texto: `${f.creadaPor ? "creó" : "se creó"} “${f.titulo}”${para}` });
    }

    const deLaPersona = usuarioId
      ? movimientos.filter((m) => m.usuario_id === usuarioId || (m.subtipo === "vencida" && m.responsable_id === usuarioId))
      : movimientos;
    deLaPersona.sort((x, y) => y.fecha.getTime() - x.fecha.getTime());

    // Por persona: primera y última ACCIÓN (una tarea que se le venció no es
    // algo que hizo), tareas que cerró, tomadas y vencidas.
    // tareas_que_cerro cuenta QUIÉN CERRÓ (la auditoría), no de quién era la
    // tarea: si el admin cierra una tarea de Ana, cuenta para el admin. Es
    // otra cosa que resumen.tareas_cerradas.cerradas (ver abajo), y por eso
    // se llama distinto.
    const personas = new Map<number, { usuario_id: number; nombre: string | null; primera_accion: Date | null; ultima_accion: Date | null; tareas_que_cerro: number; tomadas: number; vencidas: number }>();
    const persona = (id: number, nombreUsuario: string | null) => {
      let p = personas.get(id);
      if (!p) personas.set(id, (p = { usuario_id: id, nombre: nombreUsuario, primera_accion: null, ultima_accion: null, tareas_que_cerro: 0, tomadas: 0, vencidas: 0 }));
      return p;
    };
    for (const m of deLaPersona) {
      if (m.subtipo === "vencida") {
        if (m.responsable_id) persona(m.responsable_id, (m.responsable_nombre as string | null) ?? null).vencidas++;
        continue;
      }
      if (!m.usuario_id) continue;
      const p = persona(m.usuario_id, m.usuario_nombre);
      if (!p.primera_accion || m.fecha < p.primera_accion) p.primera_accion = m.fecha;
      if (!p.ultima_accion || m.fecha > p.ultima_accion) p.ultima_accion = m.fecha;
      if (m.tipo === "tareas" && m.subtipo === "cerrada") p.tareas_que_cerro++;
      if (m.subtipo === "tomada") p.tomadas++;
    }

    // Quedó pendiente: vencía ese día y al terminar el día seguía sin cerrar.
    const quedoPendiente = filasVencian
      .filter((t) => t.fechaLimite && t.fechaLimite.getTime() < ahora && (TAREA_ABIERTA.includes(t.estado as (typeof TAREA_ABIERTA)[number]) || (t.cerradaEn !== null && t.cerradaEn.getTime() >= finDelDia)))
      .map((t) => ({ tarea_id: t.id, titulo: t.titulo, estado: t.estado, fecha_limite: t.fechaLimite, responsable_id: t.responsableId, responsable_nombre: t.responsableNombre, empresa_id: t.empresaId, empresa_nombre: t.empresaNombre }));

    const creadas = usuarioId ? filasCreadas.filter((t) => t.creadaPor === usuarioId) : filasCreadas;
    const ultimoEnvio = filasEnvios.reduce<Date | null>((max, e) => (!max || e.fecha > max ? e.fecha : max), null);
    const ultimaBaja = [...filasBajas].sort((x, y) => y.fecha.getTime() - x.fecha.getTime())[0];

    return {
      movimientos: deLaPersona,
      resumen: {
        correos: usuarioId ? null : { enviados: filasEnvios.length, campanas: new Set(filasEnvios.map((e) => e.campanaId).filter((id) => id !== null)).size, ultimo_en: ultimoEnvio },
        respuestas: usuarioId ? null : { recibidas: filasRespuestas.length, interesados: filasRespuestas.filter((r) => r.clasificacion === "interesado").length },
        // Cuenta por RESPONSABLE: tareas cerradas ese día; con persona, las
        // que son de esa persona, las haya cerrado ella u otro. Junto a
        // vencian_ese_dia da "7 de 9 que vencían hoy". Quién cerró cada una
        // está en por_persona[].tareas_que_cerro.
        tareas_cerradas: { cerradas: Number(cerradas?.n ?? 0), vencian_ese_dia: filasVencian.length },
        tareas_creadas: { creadas: creadas.length, por_automatizacion: creadas.filter((t) => t.creadaPor === null).length },
        bajas: usuarioId ? null : { total: filasBajas.length, ultima: ultimaBaja ? { contacto_nombre: ultimaBaja.contactoNombre, fecha: ultimaBaja.fecha } : null }
      },
      paraRevisar: { vencidas_sin_cerrar: quedoPendiente.length, avisos_fallidos: usuarioId ? null : filasFallos.length },
      porPersona: [...personas.values()].sort((x, y) => (y.ultima_accion?.getTime() ?? 0) - (x.ultima_accion?.getTime() ?? 0)),
      automatizacion: usuarioId ? null : { correos: filasEnvios.length, tareas_creadas: filasCreadas.filter((t) => t.creadaPor === null).length },
      quedoPendiente
    };
  }
}

function quienSinUsuario(m: MovimientoDia): string {
  if (m.tipo === "sistema") return "Sistema";
  if (m.tipo === "respuestas" || m.tipo === "bajas") return String(m.contacto_nombre ?? "");
  if (m.subtipo === "vencida") return String(m.responsable_nombre ?? "Sin asignar");
  return "Automatización";
}
