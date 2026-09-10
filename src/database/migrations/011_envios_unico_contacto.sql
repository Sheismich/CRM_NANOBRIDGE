-- Hallazgo de code review (10-sep-2026): sin este UNIQUE, dos llamadas
-- concurrentes a Registro de envío (execution_id distintos) para el mismo
-- prospecto+canal pueden leer el mismo numero_contacto antes de que
-- cualquiera inserte, insertando dos filas con el mismo numero_contacto y
-- saltándose el máximo de 3 contactos (política de contactos,
-- PLAN_N8N_DEFINITIVO.md). El servicio ahora reintenta ante este
-- duplicado en vez de solo confiar en el chequeo en memoria.
ALTER TABLE envios
  ADD UNIQUE KEY uq_envios_prospecto_canal_numero (prospecto_id, canal, numero_contacto);
