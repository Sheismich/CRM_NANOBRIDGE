-- Responder por correo: elegir a quién va y mandar con copia (Fabián,
-- 18-nov-2026). Cuando el cliente pasa la plática a otra persona de la misma
-- empresa, el vendedor elige el Para entre los contactos de la empresa y
-- puede poner a otros en copia.
--
-- - para: sigue siendo el correo al que fue (el de Para).
-- - contacto_id: el contacto de ese correo. NULL en las filas de antes de
--   esta migración (eran siempre el contacto del prospecto que contestó).
-- - copia: arreglo JSON con los correos que fueron en copia ([] si ninguno;
--   NULL en las filas de antes).
ALTER TABLE correos_respuesta
  ADD COLUMN contacto_id BIGINT UNSIGNED NULL AFTER usuario_id,
  ADD COLUMN copia JSON NULL AFTER para;
