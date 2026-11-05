# Reporte final de T1 · Datos y estandarización

**Entregable:** reporte final de T1 (cierre del proyecto naranja · outbound).
**Para:** revisión de cierre (G6, 9 de diciembre de 2026). **Redacta:** T1 · **Revisión:** T2 y Dirección General.
**Versión:** 0.1 · esqueleto del 5 de noviembre de 2026. Lo marcado ⏳ se llena con la auditoría después de cargar
la lista de Carlos (semana 12), con las auditorías diarias del piloto (30-nov al 4-dic) y al cierre.

## 1. Resumen

⏳ Al cierre: en cinco renglones, cómo quedó la base, los tres indicadores contra la meta, qué se entrega y qué queda
pendiente.

## 2. Qué se entregó

| Código | Entregable | Versión final | Dónde |
|---|---|---|---|
| OB-01 | Diccionario de datos y reglas | 1.0 (28-oct) ⏳ regenerar al cierre | [DICCIONARIO_DE_DATOS.md](DICCIONARIO_DE_DATOS.md) |
| OB-02 | Base controlada: reporte de controles y auditorías | 1.1 (4-nov) ⏳ | [REPORTE_DE_CONTROLES.md](REPORTE_DE_CONTROLES.md), [auditorias/](auditorias/) |
| Semana 11 | Procedimiento de auditoría y actualización | 1.0 (28-oct) | [PROCEDIMIENTO_AUDITORIA.md](PROCEDIMIENTO_AUDITORIA.md) |
| Semana 13 | Certificación de audiencia | ⏳ | Auditoría después de cargar la lista (§5 del reporte) |
| Semana 14 | Monitoreo de integridad durante el piloto | ⏳ | Una auditoría por día del piloto |
| OB-07 (datos) | Manual de datos | 1.0 (28-oct) ⏳ | [MANUAL_DE_DATOS.md](MANUAL_DE_DATOS.md) |

Además, desde el 3-nov T1 se encarga de toda la documentación: flujo de actualización (OB-03), evaluación del modelo
(OB-04), flujo de campaña (OB-05), manual operativo, manual del vendedor, inventario de accesos y la bitácora. Su estado
final está en la [bitácora](BITACORA.md).

## 3. Indicadores

Se calculan con [`auditar-datos.mjs`](auditar-datos.mjs) sobre la población completa (no una muestra): empresas activas,
contactos activos, medios de contacto y prospectos.

| Indicador | Meta | Línea base · 28-oct (datos de ejemplo) | Tras cargar la lista · semana 12 | Promedio del piloto | Final · cierre |
|---|---|---|---|---|---|
| **T1.1 · Validez y completitud** | ⏳ la del programa | 98.4 % (122 de 124) | ⏳ | ⏳ | ⏳ |
| **T1.2 · Control de duplicados** | ⏳ la del programa | 96.8 % (4 sin resolver) | ⏳ | ⏳ | ⏳ |
| **T1.3 · Controles operativos** | ⏳ la del programa | 37 de 37 (28-oct) · 36 de 37 (4-nov, F-05 se retira) | ⏳ | — | ⏳ |

**Cómo leer la línea base:** la base del 28-oct era de ejemplo, así que mide que el método funciona, no la calidad de
datos reales. Los números que cuentan son los de la columna «Tras cargar la lista» en adelante.

⏳ Al cierre: una gráfica o tabla por día del piloto (T1.1 y T1.2) y qué explica cada cambio.

## 4. Controles

- **Planificados para el corte:** 37, en seis grupos (integridad, validación, duplicados, protección de las personas,
  acceso y trazabilidad, operación). Detalle en el [reporte de controles](REPORTE_DE_CONTROLES.md).
- **F-05 (avisos hacia n8n)** nunca entregó nada, porque n8n no tenía quién los recibiera, y se retiró el 4-nov. Los
  avisos que sí importan llegan por la campanita y el correo del CRM.
