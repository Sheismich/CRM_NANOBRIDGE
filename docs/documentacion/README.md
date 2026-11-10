# Documentación de datos · T1 (proyecto naranja · outbound)

Entregables de **T1 · Datos y estandarización** del Programa integrado de 16 semanas de NANO BRIDGE.
Cierre del proyecto: **9 de diciembre de 2026**.

| Documento | Para qué sirve | Programa | Estado |
|---|---|---|---|
| [Resumen para la revisión G4](G4_RESUMEN.md) y [acta](actas/2026-11-G4.md) | Una página con lo que se entrega, los indicadores, lo que se pide decidir y los riesgos; el acta se llena en la junta | G4 | Listo para la junta |
| [Bitácora del proyecto](BITACORA.md) | Avance contra el programa, expediente de entregables, documentación que falta, control de cambios y riesgos (KPI C3) | Todo el proyecto | Corte al 3-nov |
| [Diccionario de datos y reglas](DICCIONARIO_DE_DATOS.md) | Cada tabla y campo de la base: formato, obligatoriedad, fuente, identificador, reglas de duplicados y de actualización | OB-01 · G4 | ✅ v1.2 (10-nov, regenerado con las migraciones 041 y 042) |
| [Reporte de controles](REPORTE_DE_CONTROLES.md) | Los 37 controles que protegen la base, dónde viven y con qué se comprueban (KPI T1.3) | OB-02 · G4 | ✅ v1.0 (28-oct) |
| [Flujo de actualización](FLUJO_DE_ACTUALIZACION.md) | Cómo entran y cambian los registros con la automatización: alta, cambio, rechazo, registro, reversión y sus pruebas | OB-03 · G4 | ✅ v1.2 (10-nov, con el encendido y las campañas) |
| [Evaluación del modelo](EVALUACION_DEL_MODELO.md) | Dónde se usa Gemini, con qué datos, quién revisa, cómo se mide y qué resultados hay | OB-04 · G4 | ✅ v1.0 (3-nov); resultados sobre muestra en el piloto |
| [Auditoría de calidad · 28-oct](auditorias/calidad-2026-10-28.md) | Línea base de validez y duplicados (KPI T1.1 y T1.2) con conclusiones y acciones | Semana 9 · G4 | ✅ |
| [Procedimiento de auditoría y actualización](PROCEDIMIENTO_AUDITORIA.md) | Cuándo y cómo auditar, qué hacer con cada hallazgo, qué hacer tras una migración | Semana 11 | ✅ v1.0 (adelantado) |
| [Inventario de accesos](INVENTARIO_DE_ACCESOS.md) | Quién tiene acceso a Google Cloud, SendGrid, n8n, dominio, Gemini, GitHub y el CRM, y qué pasar a alguien de planta antes del cierre | OB-07 · cierre | 🟡 v0.9 (4-nov, adelantado): faltan datos de n8n, AI Studio y DNS |
| [Manual del vendedor](MANUAL_DEL_VENDEDOR.md) | Cómo usar el CRM día a día: tu día, empresas y contactos, prospectos y respuestas, oportunidades, cotizaciones, documentos y reportes | OB-07 · cierre | 🟡 v0.9.2 (10-nov, adelantado), con capturas y varias campañas: falta lo que deje la operación |
| [Manual operativo de la automatización](MANUAL_OPERATIVO_AUTOMATIZACION.md) | Qué corre solo y cuándo, qué revisar cada día, cómo prender, pausar y apagar, parámetros y qué hacer si algo falla | OB-07 · cierre | 🟡 v0.9.1 (10-nov, adelantado): faltan los accesos |
| [Manual de datos](MANUAL_DE_DATOS.md) | Cómo cargar, revisar, corregir y mantener los datos en el CRM | OB-07 · cierre | ✅ v1.0 (adelantado) |
| [Reporte del piloto](REPORTE_DEL_PILOTO.md) | Qué se envió, qué respondieron, fallas, integridad y el modelo; los números salen de `reporte-piloto.mjs` | OB-06 · 4 y 11-dic | 🟡 esqueleto 0.2 (10-nov), con el script por campaña probado |
| [Carga de la lista de Carlos](CARGA_DE_LA_LISTA.md) | Qué pedirle a Carlos, el orden seguro de limpieza, carga y certificación en producción, y el ensayo | Semana 12 | ✅ v1.1 (10-nov, para campañas activas) |
| [Propuesta de textos de los correos](PROPUESTA_CORREOS.md) | Los 3 correos de prospección y el pie, para que Carlos los apruebe; marca lo que falta escribir | G5 | ✅ Carlos aprobó los textos (5-nov) |
| [Flujo de campaña](FLUJO_DE_CAMPANA.md) | Lo que Dirección necesita para autorizar el piloto: audiencia, mensaje, límites, exclusiones, registros, vigilancia y cómo se detiene | OB-05 · G5 | 🟡 v0.9 (10-nov, encendido y dos campañas): falta la audiencia certificada |
| Certificación de audiencia | Cuántos prospectos de cada campaña recibirían correo y por qué no los demás | Semana 13 · G5 | Sale sola en cada auditoría (§5); se presenta en G5 |
| Monitoreo durante el piloto | Integridad de la base cada día de la campaña | Semana 14 | Auditoría diaria (procedimiento §1) |
| [Reporte final de T1](REPORTE_FINAL_T1.md) | KPI acumulados, auditorías, controles, pendientes, transferencia y lecciones | Cierre (9-dic) | 🟡 esqueleto (5-nov): se llena con la lista de Carlos y el piloto |

## Herramientas

- [`generar-diccionario.mjs`](generar-diccionario.mjs) + [`diccionario.plantilla.md`](diccionario.plantilla.md): regeneran el
  diccionario desde la base real después de cada migración.
- [`auditar-datos.mjs`](auditar-datos.mjs): auditoría de calidad de solo lectura; deja un reporte con fecha en
  [`auditorias/`](auditorias/), sin datos personales.
- [`limpiar-datos-prueba.mjs`](limpiar-datos-prueba.mjs): borra los datos de prueba antes del piloto. Por omisión solo
  muestra; para borrar exige la lista de empresas (todas reconocidas como de prueba) y una confirmación, y lo hace todo
  o nada. Probado en la base local el 28-oct; en producción se corre el día del encendido, con T2 (Manual de datos §8).

## Relacionado

- [RUNBOOK de despliegue](../RUNBOOK_DEPLOY.md): migraciones (§6), respaldos y recuperación (§9), lista de encendido (§10),
  avisos si el CRM se cae (§11).
- Planes del proyecto en [`docs/planes/`](../planes/).
