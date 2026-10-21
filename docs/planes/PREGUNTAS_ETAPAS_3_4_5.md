# Preguntas pendientes · Etapas 3, 4 y 5 de las mejoras del CRM

Escrito el 20-oct-2026. Estas preguntas **todavía no tienen respuesta, a propósito.** Las
contesta quien vaya a empezar cada etapa, antes de escribir código.

## Cómo usar este archivo

1. **Para contestar las preguntas de una etapa hay que hacer un plan primero.** Abre una sesión
   nueva de Claude Code en modo plan. Busca en el código los datos que haga falta y propón las
   respuestas en ese plan. Las decisiones las toman Fabián (y el jefe, donde se indica), no la IA.
2. Las preguntas van por **rondas**. Las de la ronda 2 dependen de lo que se conteste en la
   ronda 1, así que no se contestan antes.
3. La "Sugerencia" de cada pregunta es solo un punto de partida. No está decidida.
4. Las respuestas se escriben en el plan de la etapa. Ese plan define qué se construye.
5. Antes de empezar, revisa la sección "Antes de cualquier etapa", que aplica a las tres.

Contexto: estas etapas vienen después de la 1 (plantillas de correo, en producción) y la 2
(avisos con campanita y correo, código en `main`). La etapa 2 dejó lista la conexión directa con
SendGrid y Gemini en `src/integraciones/`, con `CorreoService` e `IaService`, cada uno con una
versión real y una falsa para pruebas. Las etapas 3 y 4 usan esa conexión.

Forma de trabajo de siempre: pruebas primero (TDD, MySQL real), luego la pantalla, luego el
deploy (**la migración va ANTES del deploy**) y una fila en RUNBOOK §6.

---

## Antes de cualquier etapa (aplica a 3 y 4)

❓ **P0.1 · Permiso de privacidad para usar IA con datos de clientes.** Dirección aprobó el 19-oct
la IA para clasificar respuestas en n8n (PT2). Las etapas 3 y 4 le mandan a Gemini más
información: nombres, lo que escribió el cliente, montos de cotizaciones. ¿Ese permiso cubre
también esto, o hay que pedirlo de nuevo? El aviso de privacidad sigue en revisión con Fabián.

> Sugerencia: pedirle al jefe un solo permiso que cubra las etapas 3 y 4 antes de empezarlas.

