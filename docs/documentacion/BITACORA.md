# Bitácora del proyecto — CRM NANOBRIDGE

Proyecto naranja (outbound) · Documentación y entregables · Corte al 3 de noviembre de 2026 · Semana 10 del programa (revisión G4)

## Cómo leer esta bitácora

Junta en un solo lugar lo que pide el programa de 16 semanas, lo que ya existe y lo que falta documentar. Sirve también como el expediente y la bitácora que pide el programa para medir la trazabilidad (KPI C3): cada entregable con su versión, quién lo hizo, dónde está y qué decidió Dirección.

- Sección 1: dónde estamos, en pocas líneas.
- Sección 2: avance semana por semana contra el programa.
- Sección 3: expediente de entregables (OB-01 a OB-07 y los documentos de apoyo).
- Sección 4: la documentación que falta, con responsable y fecha.
- Sección 5: control de cambios (el programa exige registrar los cambios de reglas, alcance o fechas).
- Sección 6: registro cronológico de lo que se ha hecho, con su evidencia en el repositorio.
- Sección 7: decisiones y riesgos abiertos.

"Datos" es el trabajo de datos y estandarización (T1 en el programa) y "Automatización" es el de n8n y el modelo (T2). El equipo es uno solo; las etiquetas solo siguen los nombres del programa. Las casillas "Por registrar" son decisiones de Dirección que no están escritas en el repositorio y hay que anotar cuando se tengan.

## 1. Dónde estamos

- Estamos en la semana 10 de 16: revisión G4 (CDR). El equipo trabaja contra el cierre del 9 de diciembre; el PDF del programa marca G6 del 14 al 18 de diciembre. Falta que Dirección confirme por escrito el 9 de diciembre.
- El sistema está construido y funcionando en modo de pruebas: 326 cambios guardados (234 de Fabián, 91 de Daniela, 1 inicial), 13 pantallas y 807 pruebas automáticas (777 del servidor y 30 de las pantallas). En la corrida del 3-nov pasaron 805; las 2 que fallaron se revisan en §7.
- En producción desde el 3-nov: servidor `00044-5fh` y pantallas en Firebase, con el aviso y la fusión de empresas repetidas (G-01 y G-05).
- Datos: listos para G4. Hay diccionario, reporte de controles, auditoría de calidad (línea base sobre datos de ejemplo), procedimiento de auditoría y manual de datos.
- Automatización: el sistema funciona. Desde el 3-nov Daniela se encarga de toda la documentación, también la de automatización. El 3-nov quedaron el flujo de actualización (OB-03) y la evaluación del modelo (OB-04 v1.0, con la fórmula, el modelo y el prompt que confirmó Fabián; los resultados sobre muestra salen del piloto). El flujo de campaña (OB-05, para G5) está en borrador v0.5: se completa con la lista de Carlos.
- Lo que sigue: cargar la lista real de Carlos (semana 12), certificar la audiencia (G5, 23 al 27 de nov), pedir autorización escrita de Dirección y correr el piloto (30 nov al 4 dic).

## 2. Avance semana por semana

Estado: Hecho = existe lo que pedía el programa. Parcial = el trabajo está hecho pero falta el documento o una parte. Falta = no se encontró. Por confirmar = no se puede saber desde el repositorio. Pendiente = todavía no toca.

