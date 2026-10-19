# PT2a · sugerencia de clasificación con IA

Código de los nodos Code del subflujo **PT2a. sugerencia IA** y del nodo nuevo de PT2. n8n no
vive en git: esta carpeta es la copia de referencia. Si se cambia el código en n8n, se cambia aquí
también.

Diseño y reglas: `docs/planes/PLAN_N8N_DEFINITIVO.md`, B2, "Clasificación con IA: modo sugerencia
primero" (punto 4: interruptor `IA_MODO` y candados de privacidad).

## Cómo queda

```
PT2:  … → Registrar respuesta → ¿Avisar al supervisor? → … → Responder 200
                                                              → Datos para IA (0)
                                                              → Sugerencia IA (subflujo, sin esperar)

PT2a: When Executed by Another Workflow → Preparar texto para IA (1) → ¿Pedir sugerencia?
        → Gemini clasificar → Leer sugerencia (2) → Guardar sugerencia → Revisar guardado (3)
```

- PT2 **no espera** a PT2a: lo que pase con Gemini no cambia lo que PT2 le contesta a SendGrid.
- Si Gemini falla o contesta algo raro, PT2a se detiene sin error; la tarea ya está en la cola.
- Si la API rechaza la sugerencia con algo distinto de 409, "Revisar guardado" falla y B4 avisa.
- `IA_MODO` está arriba del archivo 1: `pruebas` (de inicio), `abierto`, `apagado`.

## Archivos

| Archivo | Nodo |
|---|---|
| `0-pt2-datos-para-ia.js` | PT2 · "Datos para IA" |
| `1-preparar-texto-para-ia.js` | PT2a · "Preparar texto para IA" |
| `2-leer-sugerencia.js` | PT2a · "Leer sugerencia" |
| `3-revisar-guardado.js` | PT2a · "Revisar guardado" |
