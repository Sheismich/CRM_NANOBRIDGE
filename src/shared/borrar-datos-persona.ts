import { eq, sql, type SQL } from "drizzle-orm";
import type { DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, contactos, correosRespuesta, mediosContacto, prospectos, respuestas, tareas } from "../database/schema.js";
import { bloquearPersona, darDeBajaPersona } from "./baja-prospecto.js";
import { suprimirMediosDeContacto } from "./supresion.js";

// Borrar los datos de una persona por solicitud ARCO (pendiente #9 de la revisión
// del 20-nov-2026, decidido por Fabián el 23-nov). Se ANONIMIZA, no se borran
// filas: así no se rompen las ventas, los conteos de envíos ni los reportes, y un
// dato anonimizado ya no es dato personal.
//
// Lo único personal que se queda es su correo y su teléfono en lista_supresion:
// es la lista de exclusión que la ley reconoce; sin ella, si alguien la vuelve a
// importar, se le volvería a escribir. Ventas, cotizaciones y documentos se quedan
// (son de la empresa); solo se quita el nombre de la persona. Fuera del CRM
// (respaldos de 7 días, historial de SendGrid, ejecuciones de n8n) se borra con el
// tiempo y eso se le dice a la persona en la respuesta.
//
// Dónde hay datos de una persona (revisado contra el diccionario 1.4, migración 044):
// contactos, medios_contacto, prospectos (fuente_url, motivo_rebote), envios
// (destinatario, asunto, error), eventos_sendgrid (correo, motivo), respuestas
// (contenido, comentario, motivo_sugerencia, remitente, asunto), correos_respuesta
// (para, copia, asunto, texto), correos_cotizacion (para, asunto, texto), actividades
// (resultado, proxima_accion, comentario), tareas (descripcion, resultado y el título
// si trae su nombre), notificaciones (cuerpo y el título si trae su nombre),
// resultados_scoring (detalle), borradores_captura (fila_original y los datos de la
// persona), incidencias (detalle), eventos_pendientes y procesos_fallidos (payload) y
// auditoria (antes y despues: se redacta el JSON, la fila queda).
export const ACCION_BORRAR_DATOS_ARCO = "borrar_datos_arco";
export const NOMBRE_PERSONA_ELIMINADA = "Persona eliminada";
export const MOTIVO_ARCO = "Datos borrados por solicitud ARCO";
const ELIMINADO = "[eliminado]";

type Afectadas = Record<string, number>;

const escaparLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Corre dentro de la transacción de quien llama. Devuelve cuántas filas tocó en
 * cada tabla (para el registro y para contestarle a la persona). No revisa
 * permisos ni la confirmación: eso lo hace ContactosService.borrarDatos.
 */
