-- Cierra el hueco de idempotencia hacia n8n (B3) encontrado en code review
-- (14-sep-2026, ver outbox-dispatcher.service.ts): si la entrega a n8n tiene
-- éxito pero el UPDATE que marca el evento 'enviado' falla, el evento se
-- reintenta y se reenvía duplicado, porque el payload no llevaba ningún
-- campo que n8n pudiera usar para deduplicar del otro lado.
--
-- Se llama evento_uuid (no evento_id) a propósito: procesos_fallidos ya
-- tiene una columna evento_id (FK BIGINT hacia eventos_pendientes.id, un
-- significado totalmente distinto) -- dos evento_id con tipos y
-- significados distintos en tablas relacionadas hubiera sido una fuente de
-- confusión.
--
-- NULL primero + backfill + NOT NULL UNIQUE después (en vez de agregar la
-- columna ya NOT NULL UNIQUE) para que la migración no truene si la tabla
-- ya tiene filas en producción; si está vacía el backfill simplemente no
-- afecta ninguna fila.
ALTER TABLE eventos_pendientes
  ADD COLUMN evento_uuid CHAR(36) NULL AFTER id;

-- statement-break
UPDATE eventos_pendientes SET evento_uuid = UUID() WHERE evento_uuid IS NULL;

-- statement-break
ALTER TABLE eventos_pendientes
  MODIFY COLUMN evento_uuid CHAR(36) NOT NULL,
  ADD CONSTRAINT uq_eventos_pendientes_uuid UNIQUE (evento_uuid);
