# Manual operativo de la automatización · CRM NANOBRIDGE

**Para:** quien opere la prospección por correo después de la transferencia: el administrador o supervisor del CRM y
la persona con acceso técnico (n8n, Google Cloud y SendGrid).
**Versión:** 0.9.4 · 20 de noviembre de 2026 · servidor `nanobridge-api-00060-4xj` (18-nov): topes de 100 y 75, página de baja propia
(13-nov) y PT1a pidiendo 75 (17-nov). Pasa a
1.0 al cierre, con lo que deje la operación y la lista de accesos de la transferencia (OB-07).

Este manual dice qué corre solo, qué revisar cada día, cómo prender, pausar y apagar, cómo cambiar los parámetros y
qué hacer cuando algo falla. Cómo funciona por dentro está en el [flujo de actualización](FLUJO_DE_ACTUALIZACION.md)
(OB-03), y lo que se autorizó para la campaña, en el [flujo de campaña](FLUJO_DE_CAMPANA.md) (OB-05).

## 1. Qué corre solo y cuándo

Todo de lunes a viernes, hora de México, salvo donde se indica. En los feriados de la Ley Federal del Trabajo la API
no entrega nada a PT1 ni a PT4: corren, no mandan nada, y todo sale el siguiente día hábil.

| Hora | Qué | Dónde | Qué hace |
|---|---|---|---|
| 7:00 (todos los días) | **PT5 · trabajos diarios** | n8n | Vence importaciones sin confirmar (30 días) y cotizaciones con cierre pasado, avisa de tareas vencidas y documentos sin revisar, calcula las métricas del día anterior |
| 9:00 | **PT4 · recordatorios** | n8n | Manda los correos 2 y 3 a quien ya cumplió su espera de 5 días hábiles; marca inactivo a quien ya recibió 3 |
| 10:00, después de PT4 | **PT1a → PT1 · nuevos** | n8n | Toma de la fila hasta 75 prospectos (el `limite` que pide, igual a `NUEVOS_POR_DIA`; la API acepta hasta 200), con lo que dejen del tope diario los recordatorios, los valida, los califica y les manda el primer correo |
| Cada vez que alguien responde | **PT2 · respuestas** | n8n | Registra la respuesta, detiene los recordatorios de esa persona, la pone en la cola de clasificación, pide la sugerencia a la IA y avisa al supervisor |
| Cada evento de SendGrid | **PT3 · bajas, spam y rebotes** | n8n | Da de baja a la persona si marcó spam (o solo el correo, si rebotó). Atiende también el link de baja de SendGrid de los correos anteriores al 13-nov |
| Cuando alguien aprieta «Confirmar baja» | **Página de baja** | API | Da de baja a la persona. Abrir el link no cambia nada; solo el botón (§5) |
| Cuando algo falla | **B4 · avisos de falla** | n8n | Registra la falla en el CRM y manda un correo «[NANOBRIDGE] Falló …» |
| Con cada queja o rebote | **Freno del dominio** | API | Con 2 quejas o 5 rebotes en 7 días pausa la prospección y avisa a administradores y supervisores |
| Cada 5 minutos | **Revisión de que la API responde** | Google Cloud Monitoring | Si la API no responde 5 minutos seguidos, manda un correo; otro cuando se recupera |

Desde el 6-nov-2026 `MODO_PRUEBAS` está apagado: PT4 y PT1a corren solos con estos horarios.

## 2. Qué revisar cada día

En el CRM:
1. **Tareas → Cola de clasificación.** Cada respuesta espera aquí a que una persona la clasifique; la IA solo sugiere.
   Lo urgente: una **baja** (se clasifica y el sistema suprime a la persona) y un **interesado** (crea la tarea para un
   vendedor; «Responder ahora» deja contestarle de inmediato).
2. **Tareas → «Contactar prospecto interesado».** Vencen al final del siguiente día hábil. Si el reparto automático
   está apagado, un supervisor las asigna.
3. **Administración → Estado del sistema y Problemas abiertos.** Semáforo de la API, la base y n8n, y las fallas
   agrupadas por causa.

En el correo:
4. **Avisos «[NANOBRIDGE] Falló …»** de B4 y **«CRM caído»** de Cloud Monitoring (§6). Conviene un filtro en Gmail
   para que no caigan en Spam.

## 3. Prender, pausar y apagar

**Prender la prospección** ya se hizo el 6-nov-2026, con autorización escrita de Carlos, recorriendo la lista de
encendido del [RUNBOOK](../RUNBOOK_DEPLOY.md), §10. Si alguna vez se apaga con `MODO_PRUEBAS` (abajo), se vuelve a
prender con esa misma lista.

**Campañas:** Prospectos → Campañas → crear y activar. Pueden estar activas varias a la vez (hoy, agua y tratamiento
de maquinaria). Sus correos se escriben en Administración → Correos de prospección → botón «Campañas»: elegir la
campaña, escribir el correo y «Guardar para esta campaña»; «Usar el general» lo quita. El número que una campaña no
tenga propio sale con el general, y el pie es uno para todas.

