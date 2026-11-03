# Flujo de campaña · CRM NANOBRIDGE

**Entregable:** flujo de campaña listo para decisión (OB-05), proyecto naranja · outbound.
**Para:** revisión G5 · autorizar el piloto (semana 13, 23-27 nov 2026). **Redacta:** T1 · **Revisión:** T2 (dueño de los flujos de n8n) y Dirección General.
**Versión:** 0.5 · borrador · 3 de noviembre de 2026. Pasa a 1.0 cuando se cargue la lista de Carlos y se certifique la audiencia (semana 12).

Este documento junta lo que Dirección necesita para autorizar por escrito el piloto del 30 de noviembre al 4 de
diciembre: a quién se le escribe, qué se le dice, con qué límites, qué se excluye, qué queda registrado, cómo se
vigila y cómo se detiene. **Sin aprobación escrita no sale ningún correo a un prospecto real** (programa, G5).

Cómo funciona cada pieza por dentro está en el [flujo de actualización](FLUJO_DE_ACTUALIZACION.md) (OB-03); aquí
solo lo que hace falta para decidir.

## 1. Lo que se pide autorizar

| # | Decisión | Propuesta | Estado |
|---|---|---|---|
| 1 | **Audiencia** | Los prospectos de la lista de Carlos que la auditoría certifique como listos (§2) | ⏳ Se certifica en la semana 12 |
| 2 | **Textos de los 3 correos** (inicial y 2 recordatorios) | Los que apruebe Carlos, escritos en Administración → Correos de prospección (§3) | ⏳ Hoy hay un borrador |
| 3 | **Pie del correo:** domicilio de la empresa y aviso de privacidad | El domicilio lo pasa Carlos; el aviso ya está publicado | ⏳ Falta el domicilio |
| 4 | **Tope diario** de correos | 20 al día, para calentar el dominio; se duplica cada semana si los rebotes quedan debajo de 2 % y las quejas debajo de 0.1 % | Propuesto (25-sep) |
| 5 | **Nuevos por día** | 10 como máximo (`NUEVOS_POR_DIA`) | Valor actual |
| 6 | **Horario** | Lunes a viernes: recordatorios (PT4) a las 9:00 y nuevos (PT1) a las 10:00. Hoy PT4 corre a las 10:00 | ⏳ Decidir |
| 7 | **Un «no interesado»** ¿bloquea para siempre o 6 meses? | — | ⏳ Pregunta abierta a Carlos |
| 8 | **Correos de área** (`info@`, `ventas@`): 9 de los 25 de la lista | Incluirlos o excluirlos | ⏳ Decidir |
| 9 | **Quién recibe los avisos** de respuestas (PT2) y de fallas (B4) | Hoy llegan al Gmail de Fabián; cambiarlos al supervisor que clasifica y a quien atienda las fallas | ⏳ Decidir nombres |
| 10 | **Cuenta de SendGrid** pagada, con Inbound Parse incluido | Plan de pago con la tarjeta de la empresa, antes del 24-nov | ⏳ Pago de Dirección |
| 11 | **Quién atiende a los interesados** | Reparto automático entre el equipo de ventas (2 o 3 personas), elegidas en Administración → «Reparto de interesados» (§6). Hoy está apagado | ⏳ Dar de alta al equipo y elegir la lista |

## 2. Audiencia

**De dónde sale:** la lista de Carlos entra por la importación CSV del CRM, una persona revisa y confirma cada fila
(duplicados contra la base y contra el archivo) y un administrador o supervisor la manda a la fila de automatización
con la campaña del piloto. La automatización no crea prospectos por su cuenta.

**Quién entra a la fila** (control `D-06`): solo quien tiene giro, tamaño y un correo usable, no está en baja ni en la
lista de supresión, tiene menos de 3 correos en 6 meses, no tiene una espera abierta y no tiene otro prospecto de la
misma persona en la fila. Los demás regresan con su motivo.

**Cómo se certifica:** la [auditoría de datos](PROCEDIMIENTO_AUDITORIA.md) (§5 del reporte) da, por campaña, cuántos
prospectos están listos y por qué no los demás (desactivado, sin giro, sin tamaño, sin correo utilizable, en baja o
ya con 3 correos). Esa tabla, corrida después de cargar la lista, es la certificación.

| Campaña | En espera | Listos | Fuera, y por qué |
|---|---|---|---|
| ⏳ Piloto | Se llena en la semana 12 | | |

**Lo que falta para que la lista de Carlos pueda entrar:**
- **Tamaño de la empresa.** La lista no lo trae y sin él nadie entra a la fila. Se le pide a Carlos.
- **Giros escritos como los reconoce el sistema.** El score solo da puntos a los giros de su tabla (sin acentos ni
  mayúsculas), y las plantillas por giro solo se usan si el giro coincide. Uno escrito distinto vale 0 puntos
  ([evaluación del modelo](EVALUACION_DEL_MODELO.md), §7).
