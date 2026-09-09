# CRM 09 Cierre de alcance comercial

## Propósito

Convertir la solicitud de Carlos Fernando Sánchez García en un alcance implementable para el CRM de Nanobridge. Este documento complementa los módulos ya definidos de prospección, automatización y seguimiento. No sustituye las decisiones técnicas abiertas registradas en `CRM_07_PREGUNTAS_ABIERTAS.md`.

## Conclusión

El CRM debe tener dos capas conectadas:

1. **Prospección y operación**, que ya está ampliamente especificada: captura, validación, deduplicación, scoring, campañas, respuestas, tareas, supresión y automatización n8n.
2. **Gestión comercial**, solicitada por Carlos: cuenta y contactos, bitácora de interacciones, oportunidades en embudo, cotizaciones, documentos y desempeño comercial por agente.

La hoja `Prospeccion_industrial_STEELSAFE_NANO.xlsx` es una fuente de carga inicial, no la interfaz ni la fuente operativa definitiva. Sus 30 prospectos ya contienen datos aprovechables para la primera importación controlada.

## Cobertura de la solicitud de Carlos

| Solicitud | Cobertura actual | Cierre propuesto |
| --- | --- | --- |
| Empresa, región, contactos, puestos, medios y redes | Parcial: el prospecto tiene empresa, región y datos de contacto. | Separar **cuenta** y **contactos** para permitir varios decisores, teléfonos, correos y enlaces sociales por empresa. |
| Historial de correo, WhatsApp y llamadas | Parcial: existen envíos y respuestas de la automatización. | Crear una bitácora única de **interacciones** manuales y automáticas, con resultado, siguiente acción y responsable. |
| Documentos enviados, comentarios y confirmación de revisión | No cubierto como módulo comercial. | Crear documentos por cuenta, contacto u oportunidad, con tipo, archivo o URL, fecha de envío, estado de revisión y responsable. |
| Negativas de respuesta | Parcial: clasificación y lista de supresión. | Registrar resultado `sin_respuesta`, `no_interesado`, `no_contactar` y su motivo; `no_contactar` debe crear la supresión conforme a la regla legal. |
| Embudo, negociación, cierre o finalización | No cubierto. | Crear **oportunidades** con etapa, monto estimado, probabilidad, fecha estimada de cierre, motivo de pérdida y responsable. |
| Cotizaciones, presupuesto enviado y previsto a cierre | No cubierto. | Crear **cotizaciones** y sus versiones, ligadas a una oportunidad; guardar monto, vigencia, estatus y documento enviado. |
| Actividades y ventas concretadas por agente | Parcial: tareas y dashboard operativo. | Añadir métricas comerciales por agente: actividades, oportunidades creadas, cotizaciones enviadas, ganadas, perdidas y ventas cerradas. |
| Proyección de ingreso | No cubierto. | Calcular pronóstico ponderado por oportunidad: `monto_estimado × probabilidad / 100`, agrupable por agente, etapa y mes de cierre. |
| Reportes por cliente | No cubierto como módulo. | Usar documentos y una vista de cuenta para generar un expediente por cliente: datos, contactos, cronología, oportunidades, cotizaciones, tareas y archivos. |

## Modelo de datos mínimo adicional

Estas entidades se agregan sin reemplazar las tablas de automatización existentes.

### 1. Cuentas y contactos

- `cuentas`: razón social, nombre comercial, industria o giro, región, estado, ciudad, sitio web, LinkedIn, tamaño, fuente, propietario comercial y estado.
- `contactos`: cuenta, nombre, puesto, área, correo, teléfono, WhatsApp, LinkedIn, es_decisor, estado y consentimiento o base legal cuando aplique.
- Cada prospecto actual se migra a una cuenta y al menos un contacto cuando haya nombre o canal disponible. El identificador de importación se conserva para trazabilidad.

### 2. Interacciones

- `interacciones`: cuenta, contacto opcional, oportunidad opcional, agente, fecha y hora, canal (`correo`, `llamada`, `whatsapp`, `reunión`, `otro`), dirección (`saliente`, `entrante`), asunto, resumen, resultado, siguiente paso y fecha de seguimiento.
- Resultado mínimo: `contactado`, `sin_respuesta`, `interesado`, `no_interesado`, `solicita_seguimiento`, `no_contactar`, `reunión_agendada`.
- Toda interacción genera una línea en la cronología del cliente. Las enviadas por n8n también aparecen allí, con origen `automatización`.

### 3. Oportunidades

- `oportunidades`: cuenta, contacto principal, nombre, producto o solución, etapa, monto estimado, probabilidad, fecha estimada de cierre, agente propietario, estatus y motivo de pérdida.
- Etapas iniciales: `nuevo`, `contactado`, `calificado`, `diagnóstico`, `cotización_enviada`, `negociación`, `ganada`, `perdida`, `pausada`.
- `ganada` y `perdida` son terminales. Una oportunidad perdida no elimina la cuenta ni su historial.

### 4. Cotizaciones y documentos

- `cotizaciones`: oportunidad, número o folio, versión, monto, moneda, vigencia, estatus (`borrador`, `enviada`, `aceptada`, `rechazada`, `vencida`), fecha de envío y responsable.
- `documentos`: cuenta, contacto u oportunidad; tipo (`cotización`, `ficha_técnica`, `reporte`, `contrato`, `evidencia`, `otro`), nombre, URL o ruta segura, enviado_por, enviado_en, revisado_en y estado de revisión.
- El archivo se guarda en almacenamiento seguro; la base guarda sus metadatos y referencia. No se recomienda guardar binarios dentro de MySQL.