| Sem. | Fechas | Fase o gate | Qué pedía el programa | Qué hay (evidencia) | Estado |
|---|---|---|---|---|---|
| 1 | 31 ago – 4 sep | Arranque | Datos: inventario de fuentes y campos, mapa de datos. Automatización: inventario de accesos, flujo actual y casos de uso. | Los planes definitivos (CRM, API, n8n, matrices) están en docs/planes. El repositorio empieza el 9-sep, así que no hay documento fechado de esta semana. | Por confirmar |
| 2 | 7 – 11 sep | G1 | OB-01 v1: diccionario, clave de unicidad, campos obligatorios y reglas de deduplicación. | Las reglas de duplicados están en el plan del CRM (módulo 3) y el esquema en la migración 001. El diccionario como documento no existía. | Parcial |
| 3 | 14 – 18 sep | Esquema y staging | Esquema de carga, staging y base maestra; pruebas de duplicados; arquitectura de automatización, registro y reversión. | S3_ESQUEMA_PROSPECTOS_Y_PLAN_PRUEBAS (14 y 15-sep); tabla borradores_captura; primera suite de pruebas (15-sep, 2ed796c). | Hecho |
| 4 | 21 – 25 sep | G2 · Concepto | OB-02 v0.1 y diseño de automatización. | Documento de la revisión G2 (Semana4_Concepto_G2_NANOBRIDGE.docx, en Word, fuera del repositorio); PLAN_N8N con B4 y ramas probadas (23-sep). | Hecho |
| 5 | 28 sep – 2 oct | Carga inicial | Carga inicial controlada, validar formatos, faltantes, fuentes y duplicados. ENT: reporte de carga y prueba técnica inicial. | Importación CSV probada con la lista STEELSAFE (29 de 30) y en navegador (28-sep, 1-oct); endurecimiento de la importación (2-oct, 0b1480f). No hay un "reporte de carga" aparte. | Parcial |
| 6 | 5 – 9 oct | Procedimiento de duplicados | Controles de validez y resolución de duplicados; automatizar alta y actualización en staging con registro y reversión. ENT: OB-03 v0.5 y pruebas. | Regla "el correo manda" (2-oct, 7ddf33a), bajas por persona, cotizaciones al centavo (5-oct), pruebas automáticas. No hay documento OB-03 v0.5. | Parcial |
| 7 | 12 – 16 oct | G3 · PDR | Demostrar base controlada y reporte de calidad; demostrar el flujo y la red con datos de prueba, con métrica y límites. ENT: paquete PDR. | Rediseño del servidor y del front (12 al 15-oct); botón "Mandar a automatización" probado en vivo (16-oct). No hay paquete PDR ni métrica del modelo aprobada por escrito en el repositorio. | Por confirmar |
| 8 | 19 – 23 oct | Normalizar y campaña en prueba | Normalizar la base y documentar excepciones; flujo de campaña en modo de prueba. ENT: base v0.8 y flujo sin envío externo. | PT4 publicado y correos editables desde Administración (19-oct); IA en modo sugerencia; MODO_PRUEBAS activo. No hay un documento "base v0.8". | Parcial |
| 9 | 26 – 30 oct | Validación | Auditar muestra, controles y duplicados. Evaluar la red con la métrica aprobada. ENT: reporte de calidad y evaluación del modelo. | Auditoría de calidad del 28-oct: es la línea base del método, corrida sobre datos de ejemplo (toda la base actual lo es). Sus porcentajes (T1.1 y T1.2 en 96.6 % sin los marcados de prueba) no miden la base real: la medición válida es la que se corra después de cargar la lista de Carlos (semana 12). Reporte de la lista de Carlos. No se encontró la evaluación del modelo. | Parcial |
| 10 | 2 – 6 nov | G4 · CDR | Datos: base v1, diccionario y reporte de controles. Automatización: prototipo integrado v1, evaluación y flujo de campaña controlado (OB-02/03/04/05). | Diccionario v1.0, reporte de controles v1.0 (37 controles), auditoría, procedimiento, manual de datos y resumen de pruebas. Además, dos controles propuestos ya en producción (G-01 y G-05, 3-nov). Flujo de actualización (OB-03, 3-nov) y evaluación del modelo (OB-04 v1.0, 3-nov). Falta el flujo de campaña (OB-05, es de G5). | Datos: Hecho · Automatización: Parcial |
| 11 | 9 – 13 nov | Preparación | Datos: procedimiento periódico de auditoría. Automatización: robustecer registros, reintentos, exclusiones y fallas. ENT: procedimiento operativo y pruebas de excepción. | Procedimiento de auditoría ya hecho (28-oct); feriados de la LFT en producción (29-oct); reintentos y fallas con pruebas. Falta cerrar B3 y N8N_WEBHOOK_URL y documentar las pruebas de excepción. | Parcial |
| 12 | 16 – 20 nov | Prepiloto | Datos: congelar la audiencia de prueba y validar exclusiones. Automatización: piloto interno sin envíos externos. ENT: evidencia de prepiloto y lista de ajustes. | Falta pedir a Carlos el tamaño de empresa, limpiar los datos de prueba (el script ya existe) y cargar la lista real. | Pendiente |
| 13 | 23 – 27 nov | G5 · Autorizar el piloto | Certificar audiencia y exclusiones; presentar plantilla, límites, registros y plan de monitoreo. ENT: OB-05 listo para decisión. Sin aprobación escrita no hay ejecución externa. | La cuenta de SendGrid vence el 24-nov y hay que pagarla antes. | Pendiente |
| 14 | 30 nov – 4 dic | Ejecución | Monitorear la integridad de la base; campaña limitada autorizada. ENT: OB-06 v0.8, reporte factual del piloto. | Auditoría diaria durante el piloto (procedimiento de auditoría). | Pendiente |
| 15 | 7 – 11 dic | Corrección | Corregir datos y reglas; ajustar solo con evidencia. ENT: OB-02/03/04/06 finales candidatos; inventario de entregables, pendientes y lecciones. | — | Pendiente |
| 16 | 14 – 18 dic | G6 · Cierre | Datos: base, diccionario, controles y manual de datos. Automatización: automatización, red, manual, campaña y bitácoras. ENT: OB-07 y transferencia operativa. | — | Pendiente |

