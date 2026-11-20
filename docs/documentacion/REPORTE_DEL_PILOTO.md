# Reporte del piloto · CRM NANOBRIDGE (OB-06)

**Para:** Dirección, para decidir qué sigue.
**Versión:** 0.5 · esqueleto del 20 de noviembre de 2026 (topes del 10-nov, bajas falsas del 11 y 12-nov, caídas del
17-nov y despliegue antes de migrar del 18-nov). El encendido se adelantó al 6-nov con autorización escrita de
Carlos, así que el «piloto» es la operación real desde el primer envío (9-nov) y no la semana del 30-nov al 4-dic que
marcaba el programa. La v0.8 se entrega en la semana 14 (4-dic) y la final con los ajustes de la semana 15 (11-dic).
**Quién:** Datos (Daniela) y Automatización (Fabián).

Es un reporte de hechos: qué se envió, qué respondieron, qué falló y qué pasó con los datos. **No lleva conclusiones
que los números no respalden.** Cada porcentaje va con su número de casos (con pocas respuestas un porcentaje
engaña), y todo se reporta también por campaña (hoy agua y tratamiento de maquinaria).

**De dónde salen los números:** [`reporte-piloto.mjs`](reporte-piloto.mjs) los calcula de la base de producción y
deja el detalle en `piloto/numeros-<fecha>.md` (§10). Lo marcado ⏳ se llena con eso.

## 1. Resumen

⏳ Al terminar: en cinco renglones, cuántos correos salieron y a cuántas personas, cuántas respondieron y cuántas
están interesadas, si algún control falló y qué se propone.

## 2. Qué se autorizó

| Qué | Autorizado | Cómo quedó |
|---|---|---|
| Autorización escrita | Carlos, 6-nov-2026 (encendido adelantado, sin lista cargada) | ⏳ dónde quedó guardada |
| Audiencia | Los contactos que Carlos cargue en sus campañas, certificados por campaña ([flujo de campaña](FLUJO_DE_CAMPANA.md) §2) | ⏳ cuántos recibieron correo, por campaña |
| Mensaje | Los 3 correos aprobados por Carlos; los propios de cada campaña si se escriben (flujo de campaña §3) | ⏳ ¿se cambió algo? |
| Límites | 20 correos al día en total y 10 nuevos al encender; desde el 10-nov, 100 y 75 nuevos en las variables, pero hasta el 16-nov salieron 10 nuevos al día porque PT1a pedía 10 (desde el 17-nov pide 75). 3 por persona y campaña, una serie a la vez | ⏳ ¿se respetaron? (§3) · ⏳ quién autorizó subir los topes |
| Fechas | Envíos de lunes a viernes desde el 9-nov | ⏳ periodo reportado |

## 3. Qué se envió

⏳ La tabla de §1 de `numeros-<fecha>.md`: correos por día y por número (1, 2 o 3), confirmados, sin confirmar y
fallidos.

Controles que deben dar 0 (si no, es un incidente, §7):

| Control | Resultado |
|---|---|
| Personas con más de 3 correos en 6 meses en una misma campaña | ⏳ |
| Personas a las que les empezaron dos campañas a la vez | ⏳ |
| Correos a una dirección que ya estaba suprimida | ⏳ |

⏳ La tabla por campaña de `numeros-<fecha>.md`: correos, personas, cuántas respondieron y cuántas están interesadas.

Para recibir los 3 correos antes del cierre del 9-dic, el primero tiene que haber salido a más tardar el 20-nov
(flujo de campaña §4); lo que empiece después mide sobre todo la respuesta al primer correo.

## 4. Qué respondieron

⏳ §2 de `numeros-<fecha>.md`: respuestas por clasificación, personas que respondieron (sin contar las respuestas
automáticas), personas interesadas y cuánto tardó la clasificación.

| | Casos | De cuántas personas | % |
|---|---|---|---|
| Respondieron | ⏳ | ⏳ | ⏳ |
| Interesadas | ⏳ | ⏳ | ⏳ |
| Pidieron la baja | ⏳ | ⏳ | ⏳ |

## 5. Bajas, rebotes y quejas

| | Casos | % de los correos | Límite |
|---|---|---|---|
| Rebotes | ⏳ | ⏳ | debajo de 2 % |
| Quejas de spam | ⏳ | ⏳ | debajo de 0.1 % |
| ¿Se activó el freno del dominio? | ⏳ | — | 2 quejas o 5 rebotes en 7 días |

Las tres bajas del 11 y 12-nov no las pidieron las personas (§7) y se revirtieron el 13-nov: se reportan aparte de las
bajas reales, igual que la que hizo por error la prueba de la página de baja. Desde el 13-nov,
las bajas por la página salen en el detalle con el motivo «Baja confirmada en la página de baja»; las de antes, con el
evento de SendGrid.

⏳ ¿Cayeron los correos en Promociones de Gmail? (revisar los buzones de prueba del equipo cada día).

## 6. Interesados

