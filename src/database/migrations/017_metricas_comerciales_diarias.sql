-- Job diario de métricas comerciales (PLAN_API_DEFINITIVO.md, "Jobs
-- internos"; PLAN_CRM_DEFINITIVO.md, tabla metricas_comerciales_diarias;
-- MATRICES_Y_BACKLOG_DEFINITIVO.md: "Métricas: job diario interno del
-- backend; el frontend solo consulta resultados"). El plan no detalla las
-- columnas exactas -- se adoptan las mismas que ya calcula en vivo
-- ReportesService.pipelineResumen() (oportunidades abiertas/ganadas/
-- perdidas + sus valores), que es la lectura de "Oportunidades abiertas,
-- ganadas y perdidas / Ingresos cerrados / Valor de pipeline" que pide
-- PLAN_CRM_DEFINITIVO.md #9. `fecha` es PRIMARY KEY (no id autoincrement):
-- a lo más una fila por día, así que el propio dato natural de negocio ya
-- es la llave -- el job hace UPSERT sobre ella cada vez que corre.
CREATE TABLE metricas_comerciales_diarias (
  fecha DATE NOT NULL PRIMARY KEY,
  oportunidades_abiertas INT UNSIGNED NOT NULL,
  valor_pipeline DECIMAL(12, 2) NOT NULL,
  oportunidades_ganadas INT UNSIGNED NOT NULL,
  ingresos_cerrados DECIMAL(12, 2) NOT NULL,
  oportunidades_perdidas INT UNSIGNED NOT NULL,
  valor_perdido DECIMAL(12, 2) NOT NULL,
  calculado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
