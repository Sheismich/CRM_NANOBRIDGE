# Respaldo de los flujos de n8n

Copia de los 9 flujos activos de n8n, exportados el 23-nov-2026 (#7 de la revisión del 20-nov). n8n sigue siendo
donde corren; esto es el respaldo y la referencia para ver cómo están sin entrar a n8n.

**El repo es público:** estos archivos están limpios (ver "Qué se tapó"). Nunca subas un export de n8n sin pasarlo
por `limpiar-n8n.mjs`.

## Los flujos

| Archivo | Flujo en n8n | ID | Cuándo corre | Qué hace | Publicado |
|---|---|---|---|---|---|
| `pt1a-tomar-de-la-fila.json` | PT1a. tomar de la fila | `mYFI6MsAUcuvsDte` | L-V 10:00 | Pide a la API hasta **75** prospectos de la fila (`limite: 75`) y llama a PT1 con cada uno | 23-nov-2026 |
| `pt1-ingesta-y-scoring.json` | PT1. ingesta y scoring | `YnDrrDHOC5HJlYtv` | La llama PT1a | Valida, calcula el score (Gemini + reglas), revisa campaña y manda el primer correo con PT1b | 6-nov-2026 |
| `pt1b-enviar-correo-sendgrid.json` | PT1b. enviar correo (SendGrid) | `mmoychzdaYH4yp1w` | La llaman PT1 y PT4 | Manda el correo por SendGrid y confirma a la API si salió o falló | 23-nov-2026 |
| `pt2-respuestas-inbound-parse.json` | PT2. respuestas (Inbound Parse) | `qECqDm8BIWQxx68L` | Webhook `sendgrid/inbound` (con usuario y contraseña) | Registra la respuesta del prospecto, avisa por correo y pide la sugerencia de IA a PT2a | 18-nov-2026 |
| `pt2a-sugerencia-ia.json` | PT2a. sugerencia IA | `dc0Q0SG9Qo2R3yKv` | La llama PT2 | Quita datos personales, pide a Gemini una clasificación sugerida y la guarda | 6-nov-2026 |
| `pt3-eventos-sendgrid.json` | PT3. eventos SendGrid | `ywVSXVZlhxmTkcj5` | Webhook `sendgrid/eventos` (revisa la firma de SendGrid) | Bajas, quejas y rebotes duros a la lista de supresión. Desde el 20-nov los eventos llegan también directo a la API; **PT3 se apaga** cuando se confirme que ya no hace falta | 1-oct-2026 |
| `pt4-recordatorios.json` | PT4. recordatorios | `0ZkjfiUz0RlmOncj` | L-V 9:00 | Pide las ventanas vencidas (`limit=50`): manda el recordatorio o, si era el tercero, marca inactivo | 6-nov-2026 |
| `pt5-trabajos-diarios.json` | PT5. trabajos diarios | `4IQIBLu0PqQyJEQ8` | Diario 7:00, y cada hora de 9 a 18 L-V | Llama a los trabajos de la API (`/jobs/...`); cada hora, `escalar-interesados` | 6-nov-2026 |
| `b4-error-workflow-global.json` | B4 · Error Workflow global | `pL9iXvgOB7cSgTNJ` | Cuando falla otro flujo | Registra el error en la API y manda correo de alerta | 6-nov-2026 |

Horarios en hora de México (PT1a, PT4 y PT5 tienen la zona `America/Mexico_City`). Al exportar, en los 9 flujos
lo del editor era igual a lo publicado (`_respaldo.editor_igual_a_publicado`).

## Interruptores (23-nov-2026)

| Interruptor | Dónde | Valor | Qué significa |
|---|---|---|---|
| `MODO_PRUEBAS` | PT1 y PT4, nodo "Modo pruebas" | `false` | Se manda a cualquier prospecto. Con `true` solo a los correos de prueba |
| `SANDBOX` | PT1 y PT4, nodo "Modo pruebas" | `false` | SendGrid sí entrega. Con `true` acepta el correo pero no lo entrega |
| `IA_MODO` | PT2a, nodo "Preparar texto para IA" | `"abierto"` | La IA sugiere clasificación para todas las respuestas. `"pruebas"` = solo las de prueba; `"apagado"` = ninguna |

Si cambias alguno en n8n, actualiza esta tabla y vuelve a exportar el flujo.

## Qué se tapó

- **Correos:** los de prueba y los de las cuentas del equipo van como `<CORREO_PRUEBA_1>`, `<CORREO_PRUEBA_2>`,
  `<CORREO_ADMIN_1>`, `<CORREO_ADMIN_2>` y `<CORREO_DIRECCION>`. El valor real está en el flujo en n8n. Si
  reimportas un archivo, cámbialos antes de publicar.
- **Datos de n8n que no sirven para reimportar:** dueño, permisos, quién lo editó, datos de prueba fijados (estaban
  vacíos) y la copia duplicada de lo publicado.
- **Llaves:** no hay ninguna. Todas viven en las credenciales de n8n (`Nanobridge-ApiKey`, `SendGrid account`,
  `SendGrid Inbound Parse`, `Google Gemini(PaLM) Api account`); el archivo solo trae su nombre. La llave de PT3
  es la **pública** del Event Webhook de SendGrid: no es secreta.

Cada archivo trae al final `_respaldo` con la fecha de publicación, la versión y las credenciales que usa. n8n lo
ignora al importar.

## Cómo volver a exportar

1. En n8n, abre el flujo y **Publish** si tiene el punto naranja (cambios sin publicar).
2. **⋯ → Download**. Guárdalo fuera del repo (por ejemplo en `Descargas`).
3. Limpia con el script. `CORREOS_A_TAPAR` es un JSON **local, nunca en el repo**, con cada correo real y su
   marcador (`{ "correo@real": "<CORREO_ADMIN_1>" }`):
   ```
   CORREOS_A_TAPAR=C:/ruta/local/correos.json node docs/n8n/flujos/limpiar-n8n.mjs <carpeta de descargas> <carpeta temporal> "<archivo>.json"
   ```
   El script dice qué tapó y avisa de cualquier cosa que parezca llave ("REVISAR ..."). Las rutas de la API y la
   llave pública de PT3 salen como aviso y no son problema.
4. Revisa el aviso y copia el archivo limpio aquí. Actualiza la tabla de arriba si cambió algo.

## Cómo volver a importar

En n8n: **Create workflow → ⋯ → Import from File**. Después, en cada nodo con credencial, elige la credencial
(si no se enlaza sola), cambia los `<CORREO_...>` por los reales y publica. Un subflujo (PT1, PT1b, PT2a) se
publica antes que el flujo que lo llama.
