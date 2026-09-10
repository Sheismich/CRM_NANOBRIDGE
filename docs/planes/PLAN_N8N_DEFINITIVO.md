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

Idempotencia: por ahora el despachador no manda un `evento_id` explícito en el body (usa `entidad_id` + `tipo` + timestamp del payload); si n8n necesita deduplicar del lado de la clasificación por sí mismo, puede usar `entidad_id` + `tipo` como clave.

## B4 Error Workflow

- Capturar `execution_id`, workflow, nodo, endpoint, código HTTP y mensaje.
- Registrar incidencia por API.
- Si el fallo es crítico, crear `procesos_fallidos`.
- Si es accesorio, continuar y dejar trazabilidad.

## Criterio de terminado

Un prospecto puede recorrer ingesta, validación, scoring, supresión, envío, respuesta, clasificación, seguimiento, reactivación y cierre sin MySQL directo, sin duplicados y sin perder errores.
