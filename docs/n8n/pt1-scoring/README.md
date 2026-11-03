# PT1 · score del prospecto

Cómo califica **PT1. ingesta y scoring** a un prospecto. n8n no vive en git: esta carpeta es la
copia de referencia, leída del workflow publicado el 3-nov-2026. Si se cambia en n8n, se cambia aquí
también.

Diseño y pendientes: `docs/planes/PLAN_N8N_DEFINITIVO.md` (punto 8: con un mes de datos reales,
revisar si la prioridad "alta" de verdad responde más y, si no, ajustar el peso de Gemini).

## Puntos por reglas (nodo "combinar score")

El respaldo "scoring por reglas 5b" usa los mismos valores. Máximo 100.

| Concepto | Puntos |
|---|---|
| Tamaño | grande 40, mediana 30, pequena 20, micro 10 |
| Giro | tecnologia 30, manufactura 25, logistica 25, financiero 20, servicios 20, salud 15, construccion 15, agroindustria 15, comercio 10, educacion 10, otro 5 |
| Tiene correo | +10 |
| Tiene teléfono | +10 |
| Tiene región | +10 |

Un tamaño o giro que no esté en la lista vale 0. El giro se pasa a minúsculas y sin acentos antes
de buscarlo; el tamaño no, pero la base solo acepta `micro`, `pequena`, `mediana` y `grande`, que es
justo lo que la API le manda a n8n.

## Mezcla con Gemini

- Gemini contesta bien: `score_final = round(reglas × 0.4 + score_ia × 0.6)`, 40 % reglas y 60 %
  Gemini. En el código los pesos están marcados como provisionales.
- Gemini falla (4 intentos, con esperas de 5, 30 y 120 s) o contesta en un formato no válido: el
  score es 100 % reglas y se registra la incidencia `gemini_agotado`. En `resultados_scoring`,
  `metodo` queda en `gemini` o `reglas`.

## Prioridad

| Score | Prioridad |
|---|---|
| 70 o más | alta |
| 40 a 69 | media |
| menos de 40 | baja |

## Modelo

`gemini-3.6-flash` (nodo "HTTP Request", `v1beta/models/gemini-3.6-flash:generateContent`). PT2a
usa el mismo. El CRM (borrador de respuesta y resumen de la ficha) usa `gemini-3.8-flash`
(`GEMINI_MODELO` en Cloud Run).

## Prompt (nodo "preparar solicitud", sin cambios)

```
Eres un asistente de calificación de leads B2B.
Con base en estos datos de una empresa prospecto, calcula un score de 0 a 100
y explica los factores que lo justifican.

Datos: ${JSON.stringify(datosParaIA)}
```

`datosParaIA` es un JSON con `giro`, `tamano` y `region` (o `null` si no hay región). A Gemini no le
llegan nombre, correo ni teléfono. Se le pide responder en JSON con `score_ia` (número), `confianza`
(número) y `factores` (con `giro` y `tamano` como texto).
