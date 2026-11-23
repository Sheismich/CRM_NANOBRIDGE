# Pendientes de la revisión del 20-nov-2026: quién hace qué

Plan del 23-nov-2026. Son los 15 pendientes de la revisión del 20-nov, ya revisados contra el código el 23-nov
(main `50c1425`). Reparto: **Fabián** hace todo lo de n8n y parte del código. **Mich** hace todo lo de Google
Cloud y el resto del código.

Tamaño: **chico** = medio día o menos, **mediano** = 1 a 2 días, **grande** = más de 3 días.

## Resumen

| # | Pendiente | Quién | Tamaño | Depende de |
|---|---|---|---|---|
| 2 | Avisar cuando n8n no corrió | Fabián (API) + Mich (Cloud Scheduler) | chico | - |
| 7 | Respaldo de los flujos de n8n en el repo | Fabián (n8n) | chico | - |
| 6 | Encabezado List-Unsubscribe | Fabián (API + n8n) | chico | - |
| 4 | Correo duplicado si SendGrid tarda | Fabián (n8n + API) | chico/mediano | #7 |
| 3 | Recordatorio perdido si PT4 truena | Fabián | mediano | - |
| 11 | Rebotes suaves y el freno | Fabián (solo vigilar) | - | - |
| 1 | ✅ Detener seguimiento de quien ya habla con ventas (23-nov, `00065-2pj`, PR #7) | Mich (API + front) | mediano | - |
| 5 | Repo público | Mich (decide) | chico | - |
| 8 | Aviso de errores 500 | Mich (Google Cloud) | chico | - |
| 9 | Borrar datos de una persona (ARCO) | Mich (API + front) | mediano | - |
| 10 | Deploy automático con Cloud Build | Mich (Google Cloud) | mediano | acceso a GCP |
| 15 | Pruebas que faltan | Mich (+ ejemplos de n8n de Fabián) | mediano | #7 |
| 14 | Tipos del front generados, no copiados | Mich (front) | mediano | después de #1 y #9 |
| 13 | Partir los archivos enormes | Mich | mediano | después de #3 y #4 |
| 12 | Que n8n sea solo el reloj | Mich (API) + Fabián (n8n) | grande | después de la entrega de diciembre |

**Orden de cada quien:**
- Fabián: #2 (API) → #7 → #6 → #4 → #3 (y #12 parte n8n al final).
- Mich: #1 → #5 → #2 (Cloud Scheduler, cuando Fabián despliegue su parte) → #8 → #10 → #9 → #15 → #14 → #13 (y #12
  parte API al final).

## Reglas para los dos

1. **Una rama y un PR por pendiente.** CI en verde antes de unir. El otro revisa el diff antes del merge.
2. **Migraciones:** la siguiente es la `045`. El número se toma al hacer merge, no al empezar: si los dos
   necesitan una, el segundo renumera la suya. Avisar en el PR.
3. **Un deploy a la vez.** Cada deploy va en la tabla "Qué está en producción" del RUNBOOK §6. Siempre
   `--update-env-vars`, nunca `--set-env-vars`. Hasta que esté el #10, los deploys los hace Fabián.