## 3. Expediente de entregables

| Código | Entregable | Versión | Fecha | Dónde está | Dueño | Estado |
|---|---|---|---|---|---|---|
| OB-01 | Diccionario y reglas | v1.0 | 28-oct-2026 | docs/documentacion/DICCIONARIO_DE_DATOS.md (se regenera con generar-diccionario.mjs). Versión en Word: Diccionario_de_datos_v1_NANOBRIDGE.docx | Daniela | Listo para G4 |
| OB-02 | Base maestra controlada | v0.1 · v1.0 | 25-sep · 28-oct | Esquema y plan de pruebas (S3_ESQUEMA…, 14-sep); documento G2 (25-sep); REPORTE_DE_CONTROLES.md (28-oct; el 29-oct se marcan como hechos G-01 y G-05, que estaban propuestos fuera de este corte); auditoría calidad-2026-10-28; reporte de calidad de la lista de Carlos (Word, 28-oct) | Daniela | Listo para G4 |
| OB-03 | Flujo de actualización | v1.0 | 3-nov-2026 | docs/documentacion/FLUJO_DE_ACTUALIZACION.md: alta, cambio, rechazo, registro, reversión, fallas y las pruebas de cada caso. Se apoya en PLAN_N8N_DEFINITIVO.md y en el código | Daniela (con los flujos de Fabián) | Listo para G4 |
| OB-04 | Red neuronal evaluada | v1.0 | 3-nov-2026 | docs/documentacion/EVALUACION_DEL_MODELO.md: los 4 usos de Gemini con su modelo, datos que recibe, revisión humana, fórmula del score, 5 métricas (en G3 no se aprobó ninguna), pruebas hechas y plan para medir en el piloto. Prompt y fórmula de PT1 en docs/n8n/pt1-scoring/ | Daniela (con los datos de Fabián) | Listo para G4; resultados sobre muestra en el piloto |
| OB-05 | Flujo de campaña | v0.5 | 3-nov-2026 | docs/documentacion/FLUJO_DE_CAMPANA.md: las 11 decisiones que se piden en G5, audiencia, mensaje, límites, exclusiones, registros y vigilancia, modo de prueba, lista de encendido y cómo se detiene | Daniela (con los flujos de Fabián) | Borrador; v1.0 con la audiencia certificada (semana 12) |
| OB-06 | Piloto y reporte | — | — | Se genera entre el 30 de nov y el 11 de dic | Fabián y Daniela | Pendiente |
| OB-07 | Paquete final y transferencia | — | — | Se arma en la semana 16, con el inventario de la semana 15 | Equipo | Pendiente |
| Apoyo | Procedimiento de auditoría y actualización | v1.0 | 28-oct-2026 | docs/documentacion/PROCEDIMIENTO_AUDITORIA.md | Daniela | Hecho |
| Apoyo | Manual de datos | v1.0 | 28-oct-2026 | docs/documentacion/MANUAL_DE_DATOS.md | Daniela | Hecho |
| Apoyo | Script para borrar los datos de prueba | — | 28-oct-2026 | docs/documentacion/limpiar-datos-prueba.mjs (probado en la base local; en producción se corre el día del encendido) | Daniela | Hecho |
| Apoyo | Resumen de pruebas (807 pruebas) | — | 3-nov-2026 | Resumen_de_pruebas_NANOBRIDGE.docx | Daniela | Hecho |
| Apoyo | RUNBOOK de despliegue, módulos construidos, planes y diseños | varias | sep – nov | docs/RUNBOOK_DEPLOY.md, docs/MODULOS_CONSTRUIDOS.md, docs/planes, docs/diseno | Fabián y Daniela | Vigentes |

