# Manual operativo de la automatización · CRM NANOBRIDGE

**Para:** quien opere la prospección por correo después de la transferencia: el administrador o supervisor del CRM y
la persona con acceso técnico (n8n, Google Cloud y SendGrid).
**Versión:** 0.9 · 5 de noviembre de 2026 · servidor `nanobridge-api-00048-7x5`. Pasa a 1.0 al cierre, con lo que
deje el piloto y la lista de accesos de la transferencia (OB-07).

Este manual dice qué corre solo, qué revisar cada día, cómo prender, pausar y apagar, cómo cambiar los parámetros y
qué hacer cuando algo falla. Cómo funciona por dentro está en el [flujo de actualización](FLUJO_DE_ACTUALIZACION.md)
(OB-03), y lo que se autorizó para la campaña, en el [flujo de campaña](FLUJO_DE_CAMPANA.md) (OB-05).

## 1. Qué corre solo y cuándo

Todo de lunes a viernes, hora de México, salvo donde se indica. En los feriados de la Ley Federal del Trabajo la API
no entrega nada a PT1 ni a PT4: corren, no mandan nada, y todo sale el siguiente día hábil.

| Hora | Qué | Dónde | Qué hace |
|---|---|---|---|
| 7:00 (todos los días) | **PT5 · trabajos diarios** | n8n | Vence importaciones sin confirmar (30 días) y cotizaciones con cierre pasado, avisa de tareas vencidas y documentos sin revisar, calcula las métricas del día anterior |
| 10:00 (9:00 si se decide) | **PT4 · recordatorios** | n8n | Manda los correos 2 y 3 a quien ya cumplió su espera de 5 días hábiles; marca inactivo a quien ya recibió 3 |
| 10:00, después de PT4 | **PT1a → PT1 · nuevos** | n8n | Toma de la fila hasta 10 prospectos (sin pasar del tope diario), los valida, los califica y les manda el primer correo |
| Cada vez que alguien responde | **PT2 · respuestas** | n8n | Registra la respuesta, detiene los recordatorios de esa persona, la pone en la cola de clasificación, pide la sugerencia a la IA y avisa al supervisor |
| Cada evento de SendGrid | **PT3 · bajas, spam y rebotes** | n8n | Da de baja a la persona (o solo el correo, si rebotó) |
| Cuando algo falla | **B4 · avisos de falla** | n8n | Registra la falla en el CRM y manda un correo «[NANOBRIDGE] Falló …» |
| Con cada queja o rebote | **Freno del dominio** | API | Con 2 quejas o 5 rebotes en 7 días pausa la prospección y avisa a administradores y supervisores |
| Cada 5 minutos | **Revisión de que la API responde** | Google Cloud Monitoring | Si la API no responde 5 minutos seguidos, manda un correo; otro cuando se recupera |

Mientras siga el modo de prueba, PT1a se corre a mano y solo salen correos a buzones del equipo (§3).

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

**Prender la campaña** (una sola vez, después de la autorización escrita de G5): recorrer completa la lista de
encendido del [RUNBOOK](../RUNBOOK_DEPLOY.md), §10. Lo último es apagar `MODO_PRUEBAS` en PT1 y PT4.