- **Borrar antes los datos de ejemplo** con `limpiar-datos-prueba.mjs`, para que no se mezclen.

## 3. Mensaje

- **Tres correos por persona:** el inicial y dos recordatorios. Se escriben en el CRM (Administración → Correos de
  prospección) y la API se los da armados a n8n. Hoy hay tres generales en borrador; se pueden agregar versiones por
  giro, que se usan cuando el giro de la empresa coincide.
- **Datos del prospecto en el texto:** el nombre de la persona, de la empresa y el giro, que el CRM pone en la
  plantilla. El texto **no** lo escribe la IA.
- **Pie:** domicilio y aviso de privacidad, en la misma sección del CRM, y la línea «¿Ya no quieres recibir estos
  correos? Darte de baja». La página de baja está en español.
- **Respuestas:** cada correo lleva su propia dirección de respuesta (`r+<prospecto>@respuestas.contacto…`), así que
  cada respuesta se liga a su prospecto y detiene sus recordatorios.
- **Remitente:** desde el subdominio `contacto.nano-bridge-mex.com`, verificado en SendGrid desde el 29-sep, para no
  afectar la reputación del correo normal de la empresa.
- **Idioma:** los correos van marcados como español desde el 3-nov (`00046-vrm`); antes Gmail ofrecía traducirlos
  del inglés.

**Riesgo abierto:** los correos de prueba caen en la pestaña **Promociones** de Gmail desde el molde del 22-oct.
Quitar el logo no bastó y el HTML sencillo se probó y se revirtió el 29-oct. Una persona que no ve el correo no
responde, así que el resultado del piloto depende de esto (T2).

## 4. Secuencia y límites

| Regla | Valor | Control |
|---|---|---|
| Correos por persona | Máximo 3 cada 6 meses | `D-03` |
| Espera entre correos | 5 días hábiles, a la misma hora; el recordatorio sale el día hábil siguiente al vencimiento | `D-03` |
| Días hábiles | Lunes a viernes, sin los feriados de la Ley Federal del Trabajo | `215-dia-habil-mx` |
| Tope diario de correos | 20 al encender (incluye recordatorios, que van primero) | `D-05` |
| Nuevos por día | Hasta 10, sin pasar del tope | `D-05` |
| Solo prospectos validados | Uno sin validar no recibe correo | `D-04` |
| Campaña | Solo una activa manda; pausar = esperar (nadie pierde su lugar) | `230-recordatorios` |

**Qué cabe en el piloto.** La semana del piloto (30-nov a 4-dic) son 5 días hábiles. Sin recordatorios todavía, el
tope de 20 no se alcanza y el límite es de 10 nuevos al día: una lista de unos 30 prospectos listos sale en 3 días.

**Los recordatorios casi no caben antes del cierre (9-dic).** Calculado con la regla de días hábiles del sistema:

| Correo inicial | Primer recordatorio |
|---|---|
| Lunes 30-nov | Martes 8-dic |
| Martes 1-dic | Miércoles 9-dic (día del cierre) |
| Del 2 al 4-dic | Después del cierre |

Ningún segundo recordatorio cae dentro del proyecto. **El piloto mide sobre todo la respuesta al primer correo.** Si
Dirección quiere ver la secuencia completa, hay que empezar antes o seguir después del cierre.

## 5. Exclusiones

A nadie de esta lista le sale un correo, aunque esté en la campaña:

| Quién | Por qué | Control |
|---|---|---|
| Persona en la lista de supresión | Pidió la baja, marcó spam o su correo rebotó | `D-01` |
| Persona en baja | Se le dio de baja por respuesta o por evento de SendGrid; no se deshace | `D-02` |
| Prospecto cerrado | `interesado`, `no_interesado`, `descartado`, `excluido` o `inactivo` | `230-recordatorios` |
| Sin correo utilizable | No hay a dónde escribir | `D-06` |
| Ya con 3 correos en 6 meses o con una espera abierta | Límite de contacto | `D-03` |
| Respondió | Su respuesta cierra la espera y detiene los recordatorios | `200-respuestas-recibidas` |
| Cualquiera mientras siga el modo de prueba | Solo salen correos a los buzones del equipo | §7 |

## 6. Registros y vigilancia

**Qué queda escrito:** cada envío (`envios`), cada respuesta y su clasificación (`respuestas`), cada baja
(`lista_supresion`), cada cambio con el antes y el después (Registro de cambios) y cada falla de un flujo (incidencias y
procesos fallidos). Nada de esto se borra.

