# Documentación de datos · T1 (proyecto naranja · outbound)

Entregables de **T1 · Datos y estandarización** del Programa integrado de 16 semanas de NANO BRIDGE.
Cierre del proyecto: **9 de diciembre de 2026**.

| Documento | Para qué sirve | Programa | Estado |
|---|---|---|---|
| [Diccionario de datos y reglas](DICCIONARIO_DE_DATOS.md) | Cada tabla y campo de la base: formato, obligatoriedad, fuente, identificador, reglas de duplicados y de actualización | OB-01 · G4 | ✅ v1.0 (28-oct) |
| [Reporte de controles](REPORTE_DE_CONTROLES.md) | Los 37 controles que protegen la base, dónde viven y con qué se comprueban (KPI T1.3) | OB-02 · G4 | ✅ v1.0 (28-oct) |
| [Auditoría de calidad · 28-oct](auditorias/calidad-2026-10-28.md) | Línea base de validez y duplicados (KPI T1.1 y T1.2) con conclusiones y acciones | Semana 9 · G4 | ✅ |
| [Procedimiento de auditoría y actualización](PROCEDIMIENTO_AUDITORIA.md) | Cuándo y cómo auditar, qué hacer con cada hallazgo, qué hacer tras una migración | Semana 11 | ✅ v1.0 (adelantado) |
| [Manual de datos](MANUAL_DE_DATOS.md) | Cómo cargar, revisar, corregir y mantener los datos en el CRM | OB-07 · cierre | ✅ v1.0 (adelantado) |
| Certificación de audiencia | Cuántos prospectos de cada campaña recibirían correo y por qué no los demás | Semana 13 · G5 | Sale sola en cada auditoría (§5); se presenta en G5 |
| Monitoreo durante el piloto | Integridad de la base cada día de la campaña | Semana 14 | Auditoría diaria (procedimiento §1) |
| Reporte final de T1 | KPI acumulados, pendientes y transferencia | Cierre (9-dic) | Pendiente |

## Herramientas

- [`generar-diccionario.mjs`](generar-diccionario.mjs) + [`diccionario.plantilla.md`](diccionario.plantilla.md): regeneran el
  diccionario desde la base real después de cada migración.
- [`auditar-datos.mjs`](auditar-datos.mjs): auditoría de calidad de solo lectura; deja un reporte con fecha en
  [`auditorias/`](auditorias/), sin datos personales.

## Relacionado

- [RUNBOOK de despliegue](../RUNBOOK_DEPLOY.md): migraciones (§6), respaldos y recuperación (§9), lista de encendido (§10),
  avisos si el CRM se cae (§11).
- Planes del proyecto en [`docs/planes/`](../planes/).