**Meter prospectos a la campaña:** Prospectos → elegir → «Mandar a automatización», con la campaña. Solo entran los
que están listos; los demás regresan con su motivo. Se pueden sacar de la fila mientras PT1 no los haya tomado.

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
| Textos de los 3 correos y el pie | Lo que apruebe Carlos | CRM: Administración → Correos de prospección |
| Tope diario de correos | 20 al encender; se duplica cada semana si los rebotes quedan debajo de 2 % y las quejas debajo de 0.1 % | Google Cloud: `gcloud run services update nanobridge-api --update-env-vars TOPE_DIARIO_CORREOS=<n> --region=us-central1` |
| Nuevos por día | 10 | Igual, con `NUEVOS_POR_DIA=<n>` |
| Horarios de PT1a, PT4 y PT5 | §1 | n8n: el disparador de cada flujo |
| Modo de prueba | Encendido hasta el día de encender | n8n: `MODO_PRUEBAS` y la lista `PERMITIDOS` en PT1 y PT4 |
| IA que sugiere la clasificación | `abierto` (todas las respuestas) | n8n: `IA_MODO` en PT2a (`abierto`, `pruebas` o `apagado`) |
| IA del CRM (borrador y resumen) | Encendida | Google Cloud: `IA_DRIVER=gemini`; para apagarla, `IA_DRIVER=falso` |
| Reparto de interesados | Apagado | CRM: Administración → Reparto de interesados |
| Límites del freno del dominio | 2 quejas o 5 rebotes en 7 días | Google Cloud: `FRENO_QUEJAS_7D` y `FRENO_REBOTES_7D` con `--update-env-vars` |
| A quién avisa B4 y a quién avisa PT2 | Hoy al Gmail de Fabián | n8n: `DESTINOS` en «armar correo de error» (B4) y en «armar aviso de respuesta» (PT2) |
| A quién avisa Cloud Monitoring | Hoy a las cuentas de los pasantes | Google Cloud: Monitoring → Alerting → la alerta → Notifications |

**Cuidado con las variables de Google Cloud:** usar siempre `--update-env-vars`, nunca `--set-env-vars`, que borra
las que no se mencionan (y sin `SESSION_COOKIE_NAME` nadie puede iniciar sesión). Las que deben seguir puestas están en
el RUNBOOK, «Qué está en producción».

## 5. Las bajas

- Una persona se da de baja sola con el link del pie, al marcar el correo como spam, o al contestar y que se
  clasifique «baja». En todos los casos se suprimen **todos** sus medios, se cancelan sus seguimientos y no se le
  vuelve a escribir.
- **Una baja no se deshace desde el CRM.** Si alguien pide volver a recibir correos, lo decide Dirección.
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
| Administración marca «correos sin confirmar» | ¿Ya se aplicaron los prompts de `docs/n8n/confirmacion-envios/`? ¿PT1b falló? | Mientras no estén los prompts es normal. Después, revisar la ejecución de PT1b |
| La auditoría marca una persona con más de 3 correos, o un medio activo en la lista de supresión | Reporte de la auditoría (§4 de sus controles rojos) | **Detener la campaña** y avisar a T2 y a Dirección (procedimiento de auditoría) |
| Gmail manda los correos a Promociones | Bandeja de un buzón de prueba | Riesgo conocido, sin solución todavía; anotarlo en el reporte del piloto |

## 7. Revisiones periódicas

| Cada cuándo | Qué | Dónde |
|---|---|---|
| Diario | Cola de clasificación, interesados, avisos de falla (§2) | CRM y correo |
| Diario, durante el piloto | Auditoría de datos | [Procedimiento de auditoría](PROCEDIMIENTO_AUDITORIA.md) |
| Semanal | Rebotes y quejas, y si se sube el tope diario | SendGrid |
| Semanal | Auditoría de datos | Procedimiento de auditoría |
| Con un mes de datos | Si la prioridad del score predice quién responde (M3) y los pesos del score | [Evaluación del modelo](EVALUACION_DEL_MODELO.md) |
| Antes de cada cambio en n8n | Copiar el código o el prompt cambiado a `docs/n8n/` | Repositorio |

## 8. Accesos

⏳ Se completa en la transferencia (OB-07): quién tiene acceso a n8n Cloud, a Google Cloud (proyecto
`crm-prospeccion-outbound`), a SendGrid y a Firebase, y a quién pasan las cuentas que hoy están a nombre de los
pasantes. Lo que ya se sabe que hay que cambiar: los avisos de B4, PT2 y Cloud Monitoring (§4) y el administrador
de la cuenta de SendGrid (RUNBOOK §10).
