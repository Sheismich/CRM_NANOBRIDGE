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
7. Incidencias — conectado, pero sin probar en vivo todavía (Gemini no ha fallado en ninguna corrida real hasta ahora).
8. Consulta de supresión — no es un paso separado en este workflow: va integrado dentro de la verificación de envío (paso 9), por diseño.
9. Verificación de envío — ✅ conectado y probado en real.
10. Estado de prospecto — conectado, pero la rama de exclusión (`puede_enviar: false`) aún no se ha probado en vivo.
11. Campaña activa — ✅ conectado y probado en real (21-sep-2026), ambas ramas: campaña activa (llega hasta el envío real) y campaña finalizada (marca `estado: "inactivo"` con motivo).
12. Registro de envío — ✅ conectado y probado en real.

## B2 Respuestas, clasificación y seguimiento

- Recibir respuestas desde webhook del proveedor de correo. Proveedor de correo (entrada y salida) pendiente de decidir.
- Registrar respuesta mediante API.
- Clasificar con IA o enviar a cola manual: el nodo llama siempre al endpoint "Respuesta clasificada"; si la clasificación es ambigua, ese mismo endpoint crea una `tarea` con `tipo=clasificacion` (no hay tabla `cola_clasificacion` aparte), que aparece en la bandeja `GET /api/v1/cola-clasificacion` para que el Equipo CRM la resuelva.
- Procesar no interesado, baja, respuesta automática, ambigua e interesado.
- Cuando la clasificación es "baja" o "no_contactar", invocar el endpoint de registro de supresión.
- Programar recordatorios.
- Marcar inactividad (ventanas vencidas).
- Procesar respuestas tardías: crear tarea comercial, no reiniciar automáticamente el outbound.

## Política de contactos

- Máximo tres contactos totales: envío inicial y dos recordatorios.
- Cinco días hábiles de espera entre flujo y seguimiento.
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

**✅ B4 completado (14-sep-2026).** `POST /api/v1/automatizacion/errores-workflow` hace "registrar incidencia" + "crear `procesos_fallidos` si es crítico" en una sola llamada atómica (una transacción), en vez de dos llamadas condicionales separadas. Idempotente por `execution_id` (obligatorio en este endpoint, a diferencia del resto de incidencias). Pendiente del lado n8n: apuntar el nodo del Error Trigger global a este endpoint.

## Criterio de terminado

Un prospecto puede recorrer ingesta, validación, scoring, supresión, envío, respuesta, clasificación, seguimiento, reactivación y cierre sin MySQL directo, sin duplicados y sin perder errores.
