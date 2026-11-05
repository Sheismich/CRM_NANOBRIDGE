# Revisión G4 · CDR — Resumen para Dirección

Proyecto naranja (outbound) · Semana 10 de 16 (2-6 nov 2026) · Corte al 5 de noviembre de 2026.
El detalle de todo está en la [bitácora](BITACORA.md); aquí solo lo que hace falta para la junta.

## 1. Qué se entrega

| Código | Entregable | Versión | Estado |
|---|---|---|---|
| OB-01 | [Diccionario de datos y reglas](DICCIONARIO_DE_DATOS.md) | 1.0 · 28-oct | ✅ Listo |
| OB-02 | [Reporte de controles](REPORTE_DE_CONTROLES.md) y [auditoría de calidad](auditorias/calidad-2026-10-28.md) | 1.0 · 28-oct | ✅ Listo |
| OB-03 | [Flujo de actualización](FLUJO_DE_ACTUALIZACION.md) | 1.0 · 3-nov | ✅ Listo |
| OB-04 | [Evaluación del modelo](EVALUACION_DEL_MODELO.md) | 1.0 · 3-nov | ✅ Listo; resultados sobre muestra en el piloto |
| OB-05 | [Flujo de campaña](FLUJO_DE_CAMPANA.md) | 0.5 · 3-nov | 🟡 Borrador; es de G5 y se completa con la lista de Carlos |
| Apoyo | [Procedimiento de auditoría](PROCEDIMIENTO_AUDITORIA.md) y [manual de datos](MANUAL_DE_DATOS.md) | 1.0 · 28-oct | ✅ Adelantados |

## 2. Indicadores

| Indicador | Resultado | Cómo leerlo |
|---|---|---|
| **T1.1 · Validez y completitud** | 98.4 % | Línea base sobre **datos de ejemplo**: mide que el método funciona, no la calidad de la base real |
| **T1.2 · Control de duplicados** | 96.8 % | Igual: los duplicados que aparecen son de las pruebas y se borran antes de cargar la lista real |
| **T1.3 · Controles operativos** | 36 de 37 (97 %) | Los demás están activos y tienen su prueba o verificación. F-05 (avisos hacia n8n) nunca entregó nada, porque n8n no tiene quién los reciba, y se retira |
| Pruebas automáticas | 845 de 845 (API) y 34 de 34 (pantallas) | Sobre el código que está en producción (5-nov). Corren solas en GitHub en cada cambio |

La medición que vale para T1.1 y T1.2 es la auditoría que se corra **después de cargar la lista de Carlos** (semana 12).

## 3. Lo que ya está en producción

Servidor `00049-7dm` y pantallas en Firebase, en **modo de prueba** (ningún correo sale a prospectos reales). Desde G3:
botón «Mandar a automatización», correos editables, IA en modo sugerencia, responder y resumir con IA, feriados en los
días hábiles, aviso y fusión de empresas repetidas, cotización por correo, reparto de interesados (apagado), «Dar de
baja» desde la ficha, freno automático del dominio, correos fallidos que no gastan el contacto, interesados sin atender
que se escalan, seguimiento de cotizaciones y la espera de 6 meses tras un «no interesado» (decisión de Carlos).

## 4. Lo que se pide decidir hoy

1. **Fecha de cierre:** confirmar por escrito el **9 de diciembre** (el PDF del programa dice el 18).
2. **Métricas del modelo:** en G3 no se aprobó ninguna. Se proponen las 5 de OB-04 §4 (acuerdo entre la IA y la
   persona, bajas que la IA no vio, si la prioridad predice la respuesta, disponibilidad y uso del borrador).
3. **Entregables de las semanas 5, 7 y 8** (reporte de carga, paquete PDR y base v0.8): aceptarlos con lo que hay en
   el repositorio o pedir un documento propio.
4. **Cambios por registrar:** hay 12 en el control de cambios de la bitácora (§5) que necesitan la decisión de
   Dirección (aceptado o no).
5. **Quién atiende a los interesados:** dar de alta al equipo de ventas (2 o 3 personas) para prender el reparto
   automático antes del piloto.

## 5. Riesgos principales

| Riesgo | Qué hace falta | Quién |
|---|---|---|
| **SendGrid vence el 24-nov** | Carlos confirmó que se paga el plan (4-nov). Falta que se haga antes del 24-nov y confirmar que incluye Inbound Parse (sin él no llegan las respuestas) | Dirección |
| **La lista de Carlos no trae el tamaño de la empresa** | Sin tamaño, ninguna empresa entra a la automatización | Carlos |
| **Los correos caen en Promociones de Gmail** | Quien no ve el correo no responde | T2 |
| **Los recordatorios casi no caben antes del cierre** | Solo los correos del 30-nov y del 1-dic alcanzan su primer recordatorio; el piloto mide sobre todo la respuesta al primer correo | Dirección: aceptarlo o empezar antes |

## 6. De aquí a G5 (23-27 nov)

| Cuándo | Qué | Quién |
|---|---|---|
| Esta semana | Tamaño de las empresas, textos de los 3 correos y domicilio para el pie | Carlos |
| Antes del 24-nov | Pago de SendGrid (ya confirmado por Carlos) | Dirección |
| Semana 11 | Pruebas en vivo que faltan (fuera de oficina, correo sin firma, rebote) | T2 |
| Semana 12 | Borrar los datos de ejemplo, cargar la lista y correr la auditoría (certificación de audiencia) | T1 y T2 |
| Semana 13 · G5 | OB-05 v1.0 y autorización escrita del piloto | Equipo y Dirección |
