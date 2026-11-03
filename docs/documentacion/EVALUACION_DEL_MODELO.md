# Evaluación del modelo · CRM NANOBRIDGE

**Entregable:** red neuronal evaluada (OB-04), proyecto naranja · outbound.
**Para:** revisión G4 · CDR (semana 10, 2-6 nov 2026). **Redacta:** T1 · **Revisión:** T2 (dueño de los flujos de n8n) y Dirección General.
**Versión:** 0.9 · borrador con pendientes · 3 de noviembre de 2026.

Este documento dice qué modelo usa el proyecto, para qué, con qué datos, quién revisa lo que propone, cómo se mide
si funciona y qué resultados hay hoy. Todo lo marcado **⏳ T2** lo tiene que confirmar Fabián: no está escrito en el
repositorio y aquí no se supone.

## 1. Qué modelo es

El proyecto **no entrena una red neuronal propia**. Usa **Gemini**, el modelo de lenguaje de Google (una red neuronal
ya entrenada), por medio de su API y en el plan de pago (Google no usa los datos para entrenar; confirmado el
19-oct-2026). Se usa en cuatro lugares:

| # | Uso | Quién lo llama | Qué propone la IA | Quién decide | Modelo y versión | Estado |
|---|---|---|---|---|---|---|
| 1 | **Calificar al prospecto** (score 0-100, prioridad y confianza) | n8n, PT1 | El score de cada prospecto antes del primer correo | Nadie lo revisa uno por uno: el score ordena y prioriza, no decide a quién se le escribe | ⏳ T2 | Probado en vivo (16-oct) |
| 2 | **Sugerir la clasificación de una respuesta** (interesado, no interesado, baja, automática, ambigua) | n8n, PT2a | Una clasificación, su confianza (0-100) y el motivo | **Una persona**, en la cola de clasificación | ⏳ T2 (el mismo que PT1) | Publicado y probado en vivo (19-oct) |
| 3 | **Borrador de respuesta** al prospecto | CRM, botón en «Responder» | Un borrador del correo | **El vendedor**: lo edita o lo descarta y él lo manda | `gemini-3.8-flash` | En producción desde el 21-oct |
| 4 | **Resumen de la ficha** de una empresa | CRM, «Resumir con IA» | Un resumen del historial | **El vendedor** lo lee; no cambia nada en la base | `gemini-3.8-flash` | En producción desde el 21-oct |

Dirección aprobó los usos 2 a 4 (el 19 y el 21-oct), con el aviso de privacidad publicado.

## 2. Con qué datos trabaja

**Regla:** en el score, la clasificación y el resumen, a Gemini no le llegan correos, teléfonos ni documentos (control
`D-07` del reporte de controles). El borrador de respuesta es la excepción, decidida en P3.7
(`docs/planes/PREGUNTAS_ETAPAS_3_4_5.md`) y aprobada por Dirección el 21-oct con el aviso de privacidad.

| Uso | Qué le llega | Qué se quita antes |
|---|---|---|
| 1 · Score | Datos de la empresa y del puesto (giro, tamaño, región, puesto…); la API se los entrega a n8n sin correo ni teléfono | ⏳ T2: el texto exacto que arma n8n. Conviene copiar el prompt al repositorio, como ya se hizo con PT2a |
| 2 · Clasificación | Solo el texto de la respuesta, sin nombre ni empresa | Firma, correo citado, correos, enlaces, teléfonos y el nombre de la persona y de la empresa (código en `docs/n8n/pt2a-sugerencia-ia/`) |
| 3 · Borrador | Nombre del vendedor, nombre del cliente y de su empresa, giro, el correo que se le mandó y **su respuesta tal como llegó** | Montos y cotizaciones. **No se quitan** los correos o teléfonos que vengan dentro de la respuesta, por ejemplo en la firma (`510-responder-prospecto`) |
| 4 · Resumen | Historial de la empresa (actividades, oportunidades, tareas) | Correos, teléfonos y nombres de archivo (`515-resumen-ficha`, `530-historial-documentos`) |

## 3. Revisión humana

- **Score:** si Gemini falla, el score sale de reglas (0 a 100) y queda la incidencia `gemini_agotado`; nadie sale
  castigado. El score combina Gemini (peso 60 %) con reglas. ⏳ T2: la fórmula de las reglas y cómo se combinan.
- **Clasificación:** la IA está en **modo sugerencia**. Cada respuesta entra a la cola y una persona la confirma o la
  cambia. La API guarda la sugerencia aparte (`clasificacion_sugerida`, `confianza_sugerida`, `motivo_sugerencia`) y
  no cambia estados, ni suprime, ni cierra tareas por ella. Pasar a **modo directo** es una decisión aparte de
  Dirección (§6).
- **Borrador y resumen:** el vendedor siempre ve el texto antes de usarlo. Cada persona tiene un límite de 20
  borradores y 20 resúmenes al día.

## 4. Cómo se mide

**Métrica aprobada en G3: ⏳ T2.** El programa pide evaluar el modelo con la métrica que se aprobó en G3, y en el
repositorio no está escrita. Mientras se confirma, estas son las métricas que se pueden calcular **con lo que la base
ya guarda**, sin agregar nada:

| ID | Métrica | Cómo se calcula | Uso |
|---|---|---|---|
| M1 | **Acuerdo IA-persona** en la clasificación | Respuestas en que la clasificación final es igual a la sugerida, entre las que tienen sugerencia y ya se clasificaron (`respuestas.clasificacion` contra `clasificacion_sugerida`). También por clase | 2 |
| M2 | **Bajas que la IA no vio** | Respuestas clasificadas `baja` por la persona que la IA sugirió como otra cosa. Es el error caro: en modo directo, esa persona seguiría recibiendo correos | 2 |
| M3 | **¿La prioridad predice la respuesta?** | Tasa de respuesta y de interesados de los prospectos con prioridad alta, media y baja. Sirve si alta > media > baja | 1 |
| M4 | **Disponibilidad** | Proporción de scores calculados por reglas (`resultados_scoring.metodo = reglas`) e incidencias `gemini_agotado` | 1 y 2 |
| M5 | **Uso del borrador** | Correos enviados desde el CRM tal cual, editados o sin IA (`correos_respuesta.uso_ia`) | 3 |

El resumen de la ficha (uso 4) no cambia datos ni decide nada; se mide por uso (`uso_ia`) y por lo que digan los
vendedores.

## 5. Resultados hasta hoy

**Todavía no hay una evaluación sobre una muestra.** La base actual es de ejemplo: 9 respuestas y unos 40 prospectos,
casi todos de las pruebas del equipo. Con eso no se puede medir nada que valga. Lo que sí hay son pruebas de que cada
pieza funciona:

| Fecha | Prueba | Resultado |
|---|---|---|
| 23-sep-2026 | Gemini apuntado a un modelo que no existe (PT1) | 4 fallos, 3 esperas, incidencia `gemini_agotado` y score por reglas: el prospecto siguió su camino |
| 16-oct-2026 | Un prospecto real de prueba sale de la fila y pasa por PT1 | Validado, score 47, correo recibido en Gmail |
| 19-oct-2026 | Respuesta tardía de prueba a PT2a | A Gemini llegó el texto con «[teléfono]» en lugar del número; sugirió «interesado», confianza 100; la cola lo mostró con su motivo |
| 21-oct-2026 | Llave de Gemini del CRM probada | Responde en unos 4 s; `gemini-2.5-flash` ya no se ofrece a llaves nuevas, por eso el CRM usa `gemini-3.8-flash` |

Pruebas automáticas (sin llamar a Gemini): `535-automatizacion-scoring-incidencias`, `220-sugerencia-clasificacion`,
`510-responder-prospecto`, `515-resumen-ficha`, `530-historial-documentos`.

**Plan para medir:**
1. **Semana 12 (prepiloto):** con la lista de Carlos cargada, calcular M4 y revisar a mano el score de una muestra de
   prospectos con T2.
2. **Piloto (30-nov al 4-dic):** cada respuesta real deja su sugerencia y la decisión de la persona. Calcular M1, M2 y
   M5 al terminar, y M3 con lo que haya.
3. **Reporte del piloto (OB-06, 11-dic):** resultados con el número de casos. Con 6 o 7 correos nuevos al día, en una
   semana habrá pocas respuestas: se reporta cuántas fueron y no se sacan conclusiones que los datos no aguanten.

## 6. Pasar la clasificación a modo directo

Es una decisión de Dirección, cuando la IA demuestre que acierta. **Propuesta, a decidir:** solo con un mínimo de
respuestas reales revisadas, un acuerdo alto (M1) y **ninguna baja sin ver (M2 = 0)**. El umbral lo fija Dirección con
T2. Mientras no se decida, sigue en modo sugerencia, y técnicamente el cambio es pequeño: n8n llama a otro endpoint,
que la API ya tiene listo y probado.

## 7. Límites y riesgos

- **Pocos datos:** el piloto es corto y de bajo volumen; los resultados serán indicativos.
- **El modelo cambia:** Google retira versiones (pasó con `gemini-2.5-flash`). Un cambio de versión puede cambiar las
  respuestas; hay que anotar la versión en cada evaluación. ⏳ T2: qué versión usa n8n.
- **Depende del prompt:** el de PT2a está en el repositorio; el de PT1, no (⏳ T2).
- **Idioma y estilo:** el modelo lee español informal, pero una respuesta corta o ambigua puede sugerirse mal; por eso
  existe «ambigua» y la revisión humana.
- **Si Gemini no responde:** el score sale por reglas y la respuesta se clasifica a mano. Nada se queda atorado.
- **Datos de contacto en el borrador:** la respuesta del cliente llega a Gemini completa, con su firma. Está aprobado,
  pero se podría aplicar la misma limpieza que en PT2a (quitar correos, teléfonos y firma) sin perder calidad en el
  borrador. Decisión de T1 y T2.

## 8. Pendientes para T2

1. La métrica aprobada en G3 (o confirmar que no se aprobó ninguna y que se usan las de §4).
2. La fórmula del score: las reglas y cómo se combinan con Gemini (60 %).
3. El modelo y la versión que usan PT1 y PT2a.
4. El prompt de PT1, copiado a `docs/n8n/` como el de PT2a.
5. Si ya hay resultados de alguna revisión hecha a mano, para agregarlos a §5.
6. Si el borrador de respuesta debe limpiar correos y teléfonos como PT2a (§7).

## Relacionado

- [`PLAN_N8N_DEFINITIVO.md`](../planes/PLAN_N8N_DEFINITIVO.md): «Reintento Gemini» y «Clasificación con IA: modo
  sugerencia primero».
- [Flujo de actualización](FLUJO_DE_ACTUALIZACION.md) (OB-03) · [Reporte de controles](REPORTE_DE_CONTROLES.md) ·
  [Bitácora](BITACORA.md).