- **Controles propuestos que se hicieron:** G-01 (avisar de empresas con el mismo nombre al importar y dar de alta) y
  G-05 (fusionar empresas repetidas), en producción desde el 3-nov.
- **Agregados después del corte:** «Dar de baja» desde la ficha para quien la pide por teléfono (4-nov). ⏳ Los que
  entren con el PR de T2: freno automático del dominio, envíos fallidos que no gastan el contacto.
- ⏳ Al cierre: el T1.3 final, con los controles nuevos que se hayan aprobado.

## 5. Auditorías

| Fecha | Momento | T1.1 | T1.2 | Hallazgos | Reporte |
|---|---|---|---|---|---|
| 28-oct | Línea base (datos de ejemplo) | 98.4 % | 96.8 % | Duplicados solo de pruebas; 2 empresas sin giro ni tamaño, también de ejemplo | [calidad-2026-10-28](auditorias/calidad-2026-10-28.md) |
| ⏳ | Después de borrar los datos de ejemplo y cargar la lista de Carlos | | | | |
| ⏳ | Días 1 a 5 del piloto | | | | |
| ⏳ | Cierre | | | | |

## 6. Incidentes de datos

⏳ Durante el piloto: cualquier correo que no debió salir, persona con más de 3 correos, medio activo en la lista de
supresión, duplicado que entró, y qué se hizo con cada uno. Si no hubo ninguno, decirlo con la evidencia (las
auditorías diarias).

## 7. Pendientes y recomendaciones

Ya identificados (se confirma al cierre cuáles siguen abiertos):

| # | Pendiente | Por qué | Esfuerzo |
|---|---|---|---|
| 1 | Catálogo de giros, o normalizarlos al capturar (G-02) | Un giro escrito distinto vale 0 en el score y no usa la plantilla de su giro | Bajo |
| 2 | Teléfonos en formato internacional (G-03) | «442…» y «52442…» cuentan como dos personas | Medio |
| 3 | Regla de asignación de las empresas sin responsable (G-04) | El reparto de interesados resuelve las de los interesados; falta decidir el resto | Decisión de Dirección |
| 4 | Pasar `archiver` a la versión 8 | Avisos moderados de seguridad, que hoy el CRM no usa | Bajo, con sus pruebas |
| 5 | Auditoría semanal después del piloto | Que la base no se degrade sin que nadie lo vea | Procedimiento de auditoría |

## 8. Transferencia

| Qué | A quién | Dónde |
|---|---|---|
| Correr la auditoría y leer el reporte | ⏳ persona de planta | [Procedimiento de auditoría](PROCEDIMIENTO_AUDITORIA.md) |
| Cargar, revisar y corregir datos | Vendedores y supervisores | [Manual de datos](MANUAL_DE_DATOS.md) y [manual del vendedor](MANUAL_DEL_VENDEDOR.md) |
| Regenerar el diccionario tras una migración | ⏳ quien mantenga el CRM | [`generar-diccionario.mjs`](generar-diccionario.mjs) |
| Borrar datos de prueba | ⏳ | [`limpiar-datos-prueba.mjs`](limpiar-datos-prueba.mjs) |
| Accesos y cuentas | Dirección | [Inventario de accesos](INVENTARIO_DE_ACCESOS.md) |

⏳ Al cierre: confirmar que la persona de planta corrió al menos una auditoría por su cuenta.

## 9. Lecciones aprendidas

Las que ya se ven (se completan al cierre):

- **Medir con datos reales lo antes posible.** La base de ejemplo sirvió para probar el método, pero los indicadores que
  valen llegaron hasta la semana 12. Cargar una muestra real antes habría adelantado los hallazgos.
- **La documentación junto al código** (en el repositorio, con su historial) permitió que cada cambio quedara fechado y
  con evidencia, que es lo que pide el KPI de trazabilidad.
- **Probar como en producción.** Las pruebas automáticas en GitHub, con la misma versión de Node que producción,
  encontraron dos errores que en la compu de desarrollo no salían (4-nov).
- ⏳ Las del piloto.
