-- Teléfonos guardados con la lada de México (6-nov-2026).
--
-- normalizePhone() ahora quita el 52 (con o sin "00" y el "1" de los celulares)
-- cuando deja 10 dígitos: "+52 81 1234 5678" = "81 1234 5678". Esto pasa a la
-- forma nueva lo que ya estaba guardado, para que la deduplicación y, sobre
-- todo, la lista de supresión (que nunca se borra) sigan coincidiendo.
--
-- Misma regla que src/shared/normalize.ts, sobre valores que ya son solo
-- dígitos: w = sin el "00" de "0052"; luego 13 dígitos con "521" o 12 con "52"
-- pierden la lada. Las extensiones que ya quedaron pegadas al número no se
-- pueden separar y se quedan como están.
--
-- medios_contacto y lista_supresion tienen UNIQUE (tipo, valor_normalizado): si
-- la forma nueva ya existe (la misma persona capturada de las dos formas), esa
-- fila se queda como está; la auditoría la sigue marcando como posible
-- duplicado. Si dos filas viejas dan la misma forma nueva, solo cambia la de id
-- menor. Sin tablas temporales: CREATE TEMPORARY TABLE ... SELECT puede fallar
-- con GTID (Cloud SQL); la tabla derivada se materializa por el GROUP BY.
UPDATE medios_contacto mc
JOIN (
  SELECT MIN(id) id, nuevo
  FROM (
    SELECT id, tipo, valor_normalizado,
      IF(LENGTH(w) = 13 AND LEFT(w, 3) = '521', SUBSTRING(w, 4), IF(LENGTH(w) = 12 AND LEFT(w, 2) = '52', SUBSTRING(w, 3), w)) nuevo
    FROM (SELECT id, tipo, valor_normalizado, IF(LEFT(valor_normalizado, 4) = '0052', SUBSTRING(valor_normalizado, 3), valor_normalizado) w
          FROM medios_contacto WHERE tipo IN ('telefono', 'whatsapp')) a
  ) m
  WHERE nuevo <> valor_normalizado
    AND NOT EXISTS (SELECT 1 FROM medios_contacto o WHERE o.tipo = m.tipo AND o.valor_normalizado = m.nuevo)
  GROUP BY tipo, nuevo
) t ON t.id = mc.id
SET mc.valor_normalizado = t.nuevo;
-- statement-break
UPDATE lista_supresion ls
JOIN (
  SELECT MIN(id) id, nuevo
  FROM (
    SELECT id, tipo, valor_normalizado,
      IF(LENGTH(w) = 13 AND LEFT(w, 3) = '521', SUBSTRING(w, 4), IF(LENGTH(w) = 12 AND LEFT(w, 2) = '52', SUBSTRING(w, 3), w)) nuevo
    FROM (SELECT id, tipo, valor_normalizado, IF(LEFT(valor_normalizado, 4) = '0052', SUBSTRING(valor_normalizado, 3), valor_normalizado) w
          FROM lista_supresion WHERE tipo IN ('telefono', 'whatsapp')) a
  ) s
  WHERE nuevo <> valor_normalizado
    AND NOT EXISTS (SELECT 1 FROM lista_supresion o WHERE o.tipo = s.tipo AND o.valor_normalizado = s.nuevo)
  GROUP BY tipo, nuevo
) t ON t.id = ls.id
SET ls.valor_normalizado = t.nuevo;
-- statement-break
UPDATE borradores_captura b
JOIN (
  SELECT id, IF(LENGTH(w) = 13 AND LEFT(w, 3) = '521', SUBSTRING(w, 4), IF(LENGTH(w) = 12 AND LEFT(w, 2) = '52', SUBSTRING(w, 3), w)) nuevo
  FROM (SELECT id, IF(LEFT(telefono_normalizado, 4) = '0052', SUBSTRING(telefono_normalizado, 3), telefono_normalizado) w
        FROM borradores_captura WHERE telefono_normalizado LIKE '52%' OR telefono_normalizado LIKE '0052%' GROUP BY id) a
) t ON t.id = b.id
SET b.telefono_normalizado = t.nuevo
WHERE t.nuevo <> b.telefono_normalizado;
