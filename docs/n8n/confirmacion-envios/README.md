# n8n: correo correcto, confirmación y escalar interesados (nov-2026)

La API ya elige a qué correo sale cada envío y guarda qué pasó con él. Faltan estos cambios en n8n.
Hasta hacerlos, los correos siguen saliendo igual, pero Estado del sistema marca "correos sin confirmar".

**Orden:** primero el deploy de la API con las migraciones 039 y 040. Luego los prompts 1 y 2. El 3 es opcional.

## Prompt 1 · PT1 y PT4: usar el destinatario de la API

Pégalo una vez en cada flujo.

> El nodo HTTP que hace POST a `/automatizacion/envios` ahora regresa `id` y `destinatario`. En el nodo que
> llama al subflujo PT1b, manda el campo `correo` con `destinatario` de esa respuesta, en vez del correo que
> venía antes. Agrega también el campo `envio_id` con el `id` de esa respuesta.

## Prompt 2 · PT1b: confirmar después de SendGrid

> En este subflujo, después del nodo que manda el correo a SendGrid:
>
> 1. Activa en ese nodo "Include Response Headers and Status" y "On Error: Continue (using error output)".
> 2. Si salió bien, agrega un nodo HTTP POST a
>    `{{URL de la API}}/api/v1/automatizacion/envios/{{ $json.envio_id }}/confirmacion`, con la misma
>    credencial X-API-Key de los demás nodos, y el cuerpo
>    `{ "estado": "enviado", "proveedor_id": <encabezado x-message-id de la respuesta de SendGrid> }`.
> 3. Si falló, llama a la misma URL con `{ "estado": "fallido", "error": <mensaje del error, máximo 300 caracteres> }`
>    y después agrega un nodo Stop and Error con ese mismo mensaje, para que el Error Workflow siga avisando.

## Prompt 3 · PT5 (opcional): escalar a las 24 horas

Sin este prompt el escalamiento corre cada mañana a las 7:00. Un interesado del lunes a las 10:00 se
escala hasta el miércoles a las 7:00.

> Agrega al flujo PT5 un disparador nuevo, cada hora en punto, de lunes a viernes de 9:00 a 18:00 hora de
> México. Debe hacer un POST a `{{URL de la API}}/api/v1/automatizacion/jobs/escalar-interesados` con la misma
> credencial X-API-Key de los demás trabajos. No debe llamar a los otros trabajos.

## Cómo probarlo

Con `MODO_PRUEBAS` prendido y la siguiente dirección `+prueba` libre:

1. El correo llega a la dirección que trae `destinatario`.
2. En la tabla `envios`, la fila queda con `estado = 'enviado'` y `proveedor_id` lleno.
3. Administración → Estado del sistema no marca correos sin confirmar.