Revisión y decisión de Dirección: Por registrar para todos los entregables. El programa pide anotar quién revisó cada uno y qué decidió (aceptado, aceptado con pendientes o devuelto). Conviene anotarlo aquí al cierre de cada revisión.

## 4. Documentación que falta

| # | Documento | Gate | Dueño | Cuándo | Qué lleva |
|---|---|---|---|---|---|
| 1 | Resultados del modelo sobre muestra (OB-04) | OB-06 | Daniela, con los datos de Fabián | 11-dic | El documento v1.0 quedó el 3-nov; faltan los resultados de las 5 métricas, que salen del piloto, y registrar las métricas con Dirección. |
| 2 | Flujo de campaña (OB-05): de v0.5 a v1.0 | G5 | Daniela | Semana 12-13 | Certificación de audiencia, textos aprobados, domicilio, decisiones abiertas del §1 y pruebas en vivo que faltan (§10 del documento). |
| 3 | Confirmación escrita de la fecha de cierre | Ya | Dirección | Esta semana | El equipo trabaja contra el 9 de diciembre; el PDF del programa dice el 18. Que Dirección lo confirme por escrito, porque cambia cuándo vencen los puntos 9 a 13. |
| 4 | Evidencia de prepiloto y lista de ajustes | Semana 12 | Datos y Automatización | 16 al 20 nov | Lista de Carlos limpia y cargada, auditoría después de la carga, piloto interno sin envíos externos y ajustes pendientes. |
| 5 | Certificación de audiencia | G5 | Datos | 23 al 27 nov | Cuántos prospectos de cada campaña recibirían correo y por qué no los demás. Sale de la auditoría de datos después de cargar la lista. |
| 6 | Autorización escrita de Dirección para el piloto | G5 | Dirección | Antes del 30 nov | Audiencia, mensaje, infraestructura y límites aprobados por escrito. El programa dice que sin aprobación escrita no hay ejecución externa. |
| 7 | Monitoreo del piloto | Semana 14 | Datos | 30 nov al 4 dic | Una auditoría por día, anotada en el registro del procedimiento de auditoría. |
| 8 | Reporte del piloto (OB-06) | Semanas 14 y 15 | Daniela, con los datos de Fabián | 4 y 11 dic | Reporte factual: qué se envió, qué respondieron, fallas e incidentes. Sin conclusiones que no estén respaldadas por datos. |
| 9 | Manual operativo de la automatización | G6 | Daniela | Semana 15 | v0.9 adelantada el 4-nov (docs/documentacion/MANUAL_OPERATIVO_AUTOMATIZACION.md). Falta la lista de accesos (con OB-07) y lo que deje el piloto. |
| 10 | Manual para el vendedor | G6 | Daniela | Semana 15 | v0.9 adelantada el 4-nov (docs/documentacion/MANUAL_DEL_VENDEDOR.md). Faltan capturas y lo que entre con la rama de Fabián (escalar interesados, seguimiento de cotizaciones). |
| 11 | Inventario de entregables, pendientes y lecciones aprendidas | Semana 15 | Equipo | 7 al 11 dic | Se arma a partir de esta bitácora. |
| 12 | Reporte final de Datos | G6 | Daniela | Semana 15 o 16 | Esqueleto del 5-nov (docs/documentacion/REPORTE_FINAL_T1.md) con la línea base, los controles, pendientes y transferencia; faltan los números de la semana 12 y del piloto, y las metas del programa para T1.1 a T1.3. |
| 13 | Paquete final y transferencia operativa (OB-07) | G6 | Equipo | Semana 16 | Índice de todo lo anterior, respaldos y quién mantiene cada parte. Los accesos ya están en docs/documentacion/INVENTARIO_DE_ACCESOS.md (v0.9, 4-nov), con 7 pasos para antes del cierre. |
| 14 | Entregables de las semanas 5, 7 y 8 sin documento propio | — | Equipo y Dirección | Esta semana | Reporte de carga, paquete PDR y base v0.8. Confirmar con Dirección si se aceptaron con lo que hay o si piden un documento. |
| 15 | Actas y tablero semanal de compromisos | Continuo | Equipo | Cada semana | Lo pide el KPI C4. La primera es la del G4 (docs/documentacion/actas/2026-11-G4.md, para llenar en la junta); sirve de plantilla para las demás. |

