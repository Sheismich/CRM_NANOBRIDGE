# Flujo de actualización · CRM NANOBRIDGE

**Entregable:** flujo de actualización de la base (OB-03), proyecto naranja · outbound.
**Para:** revisión G4 · CDR (semana 10, 2-6 nov 2026). **Redacta:** T1 · **Revisión:** T2 (dueño de los flujos de n8n) y Dirección General.
**Versión:** 1.1 · 5 de noviembre de 2026 (sin bandeja de salida; envíos confirmados, freno del dominio y tareas nuevas) · API `nanobridge-api-00048-7x5`, base en la migración `040_escalar_y_seguimiento.sql`.

Este documento explica cómo entran y cambian los registros de la base cuando interviene la automatización: qué
crea cada paso, qué se rechaza, qué queda registrado, qué se puede deshacer y con qué pruebas se comprueba. Las
reglas de cada campo están en el [diccionario de datos](DICCIONARIO_DE_DATOS.md) y los controles que lo protegen, en
el [reporte de controles](REPORTE_DE_CONTROLES.md) (los IDs como `C-04` remiten a ese reporte).

## 1. La regla central

**n8n nunca entra a la base.** Todo lo que lee o escribe pasa por la API del CRM (`/api/v1/automatizacion/…`, con
su propia llave). Por eso las reglas de validación, duplicados, supresión y límites de contacto son las mismas para el
CRM, la importación CSV y la automatización: viven en un solo lugar, el código de la API, y las prueba la misma suite.

## 2. Las piezas

| Pieza | Qué hace | Cuándo corre | Estado al 3-nov |
|---|---|---|---|
| **Botón «Mandar a automatización»** (CRM) | Un administrador o supervisor elige prospectos y una campaña; los que están listos entran a la fila | A mano | En producción desde el 16-oct |
| **PT1a · tomar de la fila** (n8n) | Pide a la API los prospectos que tocan hoy y llama a PT1 una vez por cada uno | A mano mientras siguen las pruebas; al encender, lunes a viernes a las 10:00 | Probado en vivo el 16-oct |
| **PT1 · ingesta y scoring** (n8n) | Valida al prospecto, lo califica con Gemini (o por reglas si Gemini falla), revisa si se le puede escribir y registra el envío | Lo llama PT1a | Probado en vivo; con `MODO_PRUEBAS` solo escribe a buzones de prueba |
| **PT1b · plantillas** (n8n) | Arma y manda el correo con SendGrid, con el texto que devuelve la API | Lo llaman PT1 y PT4 | Publicado |
| **PT2 · respuestas** (n8n) | Recibe las respuestas (Inbound Parse de SendGrid), las registra y avisa al supervisor | Cada vez que llega un correo | Publicado y probado el 7-oct |
| **PT2a · sugerencia de IA** (n8n) | Propone una clasificación para cada respuesta; una persona la confirma | Lo llama PT2 | Construido el 19-oct (modo sugerencia) |
| **PT3 · eventos de SendGrid** (n8n) | Bajas por link, quejas de spam y rebotes | Cada evento de SendGrid | Probado en vivo (baja del 8-oct) |
| **PT4 · recordatorios** (n8n) | Manda los correos 2 y 3 al vencer la espera de 5 días hábiles, o marca inactivo al que ya recibió 3 | Lunes a viernes a las 10:00 | Publicado el 19-oct, con `MODO_PRUEBAS` |
| **PT5 · trabajos diarios** (n8n) | Llama a la API para los trabajos de cada día: vencer las filas importadas sin confirmar (30 días) y las cotizaciones con cierre pasado, avisar de tareas vencidas y de documentos sin revisar, y calcular las métricas del día anterior | Todos los días a las 7:00 (hora de México) | Publicado (confirmado por T2 el 3-nov; RUNBOOK §10). API: `POST /automatizacion/jobs/:nombre`, prueba `290-jobs-por-endpoint` |
| **B4 · Error Workflow global** (n8n) | Registra en la API cualquier falla de un flujo y avisa por correo | Cuando algo falla | Publicado y probado el 23-sep |
| **Freno del dominio** (API) | Con 2 quejas de spam o 5 rebotes en 7 días pausa toda la prospección y avisa a administradores y supervisores. Se reanuda a mano en Administración | Con cada queja o rebote | En producción desde el 5-nov (`00048-7x5`) |

