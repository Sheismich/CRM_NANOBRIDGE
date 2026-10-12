-- Administración del rediseño (12-oct-2026).
--
-- Último acceso por usuario (punto 37): la última vez que la persona usó el
-- CRM (SessionAuthGuard lo pone a lo más una vez cada 5 minutos; el login lo
-- pone de una vez). NULL = nunca ha entrado desde que existe la columna.
-- Columna al final: MySQL 8 la agrega sin reescribir la tabla.
ALTER TABLE usuarios
  ADD COLUMN ultimo_acceso_en DATETIME NULL;

-- statement-break

-- Registro de cambios (punto 53): lista lo más nuevo primero y filtra por
-- rango de fechas; hasta ahora auditoria solo tenía índice por entidad.
CREATE INDEX idx_auditoria_creado ON auditoria (creado_en);
