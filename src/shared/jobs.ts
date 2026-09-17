// Tope compartido por corrida de los jobs de alerta housekeeping
// (DocumentosService.alertarDocumentosPendientes,
// TareasService.alertarTareasSlaVencidas): acota tanto el tiempo del job
// como la ráfaga de eventos que se puede encolar de golpe en
// eventos_pendientes en un solo @Interval -- un backlog más grande se
// alerta en corridas sucesivas, no de una sola vez. Un solo lugar para no
// destonizar los dos jobs si algún día hace falta afinar el valor
// (hallazgo de code-review, 17-sep-2026: estaba duplicado en cada
// servicio).
export const ALERTAS_BATCH_SIZE = 200;