### 5. Actividades y métricas comerciales

- Las tareas existentes siguen siendo la agenda operativa. Las interacciones son la evidencia de actividad comercial.
- El tablero comercial debe mostrar por periodo y agente: actividades completadas, contactos efectivos, reuniones, oportunidades activas, cotizaciones enviadas, valor del pipeline, pronóstico ponderado, ventas ganadas, ventas perdidas y tasa de conversión.

## Pantallas prioritarias

1. **Vista de cuenta 360**: datos de empresa, contactos, redes, historial cronológico, tareas, oportunidades, cotizaciones y documentos.
2. **Bandeja de actividades**: llamadas, mensajes y seguimientos vencidos o próximos; el agente registra el resultado al completar.
3. **Pipeline de oportunidades**: tablero por etapa, filtros por agente, región, segmento y fecha estimada de cierre.
4. **Cotizaciones**: listado, alta, versión, envío y aceptación o rechazo.
5. **Documentos**: expediente filtrable por cuenta y tipo, con estado de revisión.
6. **Dashboard comercial**: resultados y proyecciones por agente, segmento, región y periodo.

## Reglas de negocio indispensables

- La cuenta no se borra por una oportunidad perdida ni por una respuesta negativa; se conserva la trazabilidad.
- Una solicitud de no contacto crea o actualiza `lista_supresion` y bloquea futuros envíos automáticos.
- Cada venta ganada exige monto final, fecha de cierre y agente responsable.
- Cada venta perdida exige motivo normalizado; esto permite aprender por segmento y propuesta de valor.
- Las métricas de ingreso usan oportunidades `ganada` para ingreso realizado y oportunidades abiertas para pronóstico. No se mezclan.
- Los permisos ya definidos se mantienen: agente opera sus registros y tareas; supervisor ve y reasigna; el rol administrador, aún pendiente de aprobar, administra catálogos y usuarios.
- Los documentos deben tener control de acceso y no exponer datos personales fuera de los permisos del CRM.

## Migración de la base inicial

| Columna de la hoja | Destino CRM |
| --- | --- |
| Empresa, Perfil, Servicios relevantes | Cuenta |
| Región, Estado, Ciudad/cobertura | Cuenta y segmentación |
| Contacto público, Relación/cargo, Rol a solicitar | Contacto |
| Correo público, Teléfono público | Contacto y canales |
| Evidencia altura/corrosión, Caso de uso, Ángulo personalizado | Contexto comercial de cuenta / nota inicial |
| Score, Prioridad, Próximo paso, Estado | Prospecto y tarea inicial |
| Fuentes, confianza y nota de validación | Proveniencia y revisión de calidad |

Antes de la carga se deben normalizar teléfonos, verificar correos, detectar duplicados y respetar la regla vigente de no enviar a registros sin base legal o que requieran revisión humana.

## Orden recomendado para desbloquear el trabajo

### Fase A - Decisiones de arranque

1. Elegir autenticación: Google Workspace SSO es la opción recomendada si todos los usuarios pertenecen a Nanobridge.
2. Aprobar el rol `administrador` y la matriz de permisos.
3. Elegir la integración n8n Cloud -> CRM: la arquitectura API First ya documentada evita exponer la base directamente.
4. Confirmar las reglas de duplicado, reingreso a automatización y calendario de días hábiles que siguen abiertas en `CRM_07`.

### Fase B - MVP operativo

1. Login, roles, cuentas, contactos y carga inicial de los 30 prospectos.
2. Vista de cuenta, historial de interacciones y tareas.
3. Pipeline y oportunidades con monto, probabilidad y fecha de cierre.
4. Dashboard comercial básico: pipeline, pronóstico y cierres por agente.

### Fase C - Integración y control

1. Outbox de eventos y webhooks de reingreso a n8n.
2. Campañas, respuestas automáticas y cronología unificada.
3. Cotizaciones, documentos y confirmación de revisión.
4. Auditoría, respaldos, supresión y métricas de operación y comercialización.

## Decisiones que deben aprobarse con Carlos o dirección

| Decisión | Recomendación inicial |
| --- | --- |
| Unidad del cliente | Cuenta como empresa y múltiples contactos asociados. |
| Propiedad comercial | Una oportunidad tiene un agente propietario; el supervisor puede reasignarla con bitácora. |
| Etapas del embudo | Usar las nueve etapas propuestas y revisarlas después del piloto. |
| Probabilidades | Configurables por etapa, con posibilidad de ajuste manual justificado por oportunidad. |
| Cotización | Permitir versiones; solo la última enviada puede marcarse como aceptada o rechazada. |
| Documentos | Guardar archivos en almacenamiento seguro y referencias en CRM. |
| Cierre | Una oportunidad ganada debe reflejar monto final y fecha; la proyección no se contabiliza como venta. |
| Reporte por cliente | Expedirlo desde la vista Cuenta 360, no como una tabla aislada. |

## Resultado esperado del MVP

Un asesor abre una cuenta, ve quién es la empresa y a quién contactar, registra una llamada o WhatsApp, crea una oportunidad, programa el siguiente seguimiento, adjunta o enlaza una cotización y actualiza el resultado. La dirección puede ver el pipeline, el ingreso esperado y las ventas cerradas por agente sin perder la trazabilidad de la automatización ni de las negativas de contacto.
