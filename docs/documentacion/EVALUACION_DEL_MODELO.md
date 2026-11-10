# Evaluación del modelo · CRM NANOBRIDGE

**Entregable:** red neuronal evaluada (OB-04), proyecto naranja · outbound.
**Para:** revisión G4 · CDR (semana 10, 2-6 nov 2026). **Redacta:** T1 · **Revisión:** T2 (dueño de los flujos de n8n) y Dirección General.
**Versión:** 1.0 · 3 de noviembre de 2026 (la 0.9 del mismo día dejaba pendientes que T2 contestó ese día).

Este documento dice qué modelo usa el proyecto, para qué, con qué datos, quién revisa lo que propone, cómo se mide
si funciona y qué resultados hay hoy. Lo que viene de n8n (fórmula, modelo, prompt, horarios) lo confirmó T2 el
3-nov; el detalle de PT1 está en [`docs/n8n/pt1-scoring/`](../n8n/pt1-scoring/README.md).

## 1. Qué modelo es

El proyecto **no entrena una red neuronal propia**. Usa **Gemini**, el modelo de lenguaje de Google (una red neuronal
ya entrenada), por medio de su API y en el plan de pago (Google no usa los datos para entrenar; confirmado el
19-oct-2026). Se usa en cuatro lugares:

| # | Uso | Quién lo llama | Qué propone la IA | Quién decide | Modelo y versión | Estado |
|---|---|---|---|---|---|---|
| 1 | **Calificar al prospecto** (score 0-100, prioridad y confianza) | n8n, PT1 | El score de cada prospecto antes del primer correo | Nadie lo revisa uno por uno: el score ordena y prioriza, no decide a quién se le escribe | `gemini-3.6-flash` | Probado en vivo (16-oct) |
| 2 | **Sugerir la clasificación de una respuesta** (interesado, no interesado, baja, automática, ambigua) | n8n, PT2a | Una clasificación, su confianza (0-100) y el motivo | **Una persona**, en la cola de clasificación | `gemini-3.6-flash` | Publicado y probado en vivo (19-oct) |
| 3 | **Borrador de respuesta** al prospecto | CRM, botón en «Responder» | Un borrador del correo | **El vendedor**: lo edita o lo descarta y él lo manda | `gemini-3.8-flash` | En producción desde el 21-oct |
| 4 | **Resumen de la ficha** de una empresa | CRM, «Resumir con IA» | Un resumen del historial | **El vendedor** lo lee; no cambia nada en la base | `gemini-3.8-flash` | En producción desde el 21-oct |

Dirección aprobó los usos 2 a 4 (el 19 y el 21-oct), con el aviso de privacidad publicado.

## 2. Con qué datos trabaja

**Regla:** a Gemini no le llegan correos, teléfonos ni documentos (control `D-07` del reporte de controles). En el
borrador de respuesta, la limpieza está en producción desde el 3-nov (`nanobridge-api-00045-dfv`); antes, la respuesta
del cliente le llegaba completa, como se decidió en P3.7 (`docs/planes/PREGUNTAS_ETAPAS_3_4_5.md`).

| Uso | Qué le llega | Qué se quita antes |
|---|---|---|
| 1 · Score | **Solo giro, tamaño y región** | Todo lo demás: ni nombre, ni empresa, ni correo, ni teléfono. Prompt en [`docs/n8n/pt1-scoring/`](../n8n/pt1-scoring/README.md) |
| 2 · Clasificación | Solo el texto de la respuesta, sin nombre ni empresa | Firma, correo citado, correos, enlaces, teléfonos y el nombre de la persona y de la empresa (código en `docs/n8n/pt2a-sugerencia-ia/`) |
| 3 · Borrador | Nombre del vendedor, nombre del cliente y de su empresa, giro, el correo que se le mandó y su respuesta | Montos y cotizaciones; desde el 3-nov, también los correos y teléfonos que vengan en la respuesta, que se cambian por `[correo]` y `[teléfono]` con la misma función del resumen (`sinDatosDeContacto`, `src/shared/texto.ts`) |
| 4 · Resumen | Historial de la empresa (actividades, oportunidades, tareas) | Correos, teléfonos y nombres de archivo (`515-resumen-ficha`, `530-historial-documentos`) |

## 3. Revisión humana

- **Score:** se combina con reglas, que valen hasta 100 puntos:

  | Dato | Puntos |
  |---|---|
  | Tamaño | grande 40 · mediana 30 · pequeña 20 · micro 10 |
  | Giro | tecnología 30 · manufactura y logística 25 · financiero y servicios 20 · salud, construcción y agroindustria 15 · comercio y educación 10 · otro 5 |
  | Tiene correo · tiene teléfono · tiene región | +10 cada uno |

  **Score final = redondeo de (reglas × 0.4 + Gemini × 0.6).** Los pesos están marcados como provisionales. Si Gemini
  falla después de 4 intentos o contesta algo inválido, el score es 100 % reglas y queda la incidencia
  `gemini_agotado`; nadie sale castigado. **Prioridad:** alta con 70 o más, media de 40 a 69, baja con menos de 40.