## 3. Recorrido de un prospecto

1. **Entra al CRM** por importación CSV o alta manual. Primero queda en el área de carga (`borradores_captura`) y una
   persona lo confirma; al confirmar nace la empresa, el contacto y el prospecto en estado `capturado` (§4).
2. **Se manda a la fila** con el botón. Solo entran los listos: giro, tamaño, correo usable, sin baja, con menos de 3
   correos, sin espera abierta y sin otro prospecto de la misma persona en la fila. Queda `en_fila`.
3. **PT1a lo toma.** La API entrega en orden de llegada, solo de campañas activas, hasta `NUEVOS_POR_DIA` (10) al
   día sin pasar del tope diario de correos. En feriado no entrega nada.
4. **PT1 lo valida.** Si no pasa, queda `excluido` con su motivo y no gasta Gemini. Si pasa, queda `validado`.
5. **PT1 lo califica:** guarda el resultado en `resultados_scoring` y le pone score, prioridad y confianza. A Gemini no
   le llegan correos, teléfonos ni nombres de archivo (`D-07`).
6. **PT1 revisa si se le puede escribir** (`envios/verificacion`): supresión, máximo de 3 correos en 6 meses, espera
   de 5 días hábiles y campaña activa. Si no se puede, el prospecto se marca con el motivo.
7. **PT1 registra el envío** (`POST /envios`) **antes** de mandarlo; la API abre la espera de 5 días hábiles y
   devuelve el texto del correo. Luego PT1b lo manda.
8. **PT4 manda los recordatorios** (correos 2 y 3) cuando vence la espera. Después del tercero, si nadie respondió,
   marca al prospecto `inactivo`.
9. **Si responde,** PT2 registra la respuesta, cierra la espera de esa persona y crea una tarea en la cola de
   clasificación. Una persona clasifica (la IA solo sugiere): `interesado` crea una tarea para un vendedor;
   `baja` suprime todos los medios de la persona.
10. **Si pide la baja por link o marca spam,** PT3 avisa a la API, que da de baja a la persona completa y cancela sus
    seguimientos. Un rebote solo suprime ese correo.

## 4. Alta: cómo entra un registro

| Origen | Qué pasa | Dónde queda antes de entrar | Quién lo confirma |
|---|---|---|---|
| Importación CSV | Cada fila se valida y se compara contra la base y contra el mismo archivo (`C-03`). Las que coinciden con una persona que ya existe quedan «duplicado» | `borradores_captura`, con su lote | Una persona, fila por fila o «Confirmar todas» |
| Alta manual de prospecto | Las mismas reglas que el CSV; puede colgar de una empresa que ya existe | `borradores_captura` | Quien lo captura |
| Empresa con el mismo nombre que una existente | Desde el 3-nov la pantalla avisa y deja confirmar la fila en esa empresa; «Confirmar todas» la junta si hay **una sola** con ese nombre (`G-01`) | Mismo borrador | Quien confirma |
| Prospecto a automatización | Sigue siendo el mismo registro: solo cambia a `en_fila` | — | Administrador o supervisor (botón) |

Lo que no se confirma expira a los 30 días; lo vence PT5 cada mañana (§2). PT1 **ya no crea prospectos** (desde el 16-oct): solo trabaja con los que
le entrega la fila, así que la base tiene una sola lista de prospectos y todo entra con revisión humana.

## 5. Cambio: qué actualiza la automatización

