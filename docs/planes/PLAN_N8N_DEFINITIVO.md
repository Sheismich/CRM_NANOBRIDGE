# Plan definitivo de automatización n8n

## Regla central

n8n nunca accede a MySQL. Toda lectura y escritura pasa por la API HTTP.

## Pendientes en orden (6-oct-2026)

1. Hoy después de las 3 pm: prueba en vivo de PT4, sin tocar nada antes.
2. Aviso por correo desde B4 (Error Workflow), con la credencial de SendGrid que ya existe.
3. Backend: sin `N8N_WEBHOOK_URL`, el despachador del outbox no intenta mandar. Los eventos se
   quedan `pendiente`, sin gastar reintentos, y se entregan cuando exista B3. Hoy cada evento
   (`prospecto_clasificado`, `tarea_cerrada`, alertas diarias) termina en `procesos_fallidos`
   (`outbox-dispatcher.service.ts`, `deliver`) y ese ruido esconde los errores reales de B4.
   Con TDD; después cerrar como resueltos los procesos fallidos que dejó ese ruido.
4. Aviso al supervisor cuando llega una respuesta (en PT2, justo después de registrarla).
5. Completar la lista de encendido (RUNBOOK_DEPLOY.md §10).
6. Cupo para recordatorios y fila de espera de correos iniciales, cuando conteste Carlos.
7. Con un mes de datos reales: revisar si la prioridad "alta" de verdad responde más. Si no,
   ajustar el peso de Gemini (hoy 60%).

**Después, no bloquean encender:**
- IA que sugiere la clasificación de respuestas en PT2: la API ya está lista; falta el workflow y el
  permiso de Carlos para mandar el texto a Gemini (B2).
- B3, webhook único de reingreso, y luego poner `N8N_WEBHOOK_URL`. Primero decidir qué hace n8n con
  cada evento.