**RESUELTA (21-oct-2026):** Dirección aprobó usar Gemini en las etapas 3 y 4, con la condición
de que el aviso de privacidad lo mencione (anotado en PLAN_N8N_DEFINITIVO.md, "Base legal y aviso
de privacidad"). Se construye y se prueba normal; antes de encender `IA_DRIVER=gemini` con
clientes reales, el aviso de privacidad ya debe decirlo.

❓ **P0.2 · Llave de Gemini en Cloud Run.** Hoy la llave de Gemini solo está dentro de n8n. ¿Se usa
la misma o se crea una aparte para la API? Hay que guardarla como secreto `GEMINI_API_KEY`
(RUNBOOK §8b) y desplegar con `IA_DRIVER=gemini`.

> Sugerencia: una llave aparte para la API, del mismo proyecto de pago. Así se puede borrar una
> sin tumbar la otra.

❓ **P0.3 · Quién hace cada etapa y de quién son las pantallas.** Mich toma la etapa 3. Según el
reparto, la pantalla de Tareas es de Fabián y la ficha del cliente es de Mich. ¿Quién hace cada
pantalla de estas etapas? ¿Quién da el visto bueno y quién despliega?

---

## Etapa 3 · Responder al prospecto desde el CRM, con borrador de IA

**Qué es:** cuando un prospecto contesta un correo, el vendedor le responde desde el CRM, sin
irse a Gmail. Un botón "Redactar con IA" le propone el texto y él lo corrige antes de mandarlo.
El correo sale como "<vendedor> · NANOBRIDGE" desde `hola@contacto.nano-bridge-mex.com` y queda
en la misma conversación del cliente. Si el cliente vuelve a contestar, la respuesta regresa sola
al CRM por PT2.

**Datos ya revisados (20-oct):**
- La tabla `respuestas` guarda `contenido` (hasta 8000 caracteres), `remitente`, `envio_id` y
  `clasificacion`. **No guarda** `message_id` ni `asunto`, que hacen falta para que la respuesta
  quede en el mismo hilo. Se agregarían con una migración.
- Clasificaciones posibles: interesado, no_interesado, baja, automatica, ambigua, invalido y
  reagendar.
- Cuando un prospecto responde, deja de recibir recordatorios automáticos.
- `CorreoSaliente` (`src/integraciones/correo.types.ts`) ya acepta `nombreRemitente` y `replyTo`.
  Todavía no acepta las cabeceras `In-Reply-To`/`References` ni archivos adjuntos.
- La tarea que nace con un interesado se llama "Contactar prospecto interesado".
- **Falta confirmar en n8n:** que el nodo "Leer respuesta" de PT2 sí lea el Message-ID del correo.
  No está documentado en `docs/n8n/`.

### Ronda 1

❓ **P3.1 · ¿A qué respuestas se puede contestar?** ¿Solo a "interesado"? ¿También a "reagendar",
"ambigua" o "no_interesado" (por ejemplo, para agradecer)? A "baja" nunca.

> Sugerencia: interesado, reagendar y ambigua. A no_interesado no, para no insistir.

❓ **P3.2 · ¿Quién puede responder?** ¿Admin y supervisor siempre, y el agente solo si es dueño de
la empresa? ¿Y si la tarea nació sin asignar, porque la empresa no tiene dueño?

> Sugerencia: admin, supervisor o el responsable de la tarea "Contactar prospecto interesado".

❓ **P3.3 · Firma del vendedor.** ¿Con qué firma termina el correo? Opciones: texto fijo armado con
los datos del usuario (nombre, puesto, teléfono), una firma que cada usuario edita en su perfil,
o una firma que admin define por usuario.

> Sugerencia: armada sola con los datos del usuario y el pie de correo que ya existe
> (`pie_correo`, etapa 1).

❓ **P3.4 · ¿Con qué cuenta de SendGrid?** La cuenta definitiva tiene que estar antes del 24-nov
(RUNBOOK §10). ¿Se construye con la llave actual (la de la etapa 2) y se cambia después, o se
espera a la definitiva?

> Sugerencia: construir con la actual. Cambiarla después es solo cambiar el secreto.

❓ **P3.5 · ¿La respuesta manual cuenta como "contacto"?** La regla de hoy es de 3 contactos por
persona y 6 meses de espera. El plan dice que **no** cuenta y que no se guarda en `envios`.
¿Se confirma?

> Sugerencia: confirmar que no cuenta. Es una conversación que pidió el cliente, no prospección.

❓ **P3.6 · Adjuntos.** ¿El vendedor puede adjuntar archivos, por ejemplo una cotización en PDF?

> Sugerencia: no en esta etapa. Primero solo texto.

❓ **P3.7 · Qué ve la IA para hacer el borrador.** ¿Solo la respuesta del cliente, o también el
correo que se le mandó, el giro y lo que hay en la ficha (oportunidades, servicios)? Más
información da mejores borradores, pero manda más datos a Gemini (ver P0.1).

> Sugerencia: la respuesta del cliente, el correo que se le mandó, empresa, giro y nombre del
> vendedor. Sin montos.

### Ronda 2 (después de la ronda 1)

❓ **P3.8 · Qué pasa con la tarea al responder.** Al mandar la respuesta, ¿la tarea "Contactar
prospecto interesado" se cierra sola, queda abierta, o se le pregunta al vendedor?
*(Depende de P3.1 y P3.2.)*

❓ **P3.9 · Respuestas repetidas.** Si el cliente contesta otra vez y PT2 lo vuelve a clasificar
como interesado, ¿nace otra tarea? ¿Se suma a la que ya existe? ¿Solo llega aviso a la campanita
(etapa 2)? *(Depende de P3.8.)*

❓ **P3.10 · Tono y límites del borrador.** ¿Usted o tú? ¿Qué tan largo? ¿Qué no debe prometer
nunca la IA (precios, fechas, descuentos)? *(Depende de P3.7.)*

> Sugerencia: de usted, máximo 120 palabras, nunca precios ni fechas, y siempre lo revisa el
> vendedor antes de mandar.

❓ **P3.11 · Medir si sirve la IA.** ¿Se guarda si el vendedor mandó el borrador tal cual, lo
cambió o no usó la IA? Sirve para el informe y para saber si vale la pena.
*(Depende de P3.7 y P0.1.)*

❓ **P3.12 · Cuánto se puede usar.** ¿Hay límite de clics a "Redactar con IA" por usuario y por
día? Cada clic cuesta.

❓ **P3.13 · Dónde aparece.** ¿El botón "Responder" va en el detalle de la tarea, en la cola de
Tareas y también en la ficha del cliente? En el historial de la ficha (pantalla de Mich), ¿cómo
se ve el correo que se mandó? *(Depende de P0.3.)*

---

## Etapa 4 · Resumen con IA en la ficha del cliente

**Qué es:** un botón "Resumir con IA" en la pestaña Resumen de la ficha del cliente
(`FichaClientePage.tsx`). Lee lo que ha pasado con esa empresa (historial, oportunidades,
cotizaciones, últimas respuestas) y regresa un resumen de máximo 3 renglones y el siguiente paso
sugerido. Lo puede usar quien pueda ver la ficha (un agente, solo las suyas).

**Datos ya revisados (20-oct):**
- La ficha ya tiene las pestañas "Resumen" e "Historial". El historial sale de
  `ActividadesService.timeline()` (`src/crm/actividades.service.ts`).
- `IaService.generarJson()` ya existe y regresa JSON con forma fija.
- La pantalla de la ficha es de Mich.

### Ronda 1

❓ **P4.1 · ¿Dónde aparece?** ¿Solo en la ficha de la empresa, o también en cada oportunidad?

> Sugerencia: solo en la ficha por ahora.

❓ **P4.2 · ¿Se guarda el resumen?** Opciones: cada clic pregunta de nuevo (siempre al día, cuesta
cada vez); se guarda el último con su fecha y un botón "Actualizar"; o se guarda y se vuelve a
generar solo cuando hay movimientos nuevos.

> Sugerencia: guardar el último con su fecha y un botón "Actualizar".

❓ **P4.3 · Qué datos se le mandan a la IA.** ¿Incluye montos de cotizaciones, lo que escribió el
cliente y las notas internas de los vendedores? *(Ver P0.1.)*

> Sugerencia: todo menos las notas internas marcadas como privadas, si existen. Si no existen,
> decidir si las notas van.

❓ **P4.4 · Hasta dónde mira atrás.** ¿Todo el historial o solo los últimos N meses o los últimos N
movimientos? Una empresa con mucha historia puede ser demasiado texto.

> Sugerencia: los últimos 50 movimientos o los últimos 12 meses, lo que sea menos.

### Ronda 2

❓ **P4.5 · Empresa sin historial.** ¿Qué se muestra si no hay casi nada? ¿Se oculta el botón o se
muestra "Todavía no hay suficiente información"? *(Depende de P4.4.)*

❓ **P4.6 · Aviso de que es IA.** ¿Qué leyenda lleva? Por ejemplo, "Generado con IA, puede
equivocarse".

❓ **P4.7 · Quién hace la pantalla.** Es pantalla de Mich. ¿La hace ella, o la hace Fabián con su
visto bueno y nota en PLAN_FRONTEND.md? *(Depende de P0.3.)*

❓ **P4.8 · Límite de uso.** ¿Hay tope de resúmenes por usuario y por día? *(Depende de P4.2: si se
guarda, el tope importa menos.)*

---

## Etapa 5 · Buscador general (Ctrl+K)

**Qué es:** una caja de búsqueda arriba del menú (y Ctrl+K) que encuentra empresas, contactos,
oportunidades, cotizaciones y tareas, hasta 5 por grupo. Cada resultado lleva a su pantalla. Un
agente solo encuentra lo suyo, con las mismas reglas de cada lista.

**Datos ya revisados (20-oct):**
- Ya buscan por texto (`q`): empresas, contactos (incluye correo y teléfono), cotizaciones,
  tareas y el Registro de cambios.
- **Oportunidades no tiene búsqueda por texto todavía.**
- El menú (`Sidebar.tsx`) es de "Base común", que según el reparto es de Fabián.

### Ronda 1

❓ **P5.1 · Qué se busca.** Además de las 5 del plan, ¿también prospectos (que todavía no son
clientes)? ¿Documentos?

> Sugerencia: agregar prospectos. Es lo que más se busca en el día a día. Documentos no.

❓ **P5.2 · Por qué campos.** ¿Nombre nada más, o también RFC, correo, teléfono, folio de
cotización?

> Sugerencia: nombre, RFC, correo, teléfono y folio.

❓ **P5.3 · Qué ve un agente.** ¿Solo lo de sus empresas, como en las listas? ¿Y las tareas de otros
en empresas suyas?

> Sugerencia: exactamente las mismas reglas que cada lista, sin excepciones. Se prueba en
> `test/520-buscador.spec.ts`.

### Ronda 2

❓ **P5.4 · Cuántas letras y cuántos resultados.** ¿Desde 2 letras? ¿5 por grupo o un "Ver todos"
que lleve a la lista ya filtrada? *(Depende de P5.1.)*

❓ **P5.5 · Búsquedas recientes.** ¿Se muestran las últimas búsquedas al abrir Ctrl+K? Si sí, ¿se
guardan en el navegador o en la base de datos?

> Sugerencia: no en esta etapa.

❓ **P5.6 · Celular.** ¿Ícono de lupa en la barra de arriba que abre la misma búsqueda a pantalla
completa?

❓ **P5.7 · Velocidad.** Si con los datos reales la búsqueda tarda, ¿se aceptan índices nuevos
(una migración) o se busca solo "empieza con" en vez de "contiene"? *(Se mide en el plan con la
base de producción.)*

---

## Al terminar cada plan

- Las respuestas quedan en el plan de la etapa.
- Lo que cambie pantallas de Mich se anota en `PLAN_FRONTEND.md`.
- Lo que toque n8n se hace con prompts cortos para la IA de n8n (nunca armando el JSON a mano).