4. **API primero, n8n después.** Cuando un cambio toca los dos, se despliega la API y luego se cambia n8n.
5. **El repo es público** (ver #5): nada de correos, nombres ni números de prospectos reales en código, pruebas
   o docs.
6. Al cerrar un pendiente, marcarlo aquí con ✅, la fecha y la revisión de Cloud Run.

---

## Fabián

### #2 Avisar cuando n8n no corrió (chico; la parte de Google Cloud es de Mich)

**Hoy:** si n8n se para, nadie se entera. La tarjeta "sin confirmar" (`src/admin/salud.service.ts:53`) solo se ve
si alguien entra a Administración, y la única alerta es la de `/health`.

**Ojo:** el aviso no puede dispararlo n8n. Los trabajos diarios de la API también los llama n8n (PT5), así que
si n8n se cae, el aviso se cae con él.

**Qué hacer:**
- API: guardar la hora de la última llamada de PT1a (`fila/tomar`) y de PT4 (`envios/vencidas`), por ejemplo en
  `parametros_automatizacion`.
- API: endpoint nuevo que revisa: si hoy es día hábil (feriados que ya conoce la API) y alguno de los dos no ha
  llamado, manda un aviso con correo a administradores (como `notificar` del freno, en
  `src/shared/freno-dominio.ts`). Protegido con la misma llave que `/jobs`.
- Google Cloud (**Mich**, cuando la parte de la API esté desplegada): un Cloud Scheduler a las 11:00 de lunes a
  viernes (zona `America/Mexico_City`) que llame ese endpoint con la llave. Anotarlo en el RUNBOOK.

**Listo cuando:** con PT4 apagado un día hábil, a las 11:00 llega el correo. Con todo corriendo, no llega nada.
En feriado no llega nada.

### #7 Respaldo de los flujos de n8n (chico, n8n) ✅ 23-nov-2026

Hecho: los 9 flujos activos en `docs/n8n/flujos/`, limpios, con README (interruptores, horarios, cómo exportar e
importar) y el script `limpiar-n8n.mjs`. No había llaves en ningún flujo. Pendiente aparte: el respaldo automático
semanal a una carpeta privada del Drive de la empresa (opcional).

**Hoy:** `docs/n8n/` solo tiene prompts. Si se borra un flujo, no hay copia. `MODO_PRUEBAS` e `IA_MODO` solo
existen en n8n.

**Qué hacer:** descargar el JSON de cada flujo (PT1, PT1a, PT1b, PT2, PT2a, PT3, PT4, PT5 y el Error Workflow)
a `docs/n8n/flujos/`. Anotar en un README cuál es la versión publicada y los valores de `MODO_PRUEBAS` e
`IA_MODO`.

**Ojo, el repo es público:** antes del commit, buscar en cada JSON llaves de API, tokens o correos reales
escritos a mano en un nodo. n8n no exporta los secretos de las credenciales, pero sí lo que esté pegado en un
nodo. Lo que aparezca se cambia por `<LLAVE>` y, si era una llave, se rota.

**Listo cuando:** están todos los JSON, revisados, y el README dice cómo volver a importarlos.

### #6 Encabezado List-Unsubscribe (chico, API + n8n)

**Hoy:** los correos de prospección no traen `List-Unsubscribe`. Se perdió el 13-nov al apagar el link de baja
de SendGrid. Sin él, Gmail no muestra el botón "Cancelar suscripción" y la gente marca spam, y con 2 quejas se
pausan los envíos.

**Qué hacer:**
- API: en lo que regresa `POST /automatizacion/envios` (y lo que usa PT4), agregar los encabezados listos:
  `List-Unsubscribe: <link de baja firmado>` y `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. El link ya
  existe (`urlDeBaja`, `src/shared/link-baja.ts`). La página de baja ya acepta el POST y está exenta del CSRF
  (`src/shared/origen-csrf.ts:47`), así que no hace falta otra ruta.
- n8n: en PT1b, nodo "Armar correo SendGrid", pasar esos encabezados en `headers`. Le doy el prompt a Fabián
  cuando la API esté desplegada.

**Listo cuando:** en un correo de prueba (`+pruebaN`), "Mostrar original" en Gmail trae los dos encabezados, y el
botón de Gmail deja al prospecto en baja.

### #4 Correo duplicado si SendGrid tarda (chico/mediano, n8n + API)

**Hoy (sospecha):** si n8n reporta un envío como fallido, la API lo reprograma (`automatizacion.service.ts:923`).
Si en realidad SendGrid sí lo mandó y solo tardó en contestar, la persona recibe el correo dos veces. El aviso
posterior de SendGrid de que sí se entregó no corrige nada.

**Qué hacer:**
1. n8n (con el JSON del #7): ver qué hace PT1b cuando SendGrid tarda o da error de red. ¿Reporta "fallido"?
   Si nunca lo hace, el pendiente se cierra aquí.
   **Visto el 23-nov en el export:** el nodo "SendGrid · enviar" tiene `retryOnFail` con 3 intentos y 30 s de
   espera, y si los 3 fallan va a "Confirmar fallido". O sea: si SendGrid sí aceptó el correo pero tardó en
   contestar, **n8n lo vuelve a mandar él mismo** (hasta 3 veces), además de la reprogramación de la API. El
   arreglo empieza en n8n: quitar el reintento de ese nodo, o dejarlo solo para errores en que SendGrid seguro no
   lo recibió.
2. Si sí lo hace, en la API: cuando llega un `processed` o `delivered` de SendGrid con el `envio_id` de un envío
   fallido, regresarlo a "enviado" y deshacer la reprogramación (cerrar la ventana que se reabrió, o sacarlo de
   la fila si era el primero). Queda en auditoría.

**Listo cuando:** una prueba con un envío marcado fallido y luego un `delivered` del mismo `envio_id` termina
con el envío en "enviado" y sin recordatorio extra.

### #3 Recordatorio perdido si PT4 truena (mediano)

**Hoy:** `/envios/vencidas` marca la ventana "vencida" al entregarla a n8n (`automatizacion.service.ts:1068`).
Si PT4 truena después, ese recordatorio no sale nunca. Y es peor que solo un correo perdido: el prospecto se
queda en "validado" sin ventana abierta, así que la regla de "serie en curso" (`src/shared/ciclo-contacto.ts:103`)
bloquea a esa persona en sus otras campañas durante 6 meses. Si era la última ventana, tampoco pasa a inactivo.

**Qué hacer:** guardar cuándo se entregó cada ventana (columna nueva, migración). Al empezar cada
`/envios/vencidas`, volver a abrir las que se entregaron hace más de X horas sin que llegara su envío (o sin que el
prospecto se cerrara, si era la última). Igual que `HORAS_PARA_RETOMAR_DE_FILA` en la fila.
- Solo las que se entregaron en `data`. Las omitidas (`recordatorio_omitido`) y las viejas que se saltaron por un
  envío más nuevo se cancelaron a propósito y no se reabren.
- No hay riesgo de duplicado: PT4 registra con `execution_id = recordatorio-<ventana>`, que ya es único.

**Listo cuando:** una prueba que reclama una ventana, no registra envío y adelanta el reloj X horas la vuelve a
recibir, y una omitida no regresa.

### #11 Rebotes suaves y el freno (solo vigilar)

Ya quedó resuelto casi del todo con la migración 044: un rebote suave solo cuenta para el freno cuando el
prospecto llega a 3 seguidos, y una sola vez por prospecto (`src/shared/freno-dominio.ts:50`). Sin trabajo. Si
el freno pausa en falso, se revisa ahí.

---

## Mich

### #1 Detener seguimiento de quien ya habla con ventas (mediano, API + front) · ✅ 23-nov-2026, `00065-2pj`, PR #7

**Hoy:** los recordatorios se frenan solo si la persona contesta al correo de la campaña o si alguien la
clasifica. Si habla por teléfono, por WhatsApp o desde otro correo, le siguen llegando. Crear una oportunidad
(`src/comercial/oportunidades.service.ts:185`) no frena nada, y un agente no puede detenerlos porque clasificar es
solo para administrador y supervisor.

**Decidido (Fabián, 23-nov-2026):**

1. **El prospecto pasa a `interesado`**, no solo se cierran las ventanas. Si solo se cerraran, el prospecto se
   quedaría en "validado": el embudo lo mostraría como si siguiera en automatización y la regla de "serie en
   curso" lo trataría como serie viva. Con `interesado` se reusan reglas que ya existen y están probadas:
   - es un estado cerrado, así que PT4 no le manda nada;
   - `frenarOtrasCampanas` cierra sus ventanas en las demás campañas y lo saca de la fila;
   - no puede volver a entrar a otra campaña mientras siga en `interesado`.
2. **No se crea la tarea "Contactar prospecto interesado"** ni corre el escalamiento (que depende de esa tarea):
   ventas ya lo está atendiendo.
3. **Los reportes no cambian:** cuentan interesados por la respuesta clasificada (`respuestas.clasificacion`),
   no por el estado del prospecto. Detener a alguien no infla los resultados de la campaña.
4. **Oportunidad sin contacto: no se frena a nadie.** Frenar a toda la empresa detendría a personas que nunca
   hablaron con ventas, y quitar el freno al cerrar la venta sería lógica nueva en la parte más delicada. Para ese
   caso está el botón.

**Qué hacer:**
- API: acción "Detener seguimiento" sobre una persona (contacto). El prospecto de su serie en curso (el que tiene
  el envío más reciente de los últimos 6 meses) pasa a `interesado` y se llama `frenarOtrasCampanas`
  (`src/shared/clasificacion-respuesta.ts`), en una transacción. Si no tiene serie en curso, solo se saca de la
  fila. La pueden usar el agente dueño de la empresa, el supervisor y el administrador. Queda en auditoría con
  quién y un motivo corto obligatorio. No se deshace desde el botón, igual que una clasificación.
- API: al crear una oportunidad con `prospectoId` (ese prospecto) o con `contactoId` (su serie en curso), lo
  mismo, dentro de la misma transacción de `create` (`src/comercial/oportunidades.service.ts:185`).
- Front: botón "Detener seguimiento" en la ficha de la persona, visible solo si tiene algo en automatización, con
  confirmación y el motivo.
- Fuera de este pendiente: "no le interesa" dicho por teléfono. Para quien no quiere correos ya está "Dar de
  baja" en la ficha.

**Listo cuando:** después de pulsar el botón (o de crear la oportunidad), `/envios/vencidas` ya no trae a esa
persona en ninguna campaña, no aparece tarea nueva y el reporte de la campaña no cambia.

### #5 Repo público (chico, decide Mich porque es la dueña)

**Hoy:** el repo es público. Lo sensible son los Gmail personales y los `+prueba` de Fabián, las cuentas de los
pasantes, y los números y nombres de prospectos reales en `docs/RUNBOOK_DEPLOY.md` (línea 295). El domicilio y el
correo del director no son problema: ya están publicados en el aviso de privacidad. No hay llaves en el
historial (revisado el 4-nov).

**Qué hacer:**
- Decidir si se hace privado. Si sí, revisar antes los minutos de GitHub Actions: un repo privado gratis tiene
  2,000 al mes y el CI puede tardar hasta 60 minutos por corrida.
- Pase lo que pase, quitar de los docs los nombres de prospectos reales y los Gmail personales.
  **Hecho el 23-nov (Mich):** los Gmail de prueba de Fabián, el de los diseños y los nombres de 4 empresas prospecto
  se cambiaron por marcadores en los docs, los diseños, la copia de PT2a y comentarios del código. Siguen en el
  historial de git. Queda por decidir si el repo se hace privado.
- Si se queda público, borrarlos también del historial es reescribirlo (`git filter-repo` + force push). Eso es
  delicado y hay que coordinarlo con Fabián, porque los dos tienen copias.

### #8 Aviso de errores 500 (chico, Google Cloud)

**Hoy:** un error 500 solo se escribe en el log (`src/shared/http-exception.filter.ts:82`). Nadie se entera.

**Qué hacer:** en Cloud Monitoring, una métrica de logs sobre las peticiones de `nanobridge-api` con
`httpRequest.status >= 500` y una alerta (por ejemplo, 3 o más en 10 minutos) al mismo canal que la alerta de
`/health`. Anotarlo en el RUNBOOK junto a esa alerta.

**Listo cuando:** forzar un 500 de prueba manda el aviso.

### #10 Deploy automático con Cloud Build (mediano, Google Cloud)

**Hoy:** el deploy es a mano, desde la compu de Fabián o Cloud Shell, siguiendo el RUNBOOK §6.

**Qué hacer:** un disparador de Cloud Build con cada tag `v*` que:
1. Construya la imagen.
2. Corra las migraciones pendientes contra Cloud SQL (con el proxy de Cloud SQL o un Cloud Run Job; Cloud SQL
   solo acepta conexiones cifradas).
3. Despliegue con `--update-env-vars` (nunca `--set-env-vars`: se borrarían `TRUST_PROXY`, `SESSION_COOKIE_NAME`
   y las demás).
4. Opcional: el front a Firebase.

Actualizar el RUNBOOK §6 con el paso nuevo. Si a Mich le falta acceso al proyecto de GCP, Fabián se lo da.

**Listo cuando:** un tag de prueba deja la revisión nueva en Cloud Run con las mismas variables de antes.

### #9 Borrar datos de una persona, derecho ARCO (mediano, API + front)

**Hoy:** "eliminar" una persona solo la desactiva y marca sus correos como obsoletos
(`src/crm/empresas.service.ts:570`). Sus datos siguen en la base y en la auditoría. Si alguien pide que se borren
sus datos, no hay cómo.

**Decidido (Fabián, 23-nov-2026):**

1. **Anonimizar, no borrar filas.** Los datos de la persona se reemplazan por "Persona eliminada" o se vacían;
   las filas se quedan. Así no se rompen las ventas, los conteos de envíos ni los reportes. Un dato anonimizado ya
   no es dato personal, así que cumple con la cancelación.
2. **Lo único personal que se conserva es su correo y teléfono en `lista_supresion`.** Es la lista de exclusión,
   que la ley reconoce: sin ella, si alguien la vuelve a importar, se le volvería a escribir. No se cambia a hash,
   porque toda la revisión de supresión compara el valor tal cual.
3. **Ventas, cotizaciones y documentos se quedan**, porque son de la empresa (la factura va al RFC de la
   empresa). Solo se quita el nombre de la persona.
   - Excepción: si la empresa es una persona física y tiene ventas, sus datos fiscales se quedan los 5 años que
     obliga la ley fiscal. Se borra todo lo demás.
4. **Se borran los textos libres ligados a la persona:** el contenido de sus respuestas y de los correos que se le
   mandaron, las notas de sus actividades y tareas, sus avisos y sus datos dentro de la auditoría (se redacta el
   JSON, la fila queda). Lo que otra ficha diga de ella en una nota suelta no se busca.
5. **Solo el administrador puede hacerlo.** No se puede deshacer y hay que escribir el nombre de la persona para
   confirmar. Queda en auditoría sin datos personales: contacto, quién, cuándo y "Datos borrados por solicitud
   ARCO".
6. **Fuera del CRM** se borra solo con el tiempo: los respaldos de Cloud SQL (7 días), el historial de SendGrid y
   las ejecuciones de n8n. Eso se le dice a la persona en la respuesta; no lleva código.

**Qué hacer:**
- API: primero hacer la lista de dónde hay datos de una persona. Revisar al menos `contactos`, `medios_contacto`,
  `prospectos`, `envios` (`destinatario`, `asunto`), `eventos_sendgrid` (`correo`), `respuestas`,
  `correos_respuesta`, `correos_cotizacion`, `actividades`, `tareas`, `notificaciones`, `resultados_scoring`,
  `borradores_captura`, `incidencias`, `eventos_pendientes`, `procesos_fallidos` y `auditoria`. Ponerla en el PR.
- API: la acción, en una sola transacción. La persona queda desactivada y en baja (sin medios usables), así que no
  se le puede volver a mandar a automatización.
- Front: botón en la ficha (solo para administrador), con la confirmación escrita.

**Listo cuando:** después de la acción, buscar el correo o el nombre de la persona no la encuentra en ninguna
tabla salvo en la lista de supresión, y no se le puede volver a mandar a automatización.

### #15 Pruebas que faltan (mediano, + ejemplos de n8n de Fabián)

**Hoy:** n8n no tiene pruebas. El front tiene 7 archivos de prueba (6 en `lib/`, 1 en `components/`). La suite de
la API no corre en local (el MySQL de Docker está viejo).

**Qué hacer:**
- Que la suite corra en local: recrear el MySQL de Docker y documentarlo.
- Pruebas de la API con lo que de verdad manda n8n: Fabián saca ejemplos de las ejecuciones (con los datos
  personales cambiados) y Mich los usa como entrada de las pruebas de `/automatizacion`.
- Pruebas de navegador (Playwright) del camino principal: entrar, abrir una ficha y mandar a automatización.

### #14 Tipos del front generados, no copiados (mediano, front)

**Hoy:** `frontend/src/types.ts` (856 líneas) está copiado a mano de la API. Si la API cambia, el front no se
entera hasta que algo falla.

**Qué hacer:** sacar los tipos de los esquemas zod de la API (`z.infer`) a un lugar que los dos usen, o
generarlos. Decidir cómo en un plan corto. Hacerlo después del #1 y del #9, que agregan campos.

### #13 Partir los archivos enormes (mediano)

**Hoy:** `src/automatizacion/automatizacion.service.ts` tiene 1572 líneas; `src/crm/prospectos.service.ts` y
`src/tareas/tareas.service.ts`, más de 1000.

**Qué hacer:** partir por flujo (fila e ingesta, envíos, ventanas vencidas, respuestas, campañas) sin cambiar
nada de lo que hacen: las pruebas pasan sin tocarlas. **Hacerlo después de que Fabián una el #3 y el #4**, que
tocan el mismo archivo, para no pelear con conflictos.

---

## Al final, los dos: #12 Que n8n sea solo el reloj (grande)

**Hoy:** los correos de prospección los manda n8n con su propio nodo de SendGrid. La API tiene otro para
cotizaciones, avisos y respuestas (`src/integraciones/correo-sendgrid.driver.ts`). Son dos caminos para lo mismo.

**Qué hacer:** que la API mande también los de prospección y que n8n solo la llame a la hora. Mich hace la parte de
la API y Fabián cambia PT1b y PT4. No es urgente: después de la entrega de diciembre y con el #4 y el #6 ya
cerrados.

## Fuera de la lista (menores, sin dueño por ahora)

- El webhook de SendGrid no revisa qué tan viejo es el aviso. Lo cubre que cada evento se guarda una sola vez.
- El límite de peticiones vive en memoria: está bien mientras haya una sola instancia de Cloud Run.