## 5. Control de cambios

El programa pide registrar todo cambio de requisito, fecha, alcance, dato de entrada, criterio de aceptación o autorización, con origen, impacto, responsable, archivos, fecha, decisión de Dirección y versión resultante. Estos son los cambios que ya están escritos en el repositorio; el resto se anota aquí desde hoy.

| Fecha | Qué cambió | Origen | Impacto | Responsable | Evidencia | Decisión de Dirección |
|---|---|---|---|---|---|---|
| 2-oct-2026 | La identidad de una persona se decide por el correo ("el correo manda"); la baja es de la persona y no se deshace. | Revisión de código | Cambia cómo se detectan duplicados y a quién se aplican las bajas. | Fabián | docs y código · 7ddf33a | Por registrar |
| 12-oct-2026 | Por ahora no hay papeles obligatorios en el expediente (decisión de Carlos). | Carlos | El expediente muestra los documentos de la empresa sin lista de faltantes. | Fabián | a04e68e | Carlos |
| 16-oct-2026 | Papeles obligatorios por venta (migración 032). | Fabián | Cada venta ganada puede tener su lista de papeles obligatorios. | Fabián | 20b086d | Por registrar |
| 16-oct-2026 | Los prospectos entran a la automatización con un botón "Mandar a automatización" (opción B) y no desde un Excel que lea n8n. | Equipo | Una sola lista de prospectos; el botón revisa giro, tamaño y correo antes de mandarlos. | Fabián | 6544339 · PLAN_N8N punto 7 | Por registrar |
| 19-oct-2026 | La IA de PT2 se abre a todas las respuestas, en modo sugerencia. | Equipo | Una persona sigue decidiendo la clasificación. | Fabián | b62949e | Aprobado por Dirección (19-oct) |
| 21-oct-2026 | Dirección aprueba la IA en las etapas 3 y 4 (responder y resumir) si el aviso de privacidad lo dice. | Dirección | La IA se enciende en producción con el aviso de privacidad publicado. | Fabián | 7023669 · 9f818d6 | Aprobado por Dirección |
| 22-oct-2026 | La cuenta actual de SendGrid se queda como definitiva. | Equipo | No se migra; falta pagar el plan antes del 24-nov. | Fabián | 513e94b | Por registrar |
| 28-oct-2026 | El equipo toma el 9 de diciembre como cierre real (el PDF del programa marca el 18). | Equipo | Las semanas 15 y 16 se recortan: quedan 2 o 3 días hábiles entre el fin del piloto y el cierre. | Equipo | docs/documentacion/README.md | Por registrar |
| 29-oct-2026 | Los días hábiles consideran los feriados de la ley federal del trabajo. | Fabián | Cambia cuándo vencen las ventanas de espera y salen los recordatorios; ya no hay que apagar PT1 y PT4 a mano el 16-nov. | Fabián | 8309bb5 · en producción el 29-oct (00043-w4k) | Por registrar |
| 29-oct-2026 | Aviso de empresas con el mismo nombre al importar y dar de alta, y fusión de empresas repetidas desde la ficha, solo administrador (controles G-01 y G-05). | Hallazgo del diccionario (§8, punto 1) | Menos empresas duplicadas. | Daniela | 4a19c79 · en producción el 3-nov (00044-5fh) | Por registrar |
| 4-nov-2026 | Botón «Dar de baja» en el contacto de la ficha, para las bajas que se piden por teléfono o en persona. Hace lo mismo que el link de baja del correo y no se deshace. | Hueco encontrado al escribir el manual operativo | Ninguna baja se queda sin registrar por no llegar por correo. | Daniela | fe25390 · en producción el 4-nov (00047-hrd) | Por registrar |
| 3-nov-2026 | Métricas del modelo: en G3 no se aprobó ninguna; se adoptan las 5 de OB-04 §4 (acuerdo IA-persona, bajas no vistas, prioridad contra respuesta, disponibilidad y uso del borrador). | Daniela y Fabián | Define cómo se evalúa el modelo en el piloto. | Daniela | EVALUACION_DEL_MODELO.md | Por registrar |
| 3-nov-2026 | El borrador de respuesta con IA quita correos y teléfonos antes de mandar el texto a Gemini (antes le llegaba completo, según P3.7). | Revisión de OB-04 | Menos datos de contacto a Gemini. | Fabián | 17c36e5 · en producción el 3-nov (00045-dfv) | Por registrar |
| 3-nov-2026 | El vendedor puede mandar la cotización por correo desde el CRM, con el PDF adjunto. No cuenta como envío de prospección (no suma al límite de 3 ni lleva link de baja) y la respuesta del cliente le llega directo al vendedor. | Fabián | Alcance nuevo de la etapa comercial. | Fabián | cdeb4aa · migración 038 · en producción el 3-nov (00045-dfv) | Por registrar |
| 3-nov-2026 | Reparto automático de «Contactar prospecto interesado» entre el equipo de ventas: le toca a quien tenga menos abiertos, y quien lo recibe queda como responsable de la empresa. Empieza apagado; se prende en Administración cuando el equipo esté dado de alta. | Fabián (equipo de 2 o 3, lista elegida en Administración) | Los interesados ya no esperan a que un supervisor los reparta, y sus empresas dejan de quedar sin responsable. | Fabián | c8c87ad · en producción el 3-nov (00046-vrm), apagado | Por registrar |
| 29-oct-2026 | «Confirmar todas» en la importación: si la empresa de una fila se llama igual que **una sola** empresa que ya existe (o que creó otra fila del mismo archivo), la persona se agrega a esa empresa; con dos o más, la fila se queda por revisar. Antes cada fila creaba su propia empresa. | Daniela | Un archivo con varias personas de la misma empresa deja una sola empresa. La comparación ignora mayúsculas, acentos y la forma jurídica; un nombre escrito distinto no se reconoce (lo reporta la auditoría). | Daniela | 4a19c79 · test/545-empresas-parecidas | Por registrar |

