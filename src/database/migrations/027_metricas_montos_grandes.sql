-- Métricas diarias con montos más grandes (C3 del plan de fixes,
-- 2-oct-2026). Estas columnas guardan la SUMA de muchas oportunidades, pero
-- eran DECIMAL(12,2), igual que el valor estimado de UNA sola: dos
-- oportunidades grandes desbordaban la suma y el trabajo diario de métricas
-- (PT5) respondía 500 todos los días. DECIMAL(18,2) aguanta la suma de un
-- millón de oportunidades al tope.
ALTER TABLE metricas_comerciales_diarias
  MODIFY valor_pipeline DECIMAL(18, 2) NOT NULL,
  MODIFY ingresos_cerrados DECIMAL(18, 2) NOT NULL,
  MODIFY valor_perdido DECIMAL(18, 2) NOT NULL;