export async function borrarDatosPersona(tx: DrizzleTx, contactoId: number, usuarioId: number): Promise<Afectadas> {
  await bloquearPersona(tx, contactoId);
  const afectadas: Afectadas = {};
  const ejecutar = async (tabla: string, consulta: SQL) => {
    const [r] = (await tx.execute(consulta)) as unknown as [{ affectedRows?: number }];
    afectadas[tabla] = (afectadas[tabla] ?? 0) + Number(r?.affectedRows ?? 0);
  };

  const [persona] = await tx.select({ nombre: contactos.nombre }).from(contactos).where(eq(contactos.id, contactoId)).limit(1);
  const nombre = persona?.nombre ?? "";

  // 1. Lo que se queda: la persona en baja y sus medios en la lista de supresión,
  //    con su valor original (antes de anonimizarlos abajo).
  const origen = { motivo: MOTIVO_ARCO, executionId: null, usuarioId };
  await suprimirMediosDeContacto(tx, contactoId, origen);
  await darDeBajaPersona(tx, contactoId, { accion: ACCION_BORRAR_DATOS_ARCO, ...origen });

  // Lo que identifica a la persona en el resto de la base.
  const medios = await tx.select({ id: mediosContacto.id, tipo: mediosContacto.tipo, valor: mediosContacto.valor, valorNormalizado: mediosContacto.valorNormalizado }).from(mediosContacto).where(eq(mediosContacto.contactoId, contactoId));
  const prospectoIds = (await tx.select({ id: prospectos.id }).from(prospectos).where(eq(prospectos.contactoId, contactoId))).map((p) => p.id);
  const respuestaIds = prospectoIds.length
    ? (await tx.select({ id: respuestas.id }).from(respuestas).where(sql`${respuestas.prospectoId} IN (${sql.join(prospectoIds.map((id) => sql`${id}`), sql`, `)})`)).map((r) => r.id)
    : [];
  const enLista = (ids: number[]) => (ids.length ? sql.join(ids.map((id) => sql`${id}`), sql`, `) : sql`NULL`);
  const tareaIds = (await tx.select({ id: tareas.id }).from(tareas).where(sql`${tareas.contactoId} = ${contactoId} OR ${tareas.prospectoId} IN (${enLista(prospectoIds)}) OR ${tareas.respuestaId} IN (${enLista(respuestaIds)})`)).map((t) => t.id);

  const correos = [...new Set(medios.filter((m) => m.tipo === "correo").map((m) => m.valorNormalizado))];
  const telefonos = [...new Set(medios.filter((m) => m.tipo === "telefono" || m.tipo === "whatsapp").map((m) => m.valorNormalizado))];
  // Para buscar en textos libres y JSON: el valor tal como se escribió y normalizado.
  // Menos de 5 caracteres atraparía de más.
  const valores = [...new Set(medios.filter((m) => m.tipo === "correo" || m.tipo === "telefono" || m.tipo === "whatsapp").flatMap((m) => [m.valor, m.valorNormalizado]))].filter((v) => v.length >= 5);
  const contieneAlguno = (columna: SQL) => (valores.length ? sql`(${sql.join(valores.map((v) => sql`CAST(${columna} AS CHAR) LIKE ${`%${escaparLike(v)}%`}`), sql` OR `)})` : sql`FALSE`);
  const traeSuNombre = (columna: SQL) => (nombre.trim().length >= 3 ? sql`${columna} LIKE ${`%${escaparLike(nombre.trim())}%`}` : sql`FALSE`);

  // 2. La persona y sus medios.
  await ejecutar("contactos", sql`UPDATE contactos SET nombre = ${NOMBRE_PERSONA_ELIMINADA}, puesto = NULL, area = NULL, linkedin_url = NULL, facebook_url = NULL, instagram_url = NULL, activo = 0 WHERE id = ${contactoId}`);
  // El valor se reemplaza por uno único (uq_medio_tipo_valor). El bloqueo para volver
  // a escribirle vive en lista_supresion, no aquí.
  await ejecutar("medios_contacto", sql`UPDATE medios_contacto SET valor = CONCAT('eliminado-', id), valor_normalizado = CONCAT('eliminado-', id), estado_contacto = IF(estado_contacto = 'activo', 'obsoleto', estado_contacto) WHERE contacto_id = ${contactoId}`);

  // 3. Su prospección.
  await ejecutar("prospectos", sql`UPDATE prospectos SET fuente_url = NULL, motivo_rebote = NULL WHERE contacto_id = ${contactoId}`);
  await ejecutar("envios", sql`UPDATE envios SET destinatario = NULL, asunto = NULL, error = NULL WHERE prospecto_id IN (${enLista(prospectoIds)})`);
  await ejecutar("eventos_sendgrid", sql`UPDATE eventos_sendgrid SET correo = NULL, motivo = NULL WHERE prospecto_id IN (${enLista(prospectoIds)})${correos.length ? sql` OR correo IN (${sql.join(correos.map((c) => sql`${c}`), sql`, `)})` : sql``}`);
  await ejecutar("respuestas", sql`UPDATE respuestas SET contenido = NULL, comentario = NULL, motivo_sugerencia = NULL, remitente = NULL, asunto = NULL WHERE prospecto_id IN (${enLista(prospectoIds)})`);
  await ejecutar("resultados_scoring", sql`UPDATE resultados_scoring SET detalle = NULL WHERE prospecto_id IN (${enLista(prospectoIds)})`);

  // 4. Lo que el equipo le escribió o anotó de ella.
  await ejecutar("correos_respuesta", sql`UPDATE correos_respuesta SET para = ${ELIMINADO}, asunto = ${ELIMINADO}, texto = ${ELIMINADO}, copia = JSON_ARRAY(), error = NULL WHERE prospecto_id IN (${enLista(prospectoIds)}) OR contacto_id = ${contactoId}`);
  // Si fue en copia de un correo a otra persona de su empresa, solo se quita ella de la copia.
  if (correos.length) {
    const conCopia = await tx.select({ id: correosRespuesta.id, copia: correosRespuesta.copia }).from(correosRespuesta).where(contieneAlguno(sql`${correosRespuesta.copia}`));
    for (const fila of conCopia) {
      const resto = (Array.isArray(fila.copia) ? (fila.copia as string[]) : []).filter((c) => !correos.includes(String(c).trim().toLowerCase()));
      await ejecutar("correos_respuesta", sql`UPDATE correos_respuesta SET copia = ${JSON.stringify(resto)} WHERE id = ${fila.id}`);
    }
  }
  await ejecutar("correos_cotizacion", sql`UPDATE correos_cotizacion SET para = ${ELIMINADO}, asunto = ${ELIMINADO}, texto = ${ELIMINADO}, error = NULL WHERE contacto_id = ${contactoId}`);
  await ejecutar("actividades", sql`UPDATE actividades SET resultado = NULL, proxima_accion = NULL, comentario = NULL WHERE contacto_id = ${contactoId}`);
  await ejecutar("tareas", sql`UPDATE tareas SET descripcion = NULL, resultado = NULL, titulo = IF(${traeSuNombre(sql`titulo`)}, 'Tarea de una persona eliminada', titulo) WHERE id IN (${enLista(tareaIds)})`);
  await ejecutar("notificaciones", sql`UPDATE notificaciones SET cuerpo = NULL, titulo = IF(${traeSuNombre(sql`titulo`)}, 'Aviso de una persona eliminada', titulo)
    WHERE (entidad = 'tarea' AND entidad_id IN (${enLista(tareaIds)})) OR (entidad = 'respuesta' AND entidad_id IN (${enLista(respuestaIds)}))`);

  // 5. El área de carga y los registros técnicos.
  await ejecutar("borradores_captura", sql`UPDATE borradores_captura SET fila_original = JSON_OBJECT('redactado', TRUE), contacto_nombre = NULL, contacto_puesto = NULL,
      correo = NULL, correo_normalizado = NULL, telefono = NULL, telefono_normalizado = NULL, fuente_url = NULL, observaciones = NULL, errores = NULL
    WHERE prospecto_id IN (${enLista(prospectoIds)}) OR match_contacto_id = ${contactoId}
      ${correos.length ? sql`OR correo_normalizado IN (${sql.join(correos.map((c) => sql`${c}`), sql`, `)})` : sql``}
      ${telefonos.length ? sql`OR telefono_normalizado IN (${sql.join(telefonos.map((t) => sql`${t}`), sql`, `)})` : sql``}`);
  await ejecutar("incidencias", sql`UPDATE incidencias SET detalle = NULL WHERE prospecto_id IN (${enLista(prospectoIds)}) OR ${contieneAlguno(sql`detalle`)}`);
  await ejecutar("eventos_pendientes", sql`UPDATE eventos_pendientes SET payload = JSON_OBJECT('redactado', TRUE)
    WHERE (entidad_tipo = 'prospecto' AND entidad_id IN (${enLista(prospectoIds)})) OR (entidad_tipo = 'contacto' AND entidad_id = ${contactoId}) OR ${contieneAlguno(sql`payload`)}`);
  await ejecutar("procesos_fallidos", sql`UPDATE procesos_fallidos SET payload = JSON_OBJECT('redactado', TRUE) WHERE ${contieneAlguno(sql`payload`)}`);

  // 6. La auditoría: la fila queda (quién y cuándo), sus datos no. Se conserva el
  //    estado, que no es personal y explica el Historial.
  const redactar = (col: string) => sql.raw(`${col} = IF(${col} IS NULL, NULL, JSON_OBJECT('estado', JSON_EXTRACT(${col}, '$.estado'), 'redactado', TRUE))`);
  await ejecutar("auditoria", sql`UPDATE auditoria SET ${redactar("antes")}, ${redactar("despues")}
    WHERE (entidad = 'contacto' AND entidad_id = ${contactoId})
       OR (entidad = 'prospecto' AND entidad_id IN (${enLista(prospectoIds)}))
       OR (entidad = 'medio_contacto' AND entidad_id IN (${enLista(medios.map((m) => m.id))}))
       OR (entidad = 'respuesta' AND entidad_id IN (${enLista(respuestaIds)}))
       OR (entidad = 'tarea' AND entidad_id IN (${enLista(tareaIds)}))
       OR ${contieneAlguno(sql`antes`)} OR ${contieneAlguno(sql`despues`)}`);

  // 7. Lo único que queda escrito de esto, sin datos personales.
  await tx.insert(auditoria).values({ usuarioId, entidad: "contacto", entidadId: contactoId, accion: ACCION_BORRAR_DATOS_ARCO, despues: { motivo: MOTIVO_ARCO } });
  return afectadas;
}
