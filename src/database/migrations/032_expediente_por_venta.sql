-- Papeles obligatorios del expediente, por venta (16-oct-2026).
--
-- Carlos ya dio la lista: cotización, comprobante de pago y comprobante de
-- recibido o guía de paquetería en cada venta (oportunidad), y la constancia
-- de situación fiscal cuando la venta lleva factura. La constancia es de la
-- empresa: una aprobada sirve para todas sus ventas. Los demás tipos se
-- quedan como opcionales. Decisiones en docs/planes (plan del 16-oct).
--
-- alcance: 'venta' = el papel se busca entre los documentos de esa
-- oportunidad; 'empresa' = entre todos los de la empresa. Los tipos de
-- antes quedan en 'empresa' (se suben en la ficha, sin oportunidad).
-- solo_con_factura: el papel solo se pide si la venta lleva factura.
ALTER TABLE catalogo_tipo_documento
  ADD COLUMN alcance ENUM('venta', 'empresa') NOT NULL DEFAULT 'empresa',
  ADD COLUMN solo_con_factura BOOLEAN NOT NULL DEFAULT FALSE;

-- statement-break

INSERT INTO catalogo_tipo_documento (clave, nombre, obligatorio, alcance, solo_con_factura) VALUES
  ('cotizacion', 'Cotización', TRUE, 'venta', FALSE),
  ('comprobante_pago', 'Comprobante de pago', TRUE, 'venta', FALSE),
  ('comprobante_recibido', 'Comprobante de recibido o guía de paquetería', TRUE, 'venta', FALSE),
  ('constancia_situacion_fiscal', 'Constancia de situación fiscal', TRUE, 'empresa', TRUE);

-- statement-break

-- Casilla "Lleva factura" de cada venta: si está marcada, su expediente pide
-- la constancia de situación fiscal.
ALTER TABLE oportunidades
  ADD COLUMN lleva_factura BOOLEAN NOT NULL DEFAULT FALSE;