| Evento | Qué cambia en la base | Endpoint |
|---|---|---|
| PT1a toma de la fila | El prospecto queda tomado (`fila_tomado_en`); si no avanza en 24 h se puede volver a tomar | `POST /automatizacion/prospectos/fila/tomar` |
| Validación | `validado` o `excluido` con motivo | `POST /automatizacion/validaciones`, `POST /automatizacion/prospectos/estado` |
| Calificación | Fila nueva en `resultados_scoring`; score, prioridad y confianza del prospecto | `POST /automatizacion/scoring` |
| Envío | Fila en `envios` con el correo al que sale (el primero utilizable de la persona) y su espera de 5 días hábiles | `POST /automatizacion/envios` |
| Confirmación del envío | `enviado` con el id de SendGrid, o `fallido` con el error. Un fallido no gasta el contacto: se cierra su espera y se reintenta hasta 3 veces sobre la misma fila (el primer correo regresa a la fila; un recordatorio reabre la espera anterior). Sí ocupa lugar en el tope diario | `POST /automatizacion/envios/:id/confirmacion` |
| Interesado sin atender | Con un día hábil sin que nadie tome la tarea, sube a urgente y se avisa a los supervisores | Trabajo diario de PT5 |
| Recordatorio vencido | La espera se reclama; sale el siguiente correo o el prospecto pasa a `inactivo` | `GET /automatizacion/envios/vencidas` |
| Respuesta | Fila en `respuestas`, espera cerrada, tarea de clasificación | `POST /automatizacion/respuestas` |
| Clasificación | Estado del prospecto; con `baja`, supresión de todos sus medios y cancelación de seguimientos | `POST /automatizacion/respuestas/clasificacion` o la cola del CRM |
| Baja, spam o rebote de SendGrid | Supresión (persona completa o solo el correo) y prospectos en `baja` | `POST /automatizacion/supresion` |
| Falla de un flujo | Incidencia y, si es crítica, proceso fallido | `POST /automatizacion/errores-workflow` |

Los estados posibles y quién pone cada uno están en el diccionario (§6). Los estados cerrados (`baja`, `interesado`,
`no_interesado`, `descartado`, `excluido`, `inactivo`) ya no reciben correos.

## 6. Rechazo: qué se detiene y por qué

| Caso | Qué hace el sistema | Control |
|---|---|---|
| Fila del CSV con datos inválidos | Se rechaza con el motivo en español; nada entra | `B-01` |
| Persona que ya existe | La fila queda «duplicado»; solo entra reutilizando el contacto existente, a propósito | `C-01`, `C-03` |
| Prospecto sin giro, tamaño o correo activo, o en baja | No entra a la fila; regresa con su motivo | `D-06` |
| Campaña finalizada, en borrador o vencida | El botón responde que la campaña terminó; una pausada o que aún no empieza sí acepta (esperan) | `D-06` |
| Prospecto sin validar | La API no registra el envío (`PROSPECTO_NO_VALIDADO`) | `D-04` |
| Correo o teléfono en la lista de supresión | No se le escribe, aunque se vuelva a capturar | `D-01` |
| Más de 3 correos en 6 meses o espera abierta | La verificación responde que no se puede enviar | `D-03` |
| Tope diario alcanzado | No se entregan más prospectos ni recordatorios ese día; esperan | `D-05` |
| Freno del dominio activado | Nadie sale ni se marca excluido: la fila, la verificación, las esperas y el registro esperan hasta que un administrador reanude | `565-freno-dominio` |
| Recordatorio de un prospecto cerrado, suprimido o sin correo | Se cancela con su motivo (`recordatorio_omitido` en la bitácora) | `D-01`, `D-03` |

## 7. Registro: qué queda escrito

- **Bitácora de cambios (`auditoria`):** quién cambió qué, con el antes y el después. Incluye confirmar filas,
  mandar y sacar de la fila, clasificar, recordatorios omitidos y fusiones de empresas (`E-04`). Se consulta en
  Administración → Registro de cambios.
- **Historial que no se reescribe:** `resultados_scoring`, `envios`, `respuestas` y `actividades` solo reciben filas
  nuevas.
- **Reintentos sin duplicar:** todo lo que crea n8n lleva un `execution_id` único. Si n8n repite una llamada, la API
  responde con el registro que ya existía (`C-04`).
