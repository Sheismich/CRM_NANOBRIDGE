# Plan definitivo de automatización n8n

## Regla central

n8n nunca accede a MySQL. Toda lectura y escritura pasa por la API HTTP.

## B0 Cerrar Parte 1

1. Persistir incidencias de scoring.
2. Persistir resultados de scoring.
3. Crear ventanas de espera al registrar envíos.
4. Probar la rama de exclusión.
5. Mover `execution_id` a la raíz del payload.
6. Implementar reintento explícito de Gemini.

## Reintento Gemini

- Máximo tres intentos.
- Esperas: 5 s, 30 s y 120 s.
- Desactivar `Retry On Fail` del nodo Gemini para no duplicar intentos.
- Si Gemini falla definitivamente, usar scoring por reglas.
- Registrar incidencia mediante API.
- Nunca enviar correo, teléfono, descripción libre o documentos a Gemini.

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

No conectar un nodo HTTP hasta que su endpoint pase pruebas contra el stub. El registro de una nueva supresión (`no_contactar`) no es parte de esta secuencia: se conecta en B2, al procesar una respuesta clasificada como negativa.

**✅ B1 completado del lado API (10-sep-2026).** Los 17 endpoints de `PLAN_API_DEFINITIVO.md` (incluyendo B2: Consulta de prospecto para scoring, Ventanas vencidas, Respuesta recibida, Respuesta clasificada) están construidos y probados.

**Estado real del lado n8n (workflow "PT1. ingesta y scoring", verificado 21-sep-2026 contra la API en producción y Gemini real, no contra el stub):**

1-2. Parámetros / Catálogos — no aplican a este workflow (no los usa).
3. Registro de prospecto — ✅ conectado y probado en real.
4. Validaciones — ✅ conectado y probado en real (21-sep-2026), ambas ramas: prospecto válido (sigue el flujo normal hacia Gemini/scoring) y prospecto excluido (sin giro/tamaño/medio de contacto activo → corta ahí, no gasta Gemini, decisión de diseño confirmada con Fabián).
5. Tareas — ✅ conectado y probado en real (incluye la rama de "2 intentos fallidos → tarea manual").
6. Scoring — ✅ conectado y probado en real, ambas ramas (Gemini exitoso y solo-reglas).
   **Verificado 22-sep-2026 contra el JSON exportado del workflow** (`/grill-me`, ya no es una
   suposición): el nodo "HTTP Request" (Gemini) tiene `onError: continueErrorOutput` → error
   branch entra a "reportar gemini" (IF `intento_gemini < 4`) → si aún quedan intentos, "Wait"
   con `[5,30,120][intento_gemini-1]` segundos → "Edit Fields" incrementa `intento_gemini` →
   reintenta. Con `intento_gemini` arrancando en 1, esto da exactamente 4 llamadas a Gemini
   (1 inicial + 3 reintentos) con el backoff 5s/30s/120s documentado abajo — la forma del loop
   es correcta. El nodo trae `waitBetweenTries: 2000` a nivel de nodo (residuo visible en el
   JSON exportado, solo tiene efecto si "Retry On Fail" está activado) — **verificado a mano en
   el editor de n8n (22-sep-2026): el toggle está apagado**, así que era un campo sin efecto,
   no un riesgo activo. Cierre completo: forma del loop correcta + Retry On Fail apagado.
7. Incidencias — conectado, pero sin probar en vivo todavía (Gemini no ha fallado en ninguna corrida real hasta ahora).
8. Consulta de supresión — no es un paso separado en este workflow: va integrado dentro de la verificación de envío (paso 9), por diseño.
9. Verificación de envío — ✅ conectado y probado en real.
10. Estado de prospecto — conectado, pero la rama de exclusión (`puede_enviar: false`) aún no se ha probado en vivo.
11. Campaña activa — ✅ conectado y probado en real (21-sep-2026), ambas ramas: campaña activa (llega hasta el envío real) y campaña finalizada (marca `estado: "inactivo"` con motivo).
12. Registro de envío — ✅ conectado y probado en real.

