-- Últimos dos jobs internos de PLAN_API_DEFINITIVO.md: "Revisión de
-- documentos pendientes" y "Alertas de tareas SLA vencidas". Ninguno de los
-- dos crea una fila propia -- ambos encolan un evento en eventos_pendientes
-- (mismo patrón outbox ya usado por TareasService.cerrar/clasificar) para
-- que n8n decida el canal real de aviso (correo, Slack, etc.), sin que la
-- API tenga que llamarlo directamente.
--
-- alertado_en es NULLABLE y se fija UNA sola vez por fila: evita que el
-- @Interval diario reencole el mismo evento cada día mientras el documento
-- siga sin revisar o la tarea siga vencida. No hace falta "limpiarlo": la
-- condición de la consulta (revisado_en IS NULL / estado no cerrado) deja de
-- cumplirse en cuanto se resuelve, mismo espíritu autocorrectivo que
-- metricas_comerciales_diarias (017_metricas_comerciales_diarias.sql).
ALTER TABLE documentos ADD COLUMN alertado_en DATETIME NULL AFTER revisado_en;

-- statement-break

ALTER TABLE tareas ADD COLUMN alertado_en DATETIME NULL AFTER fecha_limite;

-- statement-break

-- Índices para que el @Interval diario de cada job no haga table scan
-- completo conforme documentos/tareas crecen (hallazgo de code-review,
-- 17-sep-2026): estado+alertado_en cubre los dos predicados de igualdad
-- de alertarDocumentosPendientes (revisado_en/creado_en se filtran sobre
-- el resultado, ya mucho más chico).
ALTER TABLE documentos ADD INDEX idx_documentos_alertado (estado, alertado_en);

-- statement-break

-- fecha_limite es el predicado de rango de alertarTareasSlaVencidas (solo
-- tareas ya vencidas importan); estado/alertado_en se filtran después
-- sobre ese subconjunto, ya mucho más chico que la tabla completa.
ALTER TABLE tareas ADD INDEX idx_tareas_fecha_limite (fecha_limite);