- **Clasificación:** la IA está en **modo sugerencia**. Cada respuesta entra a la cola y una persona la confirma o la
  cambia. La API guarda la sugerencia aparte (`clasificacion_sugerida`, `confianza_sugerida`, `motivo_sugerencia`) y
  no cambia estados, ni suprime, ni cierra tareas por ella. Pasar a **modo directo** es una decisión aparte de
  Dirección (§6).
- **Borrador y resumen:** el vendedor siempre ve el texto antes de usarlo. Cada persona tiene un límite de 20
  borradores y 20 resúmenes al día.

## 4. Cómo se mide

**En G3 no se aprobó ninguna métrica por escrito** (confirmado por T2 el 3-nov). Se adoptan estas cinco: las propuso
T1, T2 las aceptó el 3-nov y revisó que se calculan **con lo que la base ya guarda**, sin agregar nada. Falta
registrar la decisión de Dirección (bitácora, §5).

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
1. **Al cargar los contactos de Carlos:** calcular M4 y revisar a mano el score de una muestra de prospectos con T2.
2. **Operación real (envíos desde el 9-nov; el encendido se adelantó al 6-nov):** cada respuesta real deja su
   sugerencia y la decisión de la persona. `reporte-piloto.mjs` calcula M1 a M5 en cualquier momento, también por
   campaña.
3. **Reporte del piloto (OB-06, 4 y 11-dic):** resultados con el número de casos. Con hasta 10 correos nuevos al día
   habrá pocas respuestas: se reporta cuántas fueron y no se sacan conclusiones que los datos no aguanten.

## 6. Pasar la clasificación a modo directo

Es una decisión de Dirección, cuando la IA demuestre que acierta. **Propuesta, a decidir:** solo con un mínimo de
respuestas reales revisadas, un acuerdo alto (M1) y **ninguna baja sin ver (M2 = 0)**. El umbral lo fija Dirección con
T2. Mientras no se decida, sigue en modo sugerencia, y técnicamente el cambio es pequeño: n8n llama a otro endpoint,
que la API ya tiene listo y probado.

## 7. Límites y riesgos

- **Pocos datos:** el piloto es corto y de bajo volumen; los resultados serán indicativos.
- **El modelo cambia:** Google retira versiones (pasó con `gemini-2.5-flash`). Un cambio de versión puede cambiar las
  respuestas; hay que anotar la versión en cada evaluación. Hoy hay dos: n8n usa `gemini-3.6-flash` y el CRM,
  `gemini-3.8-flash`.
- **Depende del prompt:** los de PT1 y PT2a están en el repositorio (`docs/n8n/`). Si se cambian en n8n, se cambian ahí
  también.
- **Las reglas del score casi no distinguen por correo:** a la fila solo entran prospectos con correo, así que todos
  suman esos 10 puntos. Lo que separa a unos de otros es el tamaño, el giro y lo que diga Gemini. Conviene revisarlo
  junto con los pesos cuando haya datos (M3).
- **Un giro que no está en la lista vale 0 puntos.** El score solo reconoce los giros de la tabla de §3, escritos sin
  acentos ni mayúsculas. Si la lista de Carlos trae giros con otras palabras («Industria manufacturera»), esos
  prospectos pierden hasta 30 puntos por reglas. Al cargarla, revisar los giros contra esa tabla (la auditoría de datos
  ya lista los giros en uso) o normalizarlos (control propuesto G-02).
- **Idioma y estilo:** el modelo lee español informal, pero una respuesta corta o ambigua puede sugerirse mal; por eso
  existe «ambigua» y la revisión humana.
- **Si Gemini no responde:** el score sale por reglas y la respuesta se clasifica a mano. Nada se queda atorado.
- **Datos de contacto en el borrador:** resuelto y en producción el 3-nov (§2).

## 8. Pendientes

1. **Registrar con Dirección** las cinco métricas de §4 y el criterio para pasar a modo directo (§6).
2. **Revisar los pesos del score** (40 % reglas, 60 % Gemini) con los datos del piloto (M3).
3. **Resultados sobre muestra:** salen del piloto y van en el reporte OB-06 (§5).

## Relacionado

- [`PLAN_N8N_DEFINITIVO.md`](../planes/PLAN_N8N_DEFINITIVO.md): «Reintento Gemini» y «Clasificación con IA: modo
  sugerencia primero».
- [Flujo de actualización](FLUJO_DE_ACTUALIZACION.md) (OB-03) · [Reporte de controles](REPORTE_DE_CONTROLES.md) ·
  [Bitácora](BITACORA.md).