## 6. Registro cronológico

Hitos del trabajo, con su evidencia. El historial completo está en el repositorio (326 cambios guardados). Se agrega una línea cada vez que se cierra algo importante.

| Fecha | Qué pasó | Quién | Evidencia |
|---|---|---|---|
| 9-sep | Arranca el repositorio con el CRM inicial. | Daniela | e1a425c |
| 10-sep | Módulo de automatización con los 17 endpoints para n8n. | Fabián | babdfab |
| 14-sep | Módulo de prospectos: alta manual e importación CSV por borradores. Flujo de errores (B4). | Daniela y Fabián | 3a1a5e6 · 8bfe304 |
| 15-sep | Plan de pruebas de prospectos, módulos construidos y primera suite de pruebas automáticas. | Daniela y Fabián | 2681698 · 2ed796c |
| 17-sep | Se documenta el despliegue real en Cloud Run y Cloud SQL. | Fabián | 0847ba9 |
| 18-sep | Plan del front para revisión de Dirección. | Daniela | f87386c |
| 22-sep | Idempotencia de avisos hacia n8n; el plan de n8n se corrige tras la sesión de diseño. | Fabián | ace02c3 · 5b77052 |
| 23-sep | Política de contactos por persona (máximo 3); plan de n8n con B4. | Fabián | bd03bb2 · c415099 |
| 24-sep | Se registra la planeación del envío real con SendGrid. | Fabián | d843ebc |
| 28 y 29-sep | Pantallas del front: Prospectos con importación, Reportes, Tareas, Administración, Oportunidades, Contactos, Cotizaciones y Documentos. | Daniela | d4b408f · 32c4889 · 4e253f2 · ad8bdcb · 87598c2 |
| 30-sep | Instructivo para mandar un correo de prueba y enseñar el CRM. | Fabián | 1cde2ff |
| 2-oct | Paquete de seguridad y reglas: el correo manda, protección contra ataques desde otros sitios, importación CSV endurecida, documentos validados por contenido. | Fabián | 7ddf33a · 1c54cd6 · 0b1480f · 8780746 |
| 5-oct | Cotizaciones exactas al centavo; tope diario de correos. | Fabián | 69bed7f · 74502d5 |
| 6-oct | Primera prueba en vivo de PT4 con correos reales a buzones de prueba. | Fabián | PLAN_N8N, pendientes en orden |
| 8-oct | Link de baja visible en el pie del correo y prueba de baja en vivo. | Fabián | 2f56a10 |
| 12-oct | Servidor del rediseño y los diseños de las 10 pantallas. | Fabián | a7fd5ae · 9c9e0af |
| 13-oct | Reparto del front entre Fabián y Daniela. | Fabián | 4f2008a |
| 15-oct | Día del cambio en producción y las 13 pantallas en la vista previa. | Fabián y Daniela | 8b27d60 · d34cc33 |
| 16-oct | Botón "Mandar a automatización" probado en vivo; se actualizan los documentos desactualizados. | Fabián y Daniela | 6544339 |
| 19-oct | PT4 publicado, correos editables desde Administración, IA de PT2 abierta a todas las respuestas. | Fabián | 321247a · b62949e |
| 20 y 21-oct | Etapas 3, 4 y 5: responder al prospecto desde el CRM, resumen con IA y buscador general. | Daniela y Fabián | 204ff4f · d86caf1 · d436d3a |
| 21-oct | IA encendida en producción. | Fabián | 9f818d6 |
| 22-oct | La cuenta de SendGrid queda como definitiva; prospectos de empresas que ya existen. Se quita el logo de los correos de prospección para que no caigan en Promociones de Gmail; no basta. | Fabián | 513e94b · b699b2c · 3f0f2ce |
| 23-oct | Documentos en el Historial de la ficha; pruebas de calificación (scoring), incidencias y prospectos. | Daniela | f8aa751 · b375bd3 |
| 26 y 27-oct | Dependencias con vulnerabilidades actualizadas, accesibilidad, pruebas del front y restauración de respaldo probada. | Daniela | 4dafb6b |
| 28-oct | Documentación de datos: diccionario, reporte de controles, auditoría de calidad, procedimiento de auditoría, manual de datos y script de limpieza. | Daniela | a53e87d · 5266298 |
| 29-oct | Feriados en los días hábiles, ya en producción (00043-w4k); aviso y fusión de empresas repetidas; página de baja con logo. Se prueba un correo de prospección en HTML sencillo contra Promociones y se revierte el mismo día, sin desplegar. | Fabián y Daniela | 8309bb5 · 4a19c79 · 8af7a23 · bd1f13f · 92903f8 |
| 3-nov | Se corren las 807 pruebas (805 pasan). En producción el aviso y la fusión de empresas repetidas: servidor 00044-5fh y pantallas en Firebase. Se arma esta bitácora. Flujo de actualización (OB-03) y evaluación del modelo (OB-04 v1.0) con las respuestas de Fabián. | Daniela | Resumen_de_pruebas_NANOBRIDGE.docx · RUNBOOK (tabla de producción) · 99c7d60 · b3524b9 |
| 3-nov | Mandar la cotización por correo con el PDF adjunto (migración 038) y borrador con IA sin correos ni teléfonos, en producción: servidor 00045-dfv y pantallas en Firebase. | Fabián | cdeb4aa · 17c36e5 · e4ff3b2 |
| 3-nov | Reparto automático de interesados (apagado), «Responder ahora» desde la cola de clasificación y correos marcados como español, en producción: servidor 00046-vrm y pantallas en Firebase. Flujo de campaña (OB-05 v0.5). | Fabián y Daniela | c8c87ad · c9af079 · cdf293e · 8670b5e |
| 4-nov | Paquete para la revisión G4 (resumen y acta), manual operativo de la automatización (v0.9), botón «Dar de baja» desde la ficha y GitHub Actions (pruebas en cada push). En producción: servidor 00047-hrd y pantallas en Firebase. | Daniela | 8128b86 · b86e45a · fe25390 · 8c529d7 · 552d68a |
| 4-nov | Revisión de seguridad: sin credenciales en los 370 commits del historial ni archivos con datos de clientes; bucket de documentos sin acceso público, Cloud SQL sin IPs autorizadas y solo cifrado, encabezados de seguridad completos en el sitio, rutas con sesión y sin CORS abierto; npm audit sin vulnerabilidades altas. GitHub Actions en solo lectura. Queda: el repo es público y trae los Gmail de prueba de Fabián y los correos de las cuentas de pasante. | Daniela | e74da81 |