**Meter prospectos a una campaña:** Prospectos → elegir → «Mandar a automatización», con la campaña. Solo entran los
que están listos; los demás regresan con su motivo. Se pueden sacar de la fila mientras PT1 no los haya tomado. La
misma persona puede ir a varias campañas: si ya espera en la fila de otra, el CRM pregunta si agregarla también o
cambiarla. Recibe una serie a la vez, y «me interesa» en una la saca de las demás ([flujo de campaña](FLUJO_DE_CAMPANA.md) §4).

**Pausar una campaña:** Prospectos → Campañas → Pausar. Nadie pierde su lugar ni se le cancela nada; al reanudar,
los recordatorios salen repartidos por el tope diario.

**Apagar todo de inmediato** (algo salió mal):
1. En n8n, volver a encender `MODO_PRUEBAS` en PT1 y PT4 (solo salen correos a los buzones del equipo), o quitar el
   horario de PT1a y PT4.
2. Pausar la campaña en el CRM.
3. Avisar a Dirección.

**Reanudar después del freno del dominio:** primero revisar de dónde salieron las quejas o los rebotes (la lista, un
correo mal escrito); luego Administración → Estado del sistema → «Reanudar». Solo un administrador. Después solo cuentan
las quejas y rebotes nuevos.

**Prender el reparto de interesados:** Administración → «Reparto de interesados»: elegir a los vendedores que
reciben y prender «Repartir solo». Antes, el equipo de ventas tiene que estar dado de alta como usuarios.

## 4. Parámetros y dónde se cambian

| Qué | Valor | Dónde se cambia |
|---|---|---|
| Textos de los 3 correos y el pie | Lo que apruebe Carlos; generales y, si se escriben, propios de cada campaña | CRM: Administración → Correos de prospección (botón «Campañas» para los de cada una) |
| Tope diario de correos | 100 desde el 10-nov (20 al encender, el 6-nov). Los recordatorios van primero | Google Cloud: `gcloud run services update nanobridge-api --update-env-vars TOPE_DIARIO_CORREOS=<n> --region=us-central1` |
| Nuevos por día | 75 desde el 10-nov (antes 10). Además cuenta el `limite` que pide PT1a en cada corrida: 75 desde el 17-nov (antes 10); la API acepta hasta 200. Si se sube uno, subir el otro | Igual, con `NUEVOS_POR_DIA=<n>`; el `limite`, en n8n (PT1a, nodo `fila/tomar`) |
| Link «Darte de baja» del pie | Página propia con botón desde el 13-nov | Código: `src/baja/`. En n8n, PT1b manda `subscription_tracking: { enable: false }` (prompt 5 de `docs/n8n/pt1b-plantillas/`) |
| Horarios de PT1a, PT4 y PT5 | §1 | n8n: el disparador de cada flujo |
| Modo de prueba | Apagado desde el 6-nov-2026 | n8n: `MODO_PRUEBAS` y la lista `PERMITIDOS` en PT1 y PT4 |
| IA que sugiere la clasificación | `abierto` (todas las respuestas) | n8n: `IA_MODO` en PT2a (`abierto`, `pruebas` o `apagado`) |
| IA del CRM (borrador y resumen) | Encendida | Google Cloud: `IA_DRIVER=gemini`; para apagarla, `IA_DRIVER=falso` |
| Reparto de interesados | Prendido desde el 6-nov (Carlos, Fabián y Mich) | CRM: Administración → Reparto de interesados |
| Límites del freno del dominio | 2 quejas o 5 rebotes en 7 días | Google Cloud: `FRENO_QUEJAS_7D` y `FRENO_REBOTES_7D` con `--update-env-vars` |
| A quién avisa B4 y a quién avisa PT2 | `pasante.tics002@` y `director.general@nano-bridge-mex.com` | n8n: `DESTINOS` en «armar correo de error» (B4) y en «armar aviso de respuesta» (PT2) |
| A quién avisa Cloud Monitoring | Hoy a las cuentas de los pasantes | Google Cloud: Monitoring → Alerting → la alerta → Notifications |

**Cuidado con las variables de Google Cloud:** usar siempre `--update-env-vars`, nunca `--set-env-vars`, que borra
las que no se mencionan (y sin `SESSION_COOKIE_NAME` nadie puede iniciar sesión). Las que deben seguir puestas están en
el RUNBOOK, «Qué está en producción».

## 5. Las bajas

- Una persona se da de baja sola con el link del pie, al marcar el correo como spam, o al contestar y que se
  clasifique «baja». En todos los casos se suprimen **todos** sus medios, se cancelan sus seguimientos y no se le
  vuelve a escribir.
- **El link del pie lleva a una página del CRM con el botón «Confirmar baja»** (desde el 13-nov-2026). Abrir la
  página no cambia nada; la baja ocurre al apretar el botón y queda en el Historial como «Baja confirmada en la página
  de baja». Antes el link era de SendGrid y daba de baja con solo abrirlo: el 11 y el 12-nov el escáner de links de
  Microsoft 365 lo abrió solo y dio de baja a tres prospectos que no lo pidieron (se revirtieron el 13-nov en la base y
  en SendGrid). Los correos anteriores al 13-nov conservan el
  link de SendGrid y PT3 lo sigue atendiendo.