- B4: marcar como resueltos los procesos fallidos 1 y 2 (de prueba).
- Guardar la confirmación de SendGrid en `envios` (riesgo aceptado en "Flujo de recordatorios").
- Backend: que el Historial muestre los documentos enviados y su revisión (PLAN_CRM_DEFINITIVO.md #4).
- Backlog del code review y del plan de fixes: Gmail con puntos y `+`, teléfonos E.164, auditoría de
  tareas liberadas, aviso de medio suprimido en el CSV, entre otros.
- Documentos desactualizados: README "Qué falta", S3 §2.2, PLAN_FRONTEND §7 ("el envío sigue en
  MOCK") y la línea de este plan que dice que `listarVentanasVencidas` no revisa la campaña.

**Descartado, ya revisado:**
- PT1 no adivina correos: solo limpia espacios y mayúsculas, y si sigue mal crea tarea.
- Si Gemini falla, el puntaje es el de reglas (0-100); nadie sale castigado.
- Asignar el "interesado" al dueño de la empresa: no aplica, las empresas de n8n nacen sin dueño.

## B0 Cerrar Parte 1

1. Persistir incidencias de scoring.
2. Persistir resultados de scoring.
3. Crear ventanas de espera al registrar envíos.
4. Probar la rama de exclusión.
5. Mover `execution_id` a la raíz del payload.
6. Implementar reintento explícito de Gemini.

## Reintento Gemini

- Máximo tres reintentos (4 llamadas a Gemini en total: 1 inicial + 3 reintentos).
- Esperas: 5 s, 30 s y 120 s.
- Desactivar `Retry On Fail` del nodo Gemini para no duplicar intentos.
- Si Gemini falla definitivamente, usar scoring por reglas.
- Registrar incidencia mediante API.
- Nunca enviar correo, teléfono, descripción libre o documentos a Gemini. (Para clasificar
  respuestas hay una excepción propuesta, **pendiente de aprobar por Carlos**: ver B2, "Clasificación
  con IA: modo sugerencia primero".)

## B1 Sustituir MOCK por API

Sustituir uno por uno y probar cada endpoint antes de conectarlo:

1. Parámetros.
2. Catálogos.
3. Registro de prospecto.
4. Validaciones.
5. Tareas.
6. Scoring.
7. Incidencias (requerido por B0; debe pasar por esta misma disciplina de prueba-contra-stub antes de darse por cerrado).
8. Consulta de supresión.
9. Verificación de envío.
10. Estado de prospecto.
11. Campaña activa.
12. Registro de envío.

No conectar un nodo HTTP hasta que su endpoint pase pruebas contra el stub. El registro de una nueva supresión (`no_contactar`) no es parte de esta secuencia. Desde el 24-sep-2026 la registra la propia API al clasificar una respuesta como `baja` (ver B2).

**✅ B1 completado del lado API (10-sep-2026).** Los 17 endpoints de `PLAN_API_DEFINITIVO.md` (incluyendo B2: Consulta de prospecto para scoring, Ventanas vencidas, Respuesta recibida, Respuesta clasificada) están construidos y probados.

**Estado real del lado n8n (workflow "PT1. ingesta y scoring", verificado 21-sep-2026 contra la API en producción y Gemini real, no contra el stub):**

1-2. Parámetros / Catálogos — no aplican a este workflow (no los usa).
3. Registro de prospecto — ✅ conectado y probado en real.
4. Validaciones — ✅ conectado y probado en real (21-sep-2026), ambas ramas: prospecto válido (sigue el flujo normal hacia Gemini/scoring) y prospecto excluido (sin giro/tamaño/medio de contacto activo → corta ahí, no gasta Gemini, decisión de diseño confirmada con Fabián).
5. Tareas — ✅ conectado y probado en real (incluye la rama de "2 intentos fallidos → tarea manual").
6. Scoring — ✅ conectado y probado en real, ambas ramas (Gemini exitoso y solo-reglas).
   **Ciclo de reintentos de Gemini reconstruido y probado en vivo (23-sep-2026).** La
   revisión del 22-sep había dado por buena la *forma* del loop, pero estaba roto por dentro y
   nunca se había notado porque Gemini no había fallado en ninguna corrida real: la salida de
   error del nodo "HTTP Request" solo trae `{ error }`, no los datos de entrada, así que
   "reportar gemini", "Wait" y "Edit Fields" leían `intento_gemini` vacío (el contador nunca
   avanzaba), los reintentos mandaban `body_gemini` vacío, y la incidencia salía con
   `prospecto_id: ""` (400 de la API). Diseño actual:
   - Nodo Code **"control reintento gemini"** en la salida de error: `intento = $runIndex + 1`,
     toma `prospecto_id` y `body_gemini` de `$('preparar solicitud').first().json` (no de
     `$json`), y calcula `espera_seg = [5, 30, 120][intento - 1]`.
   - "reportar gemini" compara `$json.intento < 4`; "Wait" espera `$json.espera_seg` segundos
     y regresa directo a "HTTP Request". "Edit Fields" se eliminó.
   - "HTTP Request2" (incidencia) manda `prospecto_id` e `intentos` como números y tiene
     `On Error = Continue`: si la incidencia falla, el prospecto igual se califica por reglas.
   - Retry On Fail del nodo Gemini sigue apagado (su `waitBetweenTries: 2000` es un residuo sin
     efecto).
   Prueba real: URL de Gemini apuntada temporalmente a un modelo inexistente → 4 fallos, 3
   esperas, incidencia `gemini_agotado` (id 1), scoring por reglas y envío registrado (id 8).
   URL restaurada después.
7. Incidencias — ✅ conectado y probado en real (23-sep-2026, ver punto 6).
8. Consulta de supresión — no es un paso separado en este workflow: va integrado dentro de la verificación de envío (paso 9), por diseño.
9. Verificación de envío — ✅ conectado y probado en real.
10. Estado de prospecto — ✅ conectado y probado en real (23-sep-2026), incluida la rama de exclusión (`puede_enviar: false` → "HTTP Request4" marca `excluido`): la misma persona enviada dos veces seguidas con un correo nuevo dio `puede_enviar: true` la primera vez y "Ventana de espera activa" la segunda, y un correo de pruebas viejo dio "Máximo de 3 contactos alcanzado". Para probar el camino feliz hay que usar un correo nunca usado y sin teléfono (o uno nuevo): repetir cualquiera de los dos hace que la API lo trate como la misma persona.
11. Campaña activa — ✅ conectado y probado en real (21-sep-2026), ambas ramas: campaña activa (llega hasta el envío real) y campaña finalizada (marca `estado: "inactivo"` con motivo).
12. Registro de envío — ✅ conectado y probado en real.

**Workflow intencionalmente en `active: false` (confirmado 22-sep-2026, `/grill-me`):** no
activar hasta reemplazar "MOCK · envio de campana (7)" con el nodo real de SendGrid (ver B2)
— activarlo hoy mandaría correos falsos (`proveedor_mensaje_id: "mock-msg-0001"`) a prospectos
reales. Los cambios del 23-sep-2026 (reintentos de Gemini, Retry On Fail, Error Workflow) están
guardados en el **borrador** de n8n a propósito: no se publica hasta terminar de construirlo.

## B2 Respuestas, clasificación y seguimiento

- Recibir respuestas desde webhook del proveedor de correo. **Proveedor: SendGrid (decidido 22-sep-2026, `/grill-me`)** — Inbound Parse para entrada (webhook nativo, cumple "no usar polling"), API transaccional para salida, nodo nativo en n8n. Reemplaza al nodo "MOCK · envio de campana (7)" del workflow "PT1" (que trae `proveedor: "pendiente_de_elegir"`) cuando se construya el envío real.
- Registrar respuesta mediante API.
- Clasificar con IA o enviar a cola manual (actualizado 30-sep-2026):
  - **Hoy (modo sugerencia):** cada respuesta entra a la cola (`crear_tarea_clasificacion: true`). La IA, cuando exista, solo propone con `POST /respuestas/sugerencia` y una persona confirma. Ver "Clasificación con IA: modo sugerencia primero".
  - **Modo directo, más adelante:** n8n llama al endpoint "Respuesta clasificada". Si es ambigua, ese endpoint deja o reusa una `tarea` con `tipo=clasificacion` (no hay tabla `cola_clasificacion` aparte), que aparece en `GET /api/v1/cola-clasificacion` para que el Equipo CRM la resuelva.
- Procesar no interesado, baja, respuesta automática, ambigua e interesado.
- **La supresión por "baja" ya no es un paso de n8n (cambiado 24-sep-2026).** El endpoint
  "Respuesta clasificada" registra en `lista_supresion` **todos** los medios del contacto
  (correo, teléfono y WhatsApp), no solo los del canal por el que respondió: la persona pidió no
  ser contactada, no dejar un canal. Lo hace en la misma transacción que fija el estado del
  prospecto. Sigue siendo por contacto y por medio: no toca a otros contactos de la misma
  empresa. Si el contacto no tiene ningún medio que suprimir, la clasificación se aplica igual y
  queda una incidencia `baja_sin_medios` (severidad alta). La clasificación manual de la cola
  hace lo mismo cuando alguien elige `baja`. n8n **no** debe llamar a
  `POST /automatizacion/supresion` después de clasificar. Si lo hiciera no se rompe nada
  (responde `ya_existia`), pero es trabajo de más. Ese endpoint queda para supresiones que no
  vienen de una respuesta clasificada, como el link de baja de SendGrid (ver "Envío real con
  SendGrid").
- **Bajas por evento de SendGrid (PT3, decidido 1-oct-2026).** PT3 manda en
  `POST /automatizacion/supresion` el campo `evento`, con el nombre del evento de SendGrid. La API
  decide el alcance según ese campo:
  - **`unsubscribe`, `group_unsubscribe` y `spamreport`** son la persona pidiendo que no la
    contacten. La API suprime **todos** los medios de quien tenga ese correo (correo, teléfono y
    WhatsApp) y pasa **todos sus prospectos** a `baja`. Lo deja en el Historial, en la misma
    transacción. Es la misma regla que una respuesta clasificada `baja`.
  - **`bounce`** (rebote definitivo) suprime **solo ese correo**: no es una petición de la
    persona.
  - **Sin `evento`** se comporta igual que `bounce`, por compatibilidad.

  La respuesta agrega `alcance` (`persona` o `medio`), `supresion_ids` y `prospectos_en_baja`.
- **"La baja manda" (1-oct-2026, decisiones de Fabián tras el /code-review).**
  - Toda baja, por respuesta clasificada `baja` o por evento de SendGrid, **cancela las tareas de seguimiento abiertas** del prospecto ("Contactar prospecto interesado", "Seguimiento reagendado", "Respuesta tardía"...) con el resultado "Cancelada: el prospecto pidió la baja".
  - Las tareas de la cola de clasificación se quedan, para que alguien lea lo que contestó.
  - Si el prospecto ya está en baja, clasificar una respuesta suya la registra, pero **no lo saca de baja ni crea tareas** (ni de vendedor, ni de seguimiento, ni de cola).
  - Antes, un "interesado" posterior regresaba al prospecto a interesado y le asignaba un vendedor.
- La clasificación manual (cola de clasificación) aplica su decisión en la API y el evento
  `prospecto_clasificado` llega a n8n **solo como aviso**: la rama del Switch de B3 no tiene que
  cambiar estados ni registrar supresiones.
- Recordatorios e inactividad son **una sola consulta con una rama, no dos mecanismos separados**
  (corregido 22-sep-2026, hallazgo de `/grill-me`): n8n hace polling de
  `GET /automatizacion/envios/vencidas` (ver `listarVentanasVencidas` en `automatizacion.service.ts`); cada fila
  trae `es_ultimo_contacto`. Si es `false`, n8n manda el siguiente recordatorio (`POST /envios`);
  si es `true` (ya llegó a 3 contactos), n8n marca inactividad (`POST /prospectos/estado`) en vez
  de mandar otro. No hay que construir un job de "recordatorios" aparte de "ventanas vencidas".
- Procesar respuestas tardías: crear tarea comercial, no reiniciar automáticamente el outbound.

### Respuestas a direcciones que no son nuestras (2-oct-2026)

Inbound Parse recibe correo para **cualquier** dirección del subdominio de respuestas, y antes el
spam a `info@`, `ventas@`, etc. creaba una tarea "Respuesta no identificada" por correo. Ahora
`POST /respuestas` funciona así:
- **Sin la forma** `r+<id>.<firma>@…`: responde 200 con `ignorada: "direccion_no_valida"` y no
  crea tarea.
- **Con la forma pero firma inválida:** sigue creando "Respuesta no identificada", porque puede
  ser una respuesta real alterada.
- **El `remitente`** que manda PT2 ahora se guarda en `respuestas.remitente` (migración 024) y
  la cola de clasificación lo muestra. Así se ve quién escribió de verdad si el prospecto reenvió
  el correo.

`POST /supresion` con `tipo: "correo"` exige un correo válido (400 si no).

### Flujo de recordatorios (correos 2 y 3): contrato con la API (30-sep-2026)

**`GET /automatizacion/envios/vencidas`.** Cada fila de `data` trae lo necesario para mandar el
correo:
- `correo`: uno activo y fuera de `lista_supresion`, el principal primero;
- `contacto_nombre`, `empresa_nombre` (el nombre comercial o, si no hay, el legal) y `giro`;
- `campana_id` y `campana_activa`, que vale `null` cuando no hay campaña. Con eso n8n ya no
  necesita llamar a "Campaña activa".

**Campañas en espera (cambiado 1-oct-2026: pausa = espera).** Si la campaña está **pausada** o
todavía no llega su `fecha_inicio`, la API **no toca** sus ventanas: no salen en `data` ni en
`omitidas`, siguen abiertas y aparecen cuando la campaña vuelve a mandar. Esto incluye la última
ventana de la persona. Para que no salgan todas el mismo día al reactivar, las reparte el tope
diario (bloque "antes de encender"). Las fechas de campaña se comparan con la fecha de México, no
con la de UTC.

**Filas que la API no devuelve.** Las deja reclamadas (`vencida`), así que el recordatorio queda
**cancelado**. Las lista en `omitidas: [{ envio_id, prospecto_id, motivo }]`, con una fila de
auditoría `recordatorio_omitido` cada una. Los motivos son:
- `prospecto_cerrado`: el prospecto está en baja, interesado, no_interesado, descartado,
  excluido o inactivo;
- `campana_inactiva`: la campaña está finalizada, en borrador o ya pasó su fecha de fin;
- `sin_correo`: la persona no tiene correo utilizable;
- `suprimido`: sus correos están dados de baja;
- `canal_desactivado`: el envío era por WhatsApp.

**Excepción:** la fila con `es_ultimo_contacto: true` se devuelve aunque la campaña esté inactiva
o no haya correo, porque ahí n8n no manda nada: marca al prospecto `inactivo` con
`POST /prospectos/estado`. Solo se omite si el prospecto ya está cerrado.

**Qué hace n8n con cada fila:**
1. Si `es_ultimo_contacto` es `true`, marca al prospecto inactivo y no manda nada.
2. Si no hay campaña (`campana_id` es `null`), solo sigue en modo pruebas, igual que PT1, con la
   misma lista `PERMITIDOS` y el mismo `SANDBOX`.
3. Registra el envío con `POST /envios` y `execution_id = "recordatorio-" + envio_id`, con el
   `envio_id` **de la fila**. Es fijo por recordatorio; no se usa el id de la ejecución.
4. Si la API responde `ya_existia: true`, **no manda el correo**.
5. Si no, llama a PT1b con el `reply_to` que devolvió `POST /envios`.

**Sin correos dobles:**
- Dos corridas del poll nunca reciben la misma ventana, por `FOR UPDATE SKIP LOCKED` más el
  reclamo en la misma transacción.
- Dos `POST /envios` para la misma persona se serializan: uno pasa y el otro recibe 409 por la
  ventana nueva.
- Un reintento con el mismo `execution_id` responde `ya_existia`.

Hay tests de las tres cosas.

**Riesgo aceptado:** si el registro pasa y PT1b falla, el Error Workflow (B4) deja la incidencia y
un reintento ya no manda nada, porque recibe `ya_existia`. Se prefiere perder un recordatorio a
mandar uno doble. Hacerlo perfecto requiere guardar la confirmación de SendGrid en `envios`; queda
como mejora.

**Gemini:** el flujo de recordatorios **no le pasa correo, nombre, empresa ni giro a Gemini**.
Personalizar el texto con IA pasaría por la misma aprobación de Carlos que la clasificación de
respuestas.

**Prueba en vivo:** los envíos de prueba 11 a 13 vencen el 6-oct-2026. No se mueven fechas a mano
en producción. Mientras tanto, el flujo se construye y se prueba con datos de ejemplo en n8n.

### Clasificación con IA: modo sugerencia primero (decidido 30-sep-2026)

**Decisiones de Fabián (30-sep-2026).** Construidas del lado API con TDD. El workflow de IA en n8n
todavía no existe.

1. **"interesado" deja una tarea para un vendedor.** Aplica tanto si clasifica n8n como si lo hace
   una persona en la cola. La tarea:
   - se llama "Contactar prospecto interesado";
   - queda **sin asignar**, y un supervisor la reparte con `PATCH /tareas/:id/asignar`;
   - tiene prioridad alta;
   - vence al **fin del siguiente día hábil en hora de México**. La alerta diaria de SLA avisa si
     nadie la toma. El cálculo no conoce días festivos.

   La oportunidad **no** se crea en automático: la crea el asesor que toma al interesado
   (PLAN_CRM_DEFINITIVO.md).
2. **La IA arranca en modo sugerencia.** El workflow queda así:
   - PT2 sigue registrando cada respuesta con `crear_tarea_clasificacion: true`, así que cada una
     sigue cayendo en la cola.
   - Después, la IA manda `POST /automatizacion/respuestas/sugerencia` con `{ execution_id,
     respuesta_id, clasificacion, confianza (0-100 entero), motivo? }`.
   - La API solo guarda la propuesta: no cambia estados, no suprime y no cierra tareas.
   - La cola la muestra en `respuesta.clasificacion_sugerida`, más `confianza_sugerida` y
     `motivo_sugerencia`.
   - Una persona confirma con `POST /cola-clasificacion/:id/clasificar`.

   Registrar la respuesta va aparte a propósito: si Gemini falla, la respuesta ya quedó
   registrada y los recordatorios ya se detuvieron. Reglas del endpoint:
   - un reintento con el mismo `execution_id` responde `ya_existia`;
   - otro `execution_id` sobrescribe la sugerencia;
   - una respuesta ya decidida responde 409 `RESPUESTA_YA_CLASIFICADA`, y n8n debe ignorarlo
     ("Never Error" + revisar el status, como PT3);
   - un `motivo` de más de 500 caracteres se recorta, no se rechaza. Aun así, conviene pedirle a
     Gemini un motivo corto.
3. **Pasar a modo directo** es decisión aparte, cuando la IA demuestre que acierta. Bastaría con
   llamar a `POST /automatizacion/respuestas/clasificacion` en vez de la sugerencia. La API ya
   quedó lista para eso:
   - cierra sola la tarea que PT2 dejó en la cola;
   - "ambigua" reusa esa tarea en vez de crear otra;
   - si una persona intenta clasificar una respuesta que ya decidió la IA, recibe 409
     `RESPUESTA_YA_CLASIFICADA` y no la pisa.
4. **Privacidad: ⚠ PENDIENTE DE APROBAR POR CARLOS.** La regla de "Reintento Gemini" dice "nunca
   enviar descripción libre a Gemini", y el texto de una respuesta es justo eso.
   - **Propuesta de Fabián:** permitirlo **solo después de** que n8n quite correos, teléfonos y la
     firma del texto.
   - **También hay que confirmar qué plan de Gemini se usa.** En el gratuito, Google puede usar
     los datos para entrenar.

   Hasta que Carlos lo apruebe, la regla original sigue vigente y el paso de IA de PT2 no se
   construye. No bloquea nada: mientras tanto, todo se sigue clasificando a mano.
5. `prospecto_clasificado` solo sale de la clasificación **manual**. Si clasificó n8n, n8n ya lo
   sabe. Además, sin `N8N_WEBHOOK_URL` cada evento terminaría en `procesos_fallidos`, y eso sería
   una fila por respuesta.

## Envío real con SendGrid (en planeación, `/grill-me` 24-sep-2026)

Sustituye al nodo "MOCK · envio de campana (7)" de "PT1. ingesta y scoring". Decisiones de la
ronda 1:

1. **Alcance:** este bloque = **enviar + recepción mínima**. Recepción mínima: SendGrid Inbound
   Parse → webhook de n8n → registrar la respuesta en la API (`POST /respuestas`, que cierra la
   ventana de espera y detiene los recordatorios) → crear una tarea para que una persona la
   atienda. La clasificación con IA, las bajas automáticas y los recordatorios automáticos
   quedan para el resto de B2. **No se le escribe a ningún prospecto real hasta que la recepción
   mínima funcione**: sin ella, alguien que respondió "sí me interesa" seguiría recibiendo los
   recordatorios.
2. **Cuenta y DNS:** el jefe de Fabián tiene acceso a la cuenta de correo y al DNS de
   `nano-bridge-mex.com`; Fabián pide la autorización y lo gestiona. Propuesta: envío desde un
   subdominio dedicado (ej. `contacto.nano-bridge-mex.com`) para no afectar la reputación del
   correo normal de la empresa, y otro subdominio con registro MX para Inbound Parse (ej.
   `respuestas.contacto.nano-bridge-mex.com`).
3. **Redacción de los correos (inicial + 2 recordatorios): se prueban las dos opciones al
   construir los nodos** y se decide con los resultados:
   - **Opción A, por giro y escrita una vez:** plantilla fija (saludo, pie legal, link de baja)
     + un párrafo por giro (11 giros × 3 correos) redactado una sola vez con ayuda de IA y
     aprobado por el jefe. Nadie envía texto sin revisar; no se manda nada a Gemini al enviar.
   - **Opción B, Gemini en vivo con candados:** Gemini escribe el párrafo en cada envío, con
     reglas: solo datos de la empresa (giro, tamaño, región; nunca nombre, correo ni teléfono,
     igual que en el scoring), largo máximo, prohibido mencionar precios, descuentos o plazos,
     y texto de respaldo fijo si Gemini falla o tarda.
   - **Cómo se prueba:** un interruptor en n8n elige A o B. Se mandan los mismos prospectos de
     prueba (varios giros) por las dos opciones, **solo a buzones de Fabián**, y se compara:
     calidad del texto, si B inventa algo indebido, si cumple los candados, qué pasa cuando
     Gemini falla, tiempo y costo por correo. Fabián y su jefe eligen con esos ejemplos en la
     mano.
4. **Base legal y aviso de privacidad:** pendiente de Dirección. No bloquea construir; bloquea
   encender los envíos reales. Preguntas: de dónde salen los contactos y si se les puede
   escribir en frío (`CRM_09` exige base legal); texto o link del aviso de privacidad para el
   pie; cómo se identifica la empresa en el correo. Baja: link de baja de SendGrid (bloquea
   envíos futuros); sincronizarlo con `lista_supresion` en B2.
5. **Pruebas:** primero el modo sandbox de SendGrid (no entrega nada), después solo a buzones de
   Fabián. Además, un **interruptor "modo pruebas"** en n8n: encendido, solo envía a una lista
   corta con los correos de Fabián y descarta cualquier otro destinatario; apagado, envía
   normal. No es para clientes ni es permanente: se apaga al salir a producción. Motivo: la base
   de producción tiene prospectos de prueba y ninguno debe recibir un correo por accidente. Los
   correos `@pruebas-nanobridge.test` no existen y rebotarían, dañando la reputación del
   dominio.

**Estado (25-sep-2026):** propuesta aprobada por Dirección. Cuenta de prueba de SendGrid
abierta (con el correo de pasante; se migra a una cuenta definitiva antes de salir a
producción), remitente único verificado para pruebas, y autenticación de
`contacto.nano-bridge-mex.com` pendiente de que se agreguen los registros DNS. Inbound Parse
disponible en la prueba; falta confirmar si el plan Essentials lo incluye.

**Estado (29-sep-2026):** registros DNS agregados en Squarespace Domains y dominio
**verificado** en SendGrid. Incluye el MX de `respuestas.contacto.nano-bridge-mex.com` →
`mx.sendgrid.net` (prioridad 10), que ya resuelve públicamente: para recibir respuestas no
hace falta más DNS. Falta dar de alta el host en SendGrid (Settings → Inbound Parse) con la URL
del webhook de n8n, cuando se construya PT2.

Decisiones de la ronda 2 (25-sep-2026):

1. **Identificar al prospecto en cada respuesta:** cada correo sale con un Reply-To propio,
   `r+<prospecto_id>@respuestas.contacto.nano-bridge-mex.com`. n8n lee el número de la
   dirección a la que llegó la respuesta. Si no trae un número reconocible, crea una tarea
   "respuesta no identificada" para que una persona la revise.
2. **Orden: primero registrar el envío (`POST /envios`), luego enviar con SendGrid.** Si
   SendGrid falla, la persona recibe un correo menos (daño menor). Al revés, un registro
   fallido dejaría un correo enviado que no cuenta para el límite de 3 (daño mayor). Los
   fallos de SendGrid pasan por los reintentos del nodo y, si se agotan, por el Error
   Workflow.
3. **Event Webhook de SendGrid en este bloque:** bajas por link, quejas de spam y rebotes
   definitivos llegan a n8n y se registran con `POST /automatizacion/supresion`, para que el
   CRM y SendGrid digan lo mismo. Desde el 1-oct-2026, PT3 manda también `evento`, y la API
   decide el alcance: persona completa o solo el correo (ver B2, "Bajas por evento de
   SendGrid").
4. **Modo pruebas:** la lista de correos permitidos vive fija en un nodo de n8n (es temporal),
   con un interruptor `modo_pruebas` visible al inicio del flujo.
5. **Calentamiento del dominio:** arranque con 20 correos nuevos al día. Se duplica cada
   semana mientras los rebotes queden debajo de 2% y las quejas debajo de 0.1%, hasta el
   volumen que defina Dirección. Si algo se dispara, se congela y se revisa.

Decisiones de la ronda 3 (29-sep-2026). Revisadas con `/code-review`, `/plan` y `/grill-me`.
Los puntos 1 a 5 se construyen y prueban ya; el punto 6 bloquea **encender**, no construir.

1. **Cambios chicos en la API (primero, con TDD). Hechos el 29-sep-2026:**
   - `POST /respuestas` con `crear_tarea_clasificacion: true` crea **exactamente una** tarea
     de clasificación en la misma transacción, ligada a la respuesta (`respuesta_id`) y sin
     cambiar el estado del prospecto. Aplica también a las respuestas tardías: ahí la tarea
     de clasificación **sustituye** a la tarea de seguimiento "Respuesta tardía de prospecto",
     para que no queden dos tareas por la misma respuesta. Sin la marca, todo sigue igual.
   - `POST /respuestas` con `automatica: true` (fuera de oficina, respuesta automática) guarda
     la respuesta **sin cerrar la ventana y sin crear tarea**. La marca **se guarda en la
     base** reutilizando el valor `automatica` que ya existía en `respuestas.clasificacion`
     (queda `estado = clasificada`), así que no hizo falta migración. El historial de la
     ficha ya la muestra con resultado `automatica`; hay que avisarle al equipo del CRM para
     que la pinte distinta de una respuesta real. Las métricas de tasa de respuesta deben
     excluir ese valor. Las dos marcas juntas dan 400.
2. **PT1, envío real:**
   - El filtro de **modo pruebas** va **antes** de `POST /envios`, para que un destinatario
     descartado no gaste un envío.
   - El envío es un **subflujo reutilizable** ("enviar a prospecto X"), que después usan los
     recordatorios.
   - Se envía con un nodo HTTP Request a `/v3/mail/send` (el nodo nativo de SendGrid no manda
     `custom_args`), con `custom_args` `prospecto_id` y `envio_id`, y `sandbox_mode` en las
     primeras pruebas.
   - Reply-To con código de seguridad desde el primer día:
     `r+<envio_id>.<firma>@respuestas.contacto.nano-bridge-mex.com`. La firma es un HMAC
     **recortado a 16 caracteres**, porque la parte antes de la `@` admite máximo 64.
     **La firma la hace la API, no n8n** (cambio del 29-sep-2026): n8n Cloud no tiene dónde
     guardar la clave fuera de un nodo (`$vars` es del plan Pro y `$env` es solo para n8n
     autoalojado). La clave vive en Secret Manager (`REPLY_TO_SIGNING_SECRET`,
     RUNBOOK_DEPLOY.md §8) y `POST /envios` devuelve el campo `reply_to` ya firmado; PT1 solo
     lo copia al correo.
3. **PT2, respuestas (Inbound Parse):**
   - El webhook de n8n va protegido con usuario y contraseña (Basic Auth en la URL que se da
     de alta en SendGrid).
   - Lee el destinatario de `envelope.to` y se lo pasa a `POST /respuestas` como `reply_to`
     (en lugar de `prospecto_id`), junto con `remitente` y `contenido`. **La API valida la
     firma** y saca de ahí el prospecto. Sin firma válida no guarda la respuesta: crea una
     tarea "Respuesta no identificada" de tipo seguimiento, sin prospecto, con remitente,
     dirección y contenido, y responde `identificada: false`. Si además es automática, la
     descarta sin tarea.
   - **Detecta respuestas automáticas por varias marcas:** encabezados `Auto-Submitted`
     (distinto de `no`), `X-Autoreply`, `X-Auto-Response-Suppress` y asunto tipo "Respuesta
     automática" / "Fuera de oficina" / "Out of office". Esas van con la marca automática del
     punto 1. Si una se escapa, cae como respuesta normal y una persona la clasifica, que es
     el error seguro.
   - El `execution_id` se arma con el `Message-ID` del correo, para que un reenvío de SendGrid
     no duplique la respuesta. Como un `Message-ID` puede pasar de 100 caracteres (el máximo
     de la API), n8n manda un hash corto de él (por ejemplo `msg-` + SHA-256 recortado).
4. **PT3, eventos de SendGrid:**
   - Event Webhook **firmado**, con verificación de la firma en n8n.
   - Bajas por link (`unsubscribe`, `group_unsubscribe`) y quejas de spam van a
     `POST /automatizacion/supresion`. De los rebotes solo cuentan los definitivos (`bounce`
     con tipo `bounce`, no `blocked`).
   - `sg_event_id` sirve de `execution_id`. Un 409 de la API (ya registrado) se trata como
     "saltar", no como error.
5. **Pruebas en producción sin ensuciar:**
   - Todos los prospectos de prueba van en una **campaña "PRUEBAS"**.
   - Cada prueba de baja usa un **contacto separado** en el CRM (`correo+baja1@...`,
     `correo+baja2@...`), porque una baja suprime todos los medios del contacto y dejaría
     inservible el buzón principal de pruebas.
   - Al terminar, la limpieza **cierra las ventanas** de los envíos de prueba en lugar de
     borrar filas en producción.
6. **Antes de encender (bloque aparte):**
   - **Tope diario de correos — en parte hecho (5-oct-2026).** 50 al día (día de México),
     iniciales y recordatorios juntos; variable `TOPE_DIARIO_CORREOS` en Cloud Run (se sube con
     `--update-env-vars`, sin deploy de código).
     - `GET /envios/vencidas` solo entrega los recordatorios que caben hoy. Los demás **no se
       reclaman**: su ventana sigue abierta y salen otro día. Nuevo campo
       `tope_diario_alcanzado` (true = ya no cabe más hoy). La última ventana
       (`es_ultimo_contacto`) no manda correo y no ocupa lugar.
     - `GET /envios/verificacion` trae un campo nuevo `en_espera`. Con el tope lleno responde
       `puede_enviar: false, en_espera: true`. **PT1 debe NO marcar `excluido` cuando
       `en_espera` es true** (aplicado el 6-oct-2026: la salida TRUE de "¿En espera?" va al No
       Operation "En espera: sin lugar hoy"): la persona no tiene nada malo,
       solo no hubo lugar ese día.
     - Pendiente: la fila de espera de los **correos iniciales** (quién vuelve a intentar mandarle
       a un prospecto que quedó `en_espera`). Se diseña cuando se sepa de dónde salen los
       prospectos (Carlos): si llegan en lotes, el tope se aplica en la entrada.
   - ~~La ventana se cierra **por persona** al recibir respuesta.~~ **Hecho (5-oct-2026):**
     `registrarRespuesta` cierra todas las ventanas abiertas de la persona en ese canal, aunque
     el último correo haya salido con otro prospecto suyo. PT2 no cambia.
   - ~~No volver a escribirle a quien ya respondió.~~ **Decidido por Fabián (5-oct-2026): no se
     bloquea.** Una respuesta detiene los recordatorios de ese ciclo (la ventana se cierra), pero
     no impide que una campaña distinta le escriba después. Lo que sí protege a la persona: la
     baja (para siempre) y el tope de 3 correos por persona cada 6 meses, que cuenta todas las
     campañas juntas. Riesgo aceptado: un "interesado" que ya atiende un vendedor podría recibir
     el correo de otra campaña; si se quiere evitar, excluir a quien tenga tarea u oportunidad
     abierta.
   - Baja por link o spam suprime todos los medios y pasa el prospecto a baja. Un rebote
     definitivo suprime solo ese correo.
   - El flujo de recordatorios pregunta **si la campaña sigue activa** antes de mandar. Hoy
     `listarVentanasVencidas` no revisa la campaña.
   - Pendientes fuera del código: fuente de prospectos, base legal y aviso de privacidad,
     cuenta definitiva de SendGrid (la prueba vence el 24-nov-2026) y confirmar Inbound Parse
     en el plan Essentials.

## Política de contactos

- Máximo tres contactos totales: envío inicial y dos recordatorios.
  **Se cuentan por persona (contacto), no por prospecto** (decidido 23-sep-2026): si la misma
  persona reingresa al flujo de ingesta, sus envíos anteriores cuentan. Tras **6 meses sin
  ningún contacto** puede arrancar un ciclo nuevo de 3. Lo aplica la API en
  `envios/verificacion`, `POST /envios` y `envios/vencidas`; n8n no necesita lógica extra.
- Cinco días hábiles de espera entre flujo y seguimiento (también por persona). Se cuentan en el
  calendario de México, a la misma hora del envío (sin festivos todavía).
- WhatsApp permanece apagado hasta contar con proveedor y reglas aprobadas.
- Correo entra por webhook del proveedor; no usar polling.
- **Quién es la misma persona: "el correo manda"** (decidido 2-oct-2026, regla en
  `src/shared/identidad.ts`, la usan n8n y el CRM).
  - Si el prospecto trae correo, solo el correo identifica. Mismo teléfono con otro correo (el
    conmutador de una empresa) es **otra persona**, en la empresa del dueño de ese teléfono, y el
    teléfono no se le vuelve a guardar.
  - Sin correo, identifica el teléfono, guardado como `telefono` o como `whatsapp`.
  - Antes era "correo o teléfono, el primero que coincida", y dos personas del mismo conmutador
    quedaban fundidas en una. `POST /automatizacion/prospectos` responde además
    `empresa_reutilizada`.
- **La baja es de la persona y no se deshace** (2-oct-2026, ver B2 "La baja manda").
  - Una baja, por respuesta o por evento de SendGrid, pasa a `baja` a **todos** los prospectos de
    la persona, y un prospecto nuevo de alguien dado de baja **nace en baja**.
  - `POST /prospectos/estado` y `POST /validaciones` no tocan a un prospecto en baja. Responden
    200 con `en_baja: true`; `validaciones` responde además `valido: false` con el motivo
    `prospecto_en_baja`, así PT1 toma su rama de exclusión.
  - `POST /tareas` no crea seguimientos para alguien en baja: responde 200 con `id: null` y
    `omitida: "prospecto_en_baja"`.
  - Ningún caso es un error, así que nada cae al Error Workflow.

## B3 Webhook de reingreso

Decisión (10-sep-2026): **un solo webhook**, no tres. `OutboxDispatcherService` (API) entrega todo tipo de evento saliente a una única `N8N_WEBHOOK_URL`, con el tipo de evento dentro del body:

```json
{
  "evento_uuid": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "tipo": "tarea_cerrada",
  "entidad_tipo": "tarea",
  "entidad_id": 3,
  "payload": { "...": "..." }
}
```

Construir en n8n:

- Un único nodo Webhook (`/webhook/v1/entrada` o el path que se defina), con auth por header (`X-API-Key` contra `WEBHOOK_ENTRADA_API_KEY`).
- Justo después, un nodo **Switch** (o varios **IF**) que lea `{{$json.tipo}}` y branchee: `tarea_cerrada`, `prospecto_clasificado`, y los que se agreguen después (reactivación, etc.).

No se construyen `/webhook/v1/reingreso-validacion`, `/webhook/v1/reingreso-clasificacion` ni `/webhook/v1/reactivacion` por separado — quedan reemplazados por el branching interno de este único webhook. El despachador de la API no cambia para acomodar esto (ya lo hacía así).

**🔴 Confirmado roto en producción hoy (22-sep-2026, `/grill-me`):** `N8N_WEBHOOK_URL` no está
configurada en Cloud Run (`gcloud run services describe nanobridge-api ... | grep -i webhook`
solo muestra `WEBHOOK_ENTRADA_API_KEY`, nada de `N8N_WEBHOOK_URL`). Esto no es solo "B3 no está
construido en n8n" — significa que **cada evento que ya se está encolando en producción hoy**
(`tarea_cerrada` al cerrar una tarea del CRM, `prospecto_clasificado` al clasificar,
`tarea_sla_vencida`, `documento_pendiente_revision`) agota sus 3 reintentos y cae en
`procesos_fallidos` sin que nada lo entregue a n8n. **Verificado 22-sep-2026:
`procesos_fallidos` está vacía (`SELECT COUNT(*), tipo FROM procesos_fallidos GROUP BY tipo`
→ `Empty set`) — no hay tráfico real todavía, así que el hueco no ha perdido datos reales,
pero sigue sin cerrarse. (Desde el 23-sep-2026 la tabla tiene 2 filas, ids 1 y 2, pero ambas
son de las pruebas de B4, no eventos del outbox.) No configurar `N8N_WEBHOOK_URL` hasta que el nodo Webhook + Switch de
este apartado exista de verdad en n8n — apuntarlo a una URL que no procesa el body
correctamente sería peor que dejarlo sin configurar.

**Idempotencia (cerrado 22-sep-2026, era un hueco real, no solo documental):**
el despachador ahora manda `evento_uuid` (UUID generado al encolar el evento,
columna `eventos_pendientes.evento_uuid`) en la raíz del body de cada
entrega. Cierra el caso donde la entrega a n8n tiene éxito pero el `UPDATE`
que marca el evento `enviado` falla en la propia API: el evento se
reintenta y se reenvía, pero ahora con el mismo `evento_uuid` — el nodo de
n8n debe deduplicar por esa clave (no por `entidad_id` + `tipo`, que se
repite en reactivaciones legítimas del mismo prospecto/tarea).

## B4 Error Workflow

- Capturar `execution_id`, workflow, nodo, endpoint, código HTTP y mensaje.
- Registrar incidencia por API.
- Si el fallo es crítico, crear `procesos_fallidos`.
- Si es accesorio, continuar y dejar trazabilidad.

**✅ B4 completado (14-sep-2026).** `POST /api/v1/automatizacion/errores-workflow` hace "registrar incidencia" + "crear `procesos_fallidos` si es crítico" en una sola llamada atómica (una transacción), en vez de dos llamadas condicionales separadas. Idempotente por `execution_id` (obligatorio en este endpoint, a diferencia del resto de incidencias).

**✅ Lado n8n completado y probado de punta a punta (23-sep-2026).**

Decisiones de diseño (`/grill-me`, 23-sep-2026):

1. **Reintentos en el nodo, no en el Error Workflow.** Cada nodo de "PT1. ingesta y scoring"
   que llama a la API tiene `Retry On Fail` = 3 intentos con 5 s entre cada uno (HTTP Request1,
   Validaciones, HTTP Request6, HTTP Request3, Consultar campaña actual, Marcar prospecto
   inactivo por campaña, HTTP Request5, HTTP Request4, Tareas, HTTP Request2). Excepción: el
   nodo de Gemini, que tiene su propio ciclo. Así los errores pasajeros (Cloud Run arrancando,
   un 500 momentáneo) se resuelven solos. Es seguro repetir estas llamadas: los endpoints que
   crean registros son idempotentes por `execution_id`, y los que cambian estado solo lo vuelven
   a poner igual. El Error Workflow **no** relanza ejecuciones: lo que sobrevive a 3 intentos
   casi seguro no es pasajero, y una persona decide si le da "Retry" desde n8n.
2. **Todo lo que llega al Error Workflow es crítico** (`critico: true` → incidencia +
   `procesos_fallidos`). El Webhook contesta 202 antes de procesar, así que cualquier fallo a
   medio flujo deja un prospecto atorado. Lo accesorio (ej. registrar la incidencia de Gemini)
   ya está configurado con `On Error = Continue` y nunca llega aquí.
3. **Un solo Error Workflow global**, `B4 · Error Workflow global` (n8n id
   `pL9iXvgOB7cSgTNJ`, **publicado**; no despublicar, porque es la red de seguridad y no tiene
   ninguna entrada pública). Cada workflow nuevo solo necesita elegirlo en Settings → Error
   Workflow. "PT1. ingesta y scoring" ya lo tiene.
4. **Sin aviso por ahora:** alguien revisa la bandeja `GET /api/v1/procesos-fallidos`
   (solo administrador). Agregar aviso por correo al Error Workflow cuando SendGrid esté
   conectado.

Estructura: `Error Trigger` → Code `armar reporte de error` (arma `execution_id`, `workflow`,
`nodo`, `codigo_http`, `mensaje`, `critico: true` y `detalle` con el link de la ejecución)
→ HTTP `registrar error en API` (`POST /automatizacion/errores-workflow`, credencial
`Nanobridge-ApiKey`, Retry On Fail 3×5 s). No manda `prospecto_id`: el Error Trigger no lo
trae; se encuentra abriendo `detalle.execution_url`.

Un "Retry" manual en n8n crea una ejecución con **otro** `execution_id`, así que un paso que sí
alcanzó a guardarse antes de fallar puede repetirse. Lo peligroso (mandarle dos correos a la
misma persona) ya lo bloquea la política de contactos por persona; lo demás (una fila de
scoring o de auditoría repetida) es inofensivo.

**Cómo probarlo (n8n NO dispara el Error Workflow en ejecuciones manuales o de prueba, solo en
reales):** existe el workflow desechable `B4 · prueba de error` (Webhook `POST
/webhook/b4-prueba-error`, sin auth → GET a una ruta inexistente de la API → 404). Publicarlo,
dispararlo una vez y **despublicarlo enseguida** (su webhook es público y sin contraseña).
Prueba del 23-sep-2026: ejecución #102 falló con 404 → n8n disparó solo el Error Workflow
(ejecución #103) → incidencia id 3 + proceso fallido id 2.

Pendiente menor: los procesos fallidos 1 y 2 son de estas pruebas; marcarlos `resuelto`
(`PATCH /api/v1/procesos-fallidos/:id/estado`).

## Criterio de terminado

Un prospecto puede recorrer ingesta, validación, scoring, supresión, envío, respuesta, clasificación, seguimiento, reactivación y cierre sin MySQL directo, sin duplicados y sin perder errores.
