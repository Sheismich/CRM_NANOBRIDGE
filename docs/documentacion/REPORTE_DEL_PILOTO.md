# Reporte del piloto · CRM NANOBRIDGE (OB-06)

**Para:** Dirección, para decidir qué sigue después del piloto.
**Versión:** 0.1 · esqueleto del 6 de noviembre de 2026. La v0.8 se entrega al terminar el piloto (4-dic) y la final
con los ajustes de la semana 15 (11-dic).
**Quién:** Datos (Daniela) y Automatización (Fabián).

Es un reporte de hechos: qué se envió, qué respondieron, qué falló y qué pasó con los datos. **No lleva conclusiones
que los números no respalden.** Con unos 7 correos nuevos al día durante 5 días habrá pocas respuestas, así que cada
porcentaje va con su número de casos.

**De dónde salen los números:** [`reporte-piloto.mjs`](reporte-piloto.mjs) los calcula de la base de producción y
deja el detalle en `piloto/numeros-<fecha>.md` (§10). Lo marcado ⏳ se llena con eso.

## 1. Resumen

⏳ Al terminar: en cinco renglones, cuántos correos salieron y a cuántas personas, cuántas respondieron y cuántas
están interesadas, si algún control falló y qué se propone.

## 2. Qué se autorizó

| Qué | Autorizado en G5 | Cómo quedó |
|---|---|---|
| Fecha de la autorización escrita | ⏳ | — |
| Audiencia | ⏳ certificada en la semana 12 ([carga de la lista](CARGA_DE_LA_LISTA.md)) | ⏳ cuántos recibieron correo |
| Mensaje | Los 3 correos aprobados por Carlos ([flujo de campaña](FLUJO_DE_CAMPANA.md) §3) | ⏳ ¿se cambió algo durante el piloto? |
| Límites | 20 correos al día en total, 10 nuevos | ⏳ ¿se respetaron? (§3) |
| Fechas | 30-nov al 4-dic | ⏳ |

## 3. Qué se envió

⏳ La tabla de §1 de `numeros-<fecha>.md`: correos por día y por número (1, 2 o 3), confirmados, sin confirmar y
fallidos.

Controles que deben dar 0 (si no, es un incidente, §7):

| Control | Resultado |
|---|---|
| Personas con más de 3 correos en 6 meses | ⏳ |
| Correos a una dirección que ya estaba suprimida | ⏳ |

Con el cierre el 9-dic, solo los correos del 30-nov y del 1-dic alcanzan su primer recordatorio (8 y 9-dic) y ningún
segundo recordatorio cae dentro del proyecto. El piloto mide sobre todo la respuesta al primer correo.

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
| Rebotes | ⏳ | ⏳ | debajo de 2 % para subir el tope |
| Quejas de spam | ⏳ | ⏳ | debajo de 0.1 % |
| ¿Se activó el freno del dominio? | ⏳ | — | 2 quejas o 5 rebotes en 7 días |

⏳ ¿Cayeron los correos en Promociones de Gmail? (revisar los buzones de prueba del equipo cada día).

## 6. Interesados

⏳ §4 de `numeros-<fecha>.md`: cuántas tareas «Contactar prospecto interesado», cuántas se atendieron, en cuánto tiempo
y cuántas se escalaron por llevar un día hábil sin atender. Si el reparto automático estuvo prendido, a quién le tocaron.

## 7. Fallas e incidentes

| Fecha | Qué pasó | A quién afectó | Qué se hizo | Quedó resuelto |
|---|---|---|---|---|
| ⏳ | | | | |

Se anota: cada aviso «[NANOBRIDGE] Falló …» de B4 y cada «CRM caído», las incidencias y procesos fallidos (§5 de
`numeros-<fecha>.md`) y cualquier control rojo de la auditoría diaria (§8). Un correo que no debió salir es siempre
un incidente, aunque sea uno.

## 8. Integridad de la base durante el piloto

Una auditoría por día ([procedimiento](PROCEDIMIENTO_AUDITORIA.md)):

| Día | T1.1 | T1.2 | Controles rojos | Reporte |
|---|---|---|---|---|
| 30-nov | ⏳ | ⏳ | ⏳ | ⏳ |
| 1-dic | ⏳ | ⏳ | ⏳ | ⏳ |
| 2-dic | ⏳ | ⏳ | ⏳ | ⏳ |
| 3-dic | ⏳ | ⏳ | ⏳ | ⏳ |
| 4-dic | ⏳ | ⏳ | ⏳ | ⏳ |

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
2. `PILOTO_DB_URL="mysql://…" node docs/documentacion/reporte-piloto.mjs` (por omisión, del 30-nov al 4-dic; se
   puede cambiar con `--desde=`, `--hasta=` y `--campana=<id>`).
3. Revisar `piloto/numeros-<fecha>.md` y copiar aquí lo que corresponda. Correrlo de nuevo el 11-dic: las respuestas
   que lleguen después del 4-dic también cuentan.

El script solo lee y no escribe datos personales (cantidades e IDs). Se probó el 6-nov con un piloto simulado en una
base local: los números coincidieron con los calculados a mano, y los dos controles que deben dar 0 detectaron los
casos puestos a propósito.

## 11. Ajustes propuestos (semana 15)

⏳ Solo los que tengan evidencia en §3 a §9: qué se cambiaría, por qué (con el número que lo respalda) y quién lo
decide.