⏳ §4 de `numeros-<fecha>.md`: cuántas tareas «Contactar prospecto interesado», cuántas se atendieron, en cuánto tiempo
y cuántas se escalaron por llevar un día hábil sin atender. Si el reparto automático estuvo prendido, a quién le tocaron.

## 7. Fallas e incidentes

| Fecha | Qué pasó | A quién afectó | Qué se hizo | Quedó resuelto |
|---|---|---|---|---|
| 11 y 12-nov-2026 | El escáner de links de Microsoft 365 abrió el link de baja de SendGrid (que daba de baja con solo abrirlo) y tres prospectos quedaron en baja segundos después de recibir el correo, sin pedirlo (prospectos 70, 86 y 89) | 3 prospectos | Página de baja propia con botón (13-nov, PR #5, `00057-2tv`). Las tres bajas se revirtieron en la base (de vuelta a `validado`, medios activos, fuera de la lista de supresión, nota en `auditoria`) y se quitaron de Global Unsubscribes de SendGrid | Sí (13-nov) |
| 13-nov-2026 | La prueba de la página de baja en producción dio de baja por error a un prospecto real (147) | 1 prospecto | Se revirtió a mano en la base | Sí (13-nov) |
| 13 al 16-nov-2026 | PT1a estuvo pausada mientras se cambiaba el link de baja: no salieron primeros correos esos días | Toda la fila | Se prendió de nuevo; primera corrida el 17-nov | Sí (17-nov) |
| 17-nov-2026 | La API falló al reusar conexiones a la base que MySQL ya había cortado (`PROTOCOL_CONNECTION_LOST` en una petición real a las 12:24) y la revisión de la API falló 10 veces seguidas: alerta «CRM caído» a las 23:27. Otra alerta a las 12:29 fue del lado de Google (la API respondía bien) | ⏳ qué peticiones fallaron | El pool de conexiones cierra las inactivas (18-nov, `00059-rzt`) | Sí (18-nov) |
| 18-nov-2026 | Se desplegó la API `00060-4xj` antes de aplicar la migración 043 (en Cloud Shell no salió `Applied 043`): unos minutos con el código nuevo sin las columnas nuevas. Es la segunda vez que pasa (RUNBOOK §6) | Nadie: nadie abrió un Historial ni contestó en ese rato | La 043 se aplicó después, con la IP autorizada solo durante la migración | Sí. ⏳ Que el orden «migrar, revisar `Applied`, desplegar» quede como paso obligatorio |
| ⏳ | | | | |

Se anota: cada aviso «[NANOBRIDGE] Falló …» de B4 y cada «CRM caído», las incidencias y procesos fallidos (§5 de
`numeros-<fecha>.md`) y cualquier control rojo de la auditoría diaria (§8). Un correo que no debió salir es siempre
un incidente, aunque sea uno.

## 8. Integridad de la base durante la operación

Una auditoría por día hábil las primeras semanas, y luego una por semana ([procedimiento](PROCEDIMIENTO_AUDITORIA.md)):

| Fecha | T1.1 | T1.2 | Controles rojos | Reporte |
|---|---|---|---|---|
| ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |

## 9. El modelo

Las métricas de la [evaluación del modelo](EVALUACION_DEL_MODELO.md) §4, de §6 de `numeros-<fecha>.md`:

| Métrica | Resultado | Casos |
|---|---|---|
| M1 · Acuerdo IA-persona en la clasificación | ⏳ | ⏳ |
| M2 · Bajas que la IA no vio (debe ser 0) | ⏳ | ⏳ |
| M3 · ¿La prioridad predice la respuesta? | ⏳ por prioridad | ⏳ |
| M4 · Scores solo por reglas (Gemini no respondió) | ⏳ | ⏳ |
| M5 · Uso del borrador con IA | ⏳ | ⏳ |

Con estos números no se decide pasar la clasificación a modo directo: lo decide Dirección con un mínimo de casos
(evaluación del modelo §6).

## 10. Cómo se sacan los números

1. Autorizar la IP y leer la conexión a la base como en el RUNBOOK §6 (y revocar al terminar).
2. `PILOTO_DB_URL="mysql://…" node docs/documentacion/reporte-piloto.mjs` (por omisión, del 9-nov a hoy; se puede
   cambiar con `--desde=`, `--hasta=` y `--campana=<id>`).
3. Revisar `piloto/numeros-<fecha>.md` y copiar aquí lo que corresponda. Correrlo otra vez el 11-dic: las respuestas
   que lleguen después también cuentan.

El script solo lee y no escribe datos personales (cantidades e IDs). Se probó el 6-nov con un piloto simulado en una
base local: los números coincidieron con los calculados a mano, y los dos controles que deben dar 0 detectaron los
casos puestos a propósito. El 10-nov se pasó a la regla por campaña y se probó con dos campañas: no marca a quien
recibió 3 y 3 de dos campañas, y sí a quien recibió 4 de una o empezó dos a la vez.

## 11. Ajustes propuestos (semana 15)

⏳ Solo los que tengan evidencia en §3 a §9: qué se cambiaría, por qué (con el número que lo respalda) y quién lo
decide.