- **Fallas:** cada falla de un flujo deja una **incidencia** con el workflow, el nodo, el código HTTP y el mensaje; las
  críticas, además, un **proceso fallido** que se revisa en `GET /procesos-fallidos` y se marca resuelto. B4 avisa
  por correo.
- **Qué pasó con cada correo:** `envios` guarda el destinatario, si salió o falló, el id de SendGrid y el error. Los
  avisos a las personas (tareas, interesados, documentos) llegan por la campanita y el correo del CRM; la bandeja de
  salida hacia n8n se retiró el 5-nov porque n8n nunca tuvo quién los recibiera.

## 8. Reversión: qué se puede deshacer

| Qué | Cómo se deshace | Quién |
|---|---|---|
| Una fila importada | Antes de confirmarla: rechazarla, o dejar que expire a los 30 días | Quien importó |
| Un prospecto en la fila | «Sacar de la fila» mientras PT1 no lo haya tomado; vuelve a `capturado`, aunque hubiera entrado como `excluido` | Administrador o supervisor |
| Un prospecto `excluido` | Corregir el dato que faltaba en la ficha y volver a mandarlo a la fila | Quien lo corrige |
| Empresa o contacto | Se **desactivan**, no se borran; su historial se conserva | Administrador o supervisor |
| Un dato mal editado | La bitácora guarda el valor anterior; se vuelve a capturar desde la ficha | Quien lo corrige |
| Una fusión de empresas | Desde el CRM no se deshace. La bitácora guarda qué contactos se movieron y de dónde, así que un desarrollador puede regresarlos con respaldo | T2 |
| Un error grave en la base | Respaldo diario y recuperación a un minuto exacto de los últimos 7 días, en una copia aparte sin tocar la real; restauración probada el 27-oct (`F-02`) | T1 y T2 |

**Lo que no se deshace, a propósito:**
- **Una baja.** La persona pidió no ser contactada; una clasificación posterior la registra pero no la saca de baja.
- **Un correo enviado.** Por eso el envío se registra antes de mandarse: si el registro ya existe, un reintento no
  vuelve a mandar. Se prefiere perder un recordatorio a mandar uno doble.

## 9. Fallas y reintentos

- **Errores pasajeros:** cada nodo de PT1 que llama a la API reintenta 3 veces con 5 s entre cada una. Es seguro
  porque los endpoints son idempotentes.
- **Gemini:** hasta 4 llamadas con esperas de 5, 30 y 120 s. Si sigue fallando, el prospecto se califica por reglas
  (0 a 100) y queda la incidencia `gemini_agotado`. Nadie sale castigado.
- **Lo que sobrevive a los reintentos** llega a B4 como crítico. B4 no relanza la ejecución: una persona decide desde
  n8n.
- **Correo que SendGrid rechaza:** n8n lo confirma como `fallido` y la API lo reprograma, hasta 3 intentos, sin gastar
  el contacto de la persona. Si SendGrid rechaza todo un día, el tope diario detiene la fila.
- **Una lista mala:** el freno del dominio pausa la prospección con 2 quejas o 5 rebotes en 7 días (§6).

## 10. Pruebas

Todas son pruebas automáticas de la API (`test/`), que corren contra una base MySQL real en cada cambio. Las pruebas
en vivo con n8n y SendGrid están fechadas en `PLAN_N8N_DEFINITIVO.md`.

