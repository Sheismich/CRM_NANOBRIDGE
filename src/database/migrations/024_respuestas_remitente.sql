-- Quién mandó cada respuesta (A5 del plan de fixes, 2-oct-2026). n8n ya
-- mandaba el remitente (el "From" del correo), pero la API lo tiraba en las
-- respuestas identificadas: si el prospecto reenviaba el correo y contestaba
-- un compañero suyo, nadie podía ver quién escribió realmente. Se guarda tal
-- cual llega (puede traer nombre y dirección); la cola de clasificación lo
-- muestra.
--
-- Columna NULL al final: MySQL 8 la agrega sin reescribir la tabla.
ALTER TABLE respuestas
  ADD COLUMN remitente VARCHAR(320) NULL;