## 7. Decisiones y riesgos abiertos

| Tema | Qué pasa | Quién decide |
|---|---|---|
| Fecha de cierre | El equipo trabaja contra el 9 de diciembre; el PDF del programa dice el 18. Falta la confirmación escrita de Dirección. | Dirección |
| Cuenta de SendGrid | Vence el 24-nov. Carlos confirmó el 4-nov que se paga el plan; falta hacerlo antes del 24-nov y confirmar que incluye Inbound Parse. | Dirección |
| Correos de prospección en Promociones de Gmail | Desde el molde del 22-oct caen en Promociones. Quitar el logo no bastó y el HTML sencillo se probó y se revirtió el 29-oct. Pega directo en las respuestas del piloto. | Fabián |
| Quién atiende a los interesados | El reparto automático ya está en producción, apagado. Falta dar de alta al equipo de ventas, elegir la lista y prenderlo antes del piloto (OB-05, decisión 11). Con eso también se resuelve que las empresas de los interesados tengan responsable. | Dirección y Carlos |
| Tamaño de empresa | La lista de Carlos no lo trae y sin él ninguna empresa entra a la automatización. | Carlos y Daniela |
| Evaluación del modelo | OB-04 v1.0 listo, pero sin resultados sobre muestra: la base es de ejemplo y los resultados saldrán del piloto, con pocos casos. Las 5 métricas no las ha aprobado Dirección. | Dirección |
| Webhook B3 y N8N_WEBHOOK_URL | Sin configurar. Mientras tanto los avisos del outbox esperan sin enviarse. | Fabián |
| Recordatorios fuera del piloto | Con el cierre el 9-dic, solo los correos del 30-nov y del 1-dic alcanzan su primer recordatorio (8 y 9-dic) y ningún segundo recordatorio cae dentro del proyecto. El piloto mide sobre todo la respuesta al primer correo (OB-05 §4). | Dirección |
| Dependencias con avisos moderados (riesgo aceptado, 4-nov) | npm audit: front sin vulnerabilidades; la API tiene 7 moderadas en producción y ninguna alta. uuid (vía Google Cloud Storage) solo falla en v3/v5/v6 con búfer, que el CRM no usa. archiver (zip de «Descargar lote») trae glob y minimatch con fallas al buscar archivos por patrón, que el CRM no usa: solo agrega los documentos uno por uno. Pasar a archiver 8 (versión mayor) después del piloto, con sus pruebas. | Daniela y Fabián |
| Repositorio público | Cualquiera puede leer el código, el RUNBOOK (URLs del servicio y cuentas) y los Gmail de prueba de Fabián. No hay credenciales ni datos de clientes. Conviene hacerlo privado (Settings → General → Danger Zone); Actions sigue funcionando. | Daniela |
| Pruebas en vivo pendientes | Respuesta automática (fuera de oficina), correo sin firma, rebote, responder desde el CRM y «Resumir con IA» con Gemini real. | Fabián y Daniela |
| Primera carga lenta | Con la API dormida, el primero que entra espera de 8 a 9 s. Se quita con `min-instances=1`, que tiene costo. | Fabián o Carlos |
| Correos de área y teléfonos sin código de país | 9 de 25 correos de la lista son de área (info@, ventas@) y los teléfonos no se reconocen con y sin +52. | Carlos y equipo |
| Dos pruebas que fallaban fuera de esta compu | Resuelto el 4-nov con GitHub Actions: la de montos fallaba con Node 22 (el de producción), que escribía «$1.00M» en vez de «$1M», y se corrigió el formato; la del servidor dependía de cuántas tareas dejaban las demás pruebas, y ahora busca solo la suya. | — |