- El link va firmado con `REPLY_TO_SIGNING_SECRET`: si ese secreto se rota, los links de baja de los correos ya
  enviados dejan de servir (la página dice «Enlace no válido»), igual que el Reply-To.
- **Una baja no se deshace desde el CRM:** no hay botón. Si alguien pide volver a recibir correos, o quedó en baja sin
  pedirlo, lo decide Dirección y se hace directo en la base, con los pasos del [manual de datos](MANUAL_DE_DATOS.md)
  §6.1 (incluye quitarla también en SendGrid si vino de su link).
- **Si alguien pide la baja por teléfono o en persona,** sin contestar el correo: en la ficha de la empresa, en el
  contacto, «Dar de baja», con el motivo («Lo pidió por teléfono al vendedor»). Hace lo mismo que el link del pie:
  suprime todos sus medios, pasa sus prospectos a baja y cancela sus seguimientos. Queda en el Historial de la ficha y
  en el Registro de cambios con quién la registró.

## 6. Qué hacer si algo falla

| Síntoma | Qué revisar | Qué hacer |
|---|---|---|
| Llega «[NANOBRIDGE] Falló *flujo* en *nodo*» | El correo trae el link de la ejecución en n8n. En el CRM: Administración → Avisos y procesos fallidos | Abrir la ejecución y ver el error. Si fue pasajero (la API tardó, un 500 aislado), «Retry» en n8n: es seguro, nada se duplica. Luego marcar el proceso fallido como resuelto |
| Llega «CRM caído» | ¿Carga el CRM? | Si carga y llega «se recuperó», fue pasajero. Si no: RUNBOOK §11 (registros de Cloud Run, regresar a la revisión anterior si hubo un deploy) |
| Hoy no salió ningún correo | ¿Es feriado? ¿La campaña está activa o pausada? ¿Hay prospectos en la fila? ¿Se alcanzó el tope? ¿Corrieron PT4 y PT1a en n8n? ¿Sigue encendido `MODO_PRUEBAS`? | Lo que aplique. Si n8n corrió y la API no entregó nada, el motivo está en la respuesta de `fila/tomar` o `envios/vencidas` dentro de la ejecución |
| Muchos scores calculados «por reglas» | Incidencias `gemini_agotado` en Administración | Nada se atora: los prospectos siguen su camino. Si pasa seguido, revisar la llave y la cuota de Gemini |
| Una respuesta llegó sin identificar | Queda como tarea en la cola | Clasificarla a mano; si es de un prospecto, buscarlo por su correo |
| Aviso «Se pausaron los envíos de prospección» (freno del dominio) | Administración → Estado del sistema: cuántas quejas y rebotes | Revisar la lista que los causó, corregir y **Reanudar** (§3). Nadie perdió su lugar |
| Administración marca «correos sin confirmar» | ¿Falló PT1b? (los prompts de `docs/n8n/confirmacion-envios/` están aplicados desde el 6-nov) | Revisar la ejecución de PT1b en n8n; si SendGrid rechazó el correo, se reintenta solo hasta 3 veces |
| La auditoría marca una persona con más de 3 correos, o un medio activo en la lista de supresión | Reporte de la auditoría (§4 de sus controles rojos) | **Detener la campaña** y avisar a T2 y a Dirección (procedimiento de auditoría) |
| Gmail manda los correos a Promociones | Bandeja de un buzón de prueba | Riesgo conocido, sin solución todavía; anotarlo en el reporte del piloto |

## 7. Revisiones periódicas

| Cada cuándo | Qué | Dónde |
|---|---|---|
| Diario | Cola de clasificación, interesados, avisos de falla (§2) | CRM y correo |
| Diario, las primeras semanas | Auditoría de datos | [Procedimiento de auditoría](PROCEDIMIENTO_AUDITORIA.md) |
| Cuando haga falta saber quién cambió algo | Registro de cambios, filtrado por persona y acción; «Exportar lo filtrado» saca el PDF y dice qué filtro se usó | CRM: Administración → Registro de cambios |
| Semanal | Rebotes y quejas, y si se sube el tope diario | SendGrid |
| Semanal | Auditoría de datos | Procedimiento de auditoría |
| Con un mes de datos | Si la prioridad del score predice quién responde (M3) y los pesos del score | [Evaluación del modelo](EVALUACION_DEL_MODELO.md) |
| Antes de cada cambio en n8n | Copiar el código o el prompt cambiado a `docs/n8n/` | Repositorio |

## 8. Accesos

⏳ Se completa en la transferencia (OB-07): quién tiene acceso a n8n Cloud, a Google Cloud (proyecto
`crm-prospeccion-outbound`), a SendGrid y a Firebase, y a quién pasan las cuentas que hoy están a nombre de los
pasantes. Lo que ya se sabe que hay que cambiar: los avisos de Cloud Monitoring (los de B4 y PT2 van a correos de trabajo desde
el 6-nov, §4) y el administrador
de la cuenta de SendGrid (RUNBOOK §10).