| Caso | Qué se comprueba | Pruebas |
|---|---|---|
| **Alta** | Importación con revisión, duplicados contra la base y el archivo, límites del CSV, alta en una empresa existente, empresas con el mismo nombre | `200-prospectos-lotes`, `210-prospectos-csv-validacion`, `315-importacion-csv-limites`, `525-prospecto-empresa-existente`, `545-empresas-parecidas` |
| **Alta a automatización** | Quién puede mandar, quién entra a la fila y por qué no, misma persona una sola vez, orden, cupo diario y feriados | `485-fila-automatizacion`, `365-tope-diario` |
| **Cambio** | Calificación, envío solo a validados, espera por persona, recordatorios, respuestas a tiempo y tardías, clasificación | `535-automatizacion-scoring-incidencias`, `475-envio-solo-validados`, `140-envios-por-persona`, `360-ventana-por-persona`, `230-recordatorios`, `200-respuestas-recibidas`, `180-clasificacion-respuestas`, `220-sugerencia-clasificacion` |
| **Rechazo** | Supresión, máximo de 3 correos, prospecto sin validar, recordatorios cancelados con su motivo | `190-supresion`, `265-crm-respeta-supresion`, `140-envios-por-persona`, `475-envio-solo-validados`, `230-recordatorios` |
| **Baja** | La baja es de la persona, cancela seguimientos y no se deshace | `245-baja-por-evento`, `350-tareas-baja-carrera`, `180-clasificacion-respuestas` |
| **Reversión** | Rechazar y expirar filas, sacar de la fila (vuelve a `capturado`), fusión con su bitácora | `200-prospectos-lotes`, `290-jobs-por-endpoint`, `485-fila-automatizacion`, `546-fusion-empresas` |
| **Registro** | Bitácora con antes y después, reintentos sin duplicar, fallas de flujo y procesos fallidos | `455-registro-cambios`, `130-procesos-fallidos-auditoria`, `535-automatizacion-scoring-incidencias`, `60-error-workflow-promotion`, `562-envio-destinatario-y-estado` |
| **Fallas** | Un envío fallido se reintenta sin gastar el contacto (también el recordatorio, con el id de PT4), ocupa el tope y para a los 3 intentos; el freno pausa con quejas o rebotes y no se traba con dos a la vez | `562-envio-destinatario-y-estado`, `565-freno-dominio` |
| **Tareas nuevas** | Interesados sin atender se escalan; seguimiento de cotizaciones a los 5 días hábiles, que se cancela al cerrarse | `570-escalar-interesados`, `575-seguimiento-cotizaciones` |
| **Concurrencia** | Dos corridas a la vez no toman el mismo prospecto ni la misma espera, ni mandan dos correos a la misma persona | `485-fila-automatizacion`, `230-recordatorios` |

Resultado al 3-nov-2026 (código de `e4ff3b2`, el que está en producción): 792 de 792 pruebas de la API, en 99
archivos, en una corrida completa.

## 11. Límites y pendientes

- **Todo sigue en modo de pruebas.** `MODO_PRUEBAS` está encendido: los correos solo salen a buzones del equipo.
  Encender es una decisión de G5, con la lista de encendido del RUNBOOK (§10).
- **Faltan dos cambios en n8n** (`docs/n8n/confirmacion-envios/`): que PT1 y PT4 manden al correo que devuelve la API
  y que PT1b confirme cada envío. Mientras tanto los correos salen igual, pero Administración los marca «sin confirmar»
  y la regla de fallidos no se activa.
- **PT1a corre a mano.** El día de encender se cambia a horario (10:00, lunes a viernes).
- **Las respuestas se clasifican a mano.** La IA solo sugiere. Pasar a modo directo es una decisión aparte, cuando la
  IA demuestre que acierta (lo mide la evaluación del modelo, OB-04).
- **Un «Retry» manual en n8n** crea otra ejecución con otro `execution_id`: puede repetir una fila de calificación o
  de bitácora, que es inofensivo; lo que importa (un correo doble) lo bloquea la política de contactos por persona.
- **No se guarda la confirmación de SendGrid** en `envios`: si el registro pasa y el correo falla, ese correo se
  pierde en vez de duplicarse. Está como mejora.

## Relacionado

- [`PLAN_N8N_DEFINITIVO.md`](../planes/PLAN_N8N_DEFINITIVO.md): diseño de cada flujo y pruebas en vivo, con fecha.
- [`RUNBOOK_DEPLOY.md`](../RUNBOOK_DEPLOY.md): lista de encendido (§10), respaldos y recuperación (§9), avisos (§11).
- [Reporte de controles](REPORTE_DE_CONTROLES.md) · [Diccionario](DICCIONARIO_DE_DATOS.md) · [Bitácora](BITACORA.md).