**Durante el piloto:**
- **Auditoría de datos diaria** (procedimiento §1), con atención a los dos controles rojos: personas con más de 3
  correos en 6 meses y medios activos que están en la lista de supresión. Cualquiera de los dos **detiene la campaña**.
- **Rebotes y quejas** en SendGrid: si los rebotes pasan de 2 % o las quejas de 0.1 %, se pausa y se revisa.
- **Avisos automáticos:** B4 avisa por correo de cualquier falla de un flujo, y Cloud Monitoring avisa si la API se
  cae (revisión cada 5 minutos).
- **Respuestas:** cada una cae en la cola de clasificación; una persona la clasifica (la IA solo sugiere). Un
  «interesado» crea la tarea «Contactar prospecto interesado», que vence al final del siguiente día hábil. Desde la
  cola, «Responder ahora» deja contestarle de inmediato, y quien lo hace se queda con la tarea.
- **Reparto de interesados** (en producción desde el 3-nov, `00046-vrm`, **apagado**): prendido, la tarea le toca al
  vendedor de la lista con menos interesados abiertos; si empatan, al que lleva más tiempo sin recibir uno. Si la
  empresa ya es de un vendedor activo, va con él. Quien la recibe queda como responsable de la empresa y le llega el
  aviso. Apagado, la tarea queda sin asignar y un supervisor la reparte. Empieza apagado a propósito, para que ningún
  interesado real le caiga a una cuenta de prueba.
- **Métricas del modelo** M1 a M5 ([evaluación del modelo](EVALUACION_DEL_MODELO.md), §4), para el reporte del piloto.

## 7. Modo de prueba

Hoy **todo está en modo de prueba**: `MODO_PRUEBAS` encendido en PT1 y PT4, y solo salen correos a una lista corta de
buzones del equipo; cualquier otro destinatario se descarta. Así se probó en vivo:

| Fecha | Prueba | Resultado |
|---|---|---|
| 6-oct | Recordatorios (PT4) | Llegaron |
| 8-oct | Baja por el link del pie | El prospecto quedó en baja y su correo en «no contactar» |
| 13-oct | Tercer correo (PT4) | Llegaron los 3, con el link de baja; nada a los dados de baja |
| 16-oct | Un prospecto de la fila pasa por PT1 | Validado, score 47, el correo llegó a Gmail |
| 19-oct | Respuesta tardía con sugerencia de la IA | La cola la mostró con su sugerencia |
| 29-oct | Página de baja en español | Funciona |

**Faltan en vivo:** una respuesta automática (fuera de oficina), un correo sin firma y un rebote.

## 8. Lista de encendido

La lista completa, con los comandos, está en el [RUNBOOK](../RUNBOOK_DEPLOY.md), §10. Se recorre entera el día de
encender, después de la autorización. Resumen al 3-nov:

| Paso | Estado |
|---|---|
| Textos aprobados y domicilio en el pie y en el remitente | ⏳ Carlos |
| SendGrid pagado con Inbound Parse | ⏳ Dirección, antes del 24-nov |
| Datos de ejemplo borrados y lista de Carlos cargada | ⏳ Semana 12 |
| Pruebas en vivo que faltan (fuera de oficina, sin firma, rebote) | ⏳ T2 |
| Avisos de PT2 y B4 a las personas correctas | ⏳ Decidir nombres |
| Equipo de ventas dado de alta y reparto de interesados prendido | ⏳ Antes de encender |
| Tope diario a 20 | ⏳ El día de encender |
| Horario de PT1a (y PT4, si se mueve a las 9:00) | ⏳ El día de encender |
| Apagar `MODO_PRUEBAS` en PT1 y PT4 | ⏳ Lo último, el día de encender |
| Link y página de baja, respaldos, feriados, PT5, botón «Mandar a automatización» | ✅ Hechos |

## 9. Cómo se detiene

- **Una campaña:** Prospectos → Campañas → Pausar. Nadie pierde su lugar: al reanudar, los recordatorios salen
  repartidos por el tope diario.
- **Todo:** volver a encender `MODO_PRUEBAS` en PT1 y PT4, o quitar el horario de PT1a y PT4 en n8n.
- **Una persona:** una baja (por su link, por su respuesta o desde la cola de clasificación) detiene todo lo suyo de
  inmediato y cancela sus seguimientos.

## 10. Para pasar a v1.0

1. Certificación de audiencia con la lista de Carlos cargada (§2).
2. Textos aprobados de los 3 correos y el domicilio (§3).
3. Las decisiones abiertas del §1.
4. Las pruebas en vivo que faltan (§7).
5. Qué se hará con lo de Promociones (§3).
6. La lista del reparto de interesados (§1, decisión 11).
