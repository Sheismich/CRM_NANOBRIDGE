-- Correos propios por campaña (9-nov-2026). La empresa corre campañas de
-- servicios distintos (agua, tratamiento de maquinaria) con los mismos
-- contactos, y cada una necesita sus 3 correos. Una campaña sin correo
-- propio para un número usa el general de ese número (campana_id NULL).
--
-- - campana_id NULL = general (las 3 sembradas en la 033 y, si algún día se
--   usan, las de giro).
-- - campana_clave existe solo para el UNIQUE: en MySQL un UNIQUE deja
--   repetir NULL, así que sin ella podría haber dos generales del mismo
--   número. Con IFNULL(campana_id, 0) las generales chocan entre sí.
-- - El FK no lleva ON DELETE: una campaña no se borra, se finaliza.
ALTER TABLE plantillas_correo
  ADD COLUMN campana_id BIGINT UNSIGNED NULL AFTER id,
  ADD COLUMN campana_clave BIGINT UNSIGNED AS (IFNULL(campana_id, 0)) STORED,
  DROP INDEX uq_plantillas_correo_giro_numero,
  ADD UNIQUE KEY uq_plantillas_correo_campana_giro_numero (campana_clave, giro, numero),
  ADD CONSTRAINT fk_plantillas_correo_campana FOREIGN KEY (campana_id) REFERENCES campanas(id);