**Workflow intencionalmente en `active: false` (confirmado 22-sep-2026, `/grill-me`):** no
activar hasta reemplazar "MOCK · envio de campana (7)" con el nodo real de SendGrid (ver B2)
— activarlo hoy mandaría correos falsos (`proveedor_mensaje_id: "mock-msg-0001"`) a prospectos
reales.

## B2 Respuestas, clasificación y seguimiento

- Recibir respuestas desde webhook del proveedor de correo. **Proveedor: SendGrid (decidido 22-sep-2026, `/grill-me`)** — Inbound Parse para entrada (webhook nativo, cumple "no usar polling"), API transaccional para salida, nodo nativo en n8n. Reemplaza al nodo "MOCK · envio de campana (7)" del workflow "PT1" (que trae `proveedor: "pendiente_de_elegir"`) cuando se construya el envío real.
- Registrar respuesta mediante API.
- Clasificar con IA o enviar a cola manual: el nodo llama siempre al endpoint "Respuesta clasificada"; si la clasificación es ambigua, ese mismo endpoint crea una `tarea` con `tipo=clasificacion` (no hay tabla `cola_clasificacion` aparte), que aparece en la bandeja `GET /api/v1/cola-clasificacion` para que el Equipo CRM la resuelva.
- Procesar no interesado, baja, respuesta automática, ambigua e interesado.
- Cuando la clasificación es "baja" o "no_contactar", invocar el endpoint de registro de supresión.
- Recordatorios e inactividad son **una sola consulta con una rama, no dos mecanismos separados**
  (corregido 22-sep-2026, hallazgo de `/grill-me`): n8n hace polling de
  `GET /automatizacion/envios/vencidas` (ver `automatizacion.service.ts:670-679`); cada fila
  trae `es_ultimo_contacto`. Si es `false`, n8n manda el siguiente recordatorio (`POST /envios`);
  si es `true` (ya llegó a 3 contactos), n8n marca inactividad (`POST /prospectos/estado`) en vez
  de mandar otro. No hay que construir un job de "recordatorios" aparte de "ventanas vencidas".
- Procesar respuestas tardías: crear tarea comercial, no reiniciar automáticamente el outbound.

## Política de contactos

- Máximo tres contactos totales: envío inicial y dos recordatorios.
  **Se cuentan por persona (contacto), no por prospecto** (decidido 23-sep-2026): si la misma
  persona reingresa al flujo de ingesta, sus envíos anteriores cuentan. Tras **6 meses sin
  ningún contacto** puede arrancar un ciclo nuevo de 3. Lo aplica la API en
  `envios/verificacion`, `POST /envios` y `envios/vencidas`; n8n no necesita lógica extra.
- Cinco días hábiles de espera entre flujo y seguimiento (también por persona).
- WhatsApp permanece apagado hasta contar con proveedor y reglas aprobadas.
- Correo entra por webhook del proveedor; no usar polling.

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
pero sigue sin cerrarse. No configurar `N8N_WEBHOOK_URL` hasta que el nodo Webhook + Switch de
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

**🔴 URGENTE, sigue pendiente del lado n8n (elevado de prioridad 22-sep-2026, `/grill-me`):**
apuntar el nodo del Error Trigger global a este endpoint. Esto no es la red de seguridad de un
solo workflow, es la de **todos** — mientras no esté conectado, cualquier fallo real en
cualquier nodo de cualquier workflow de n8n (incluyendo "PT1. ingesta y scoring") no genera
incidencia ni `procesos_fallidos`: se pierde sin dejar rastro, sin que nadie se entere hasta
que un prospecto se pierde silenciosamente en algún punto del flujo.

## Criterio de terminado

Un prospecto puede recorrer ingesta, validación, scoring, supresión, envío, respuesta, clasificación, seguimiento, reactivación y cierre sin MySQL directo, sin duplicados y sin perder errores.
