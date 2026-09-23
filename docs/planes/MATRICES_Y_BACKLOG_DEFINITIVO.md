# Matrices y backlog definitivo

## Decisiones cerradas

| Tema | Decisión |
| --- | --- |
| Modelo de clientes | Empresa, contacto y prospecto son entidades separadas. |
| Backend | Un backend modular único, sin acceso directo a MySQL desde CRM o n8n. |
| Pipeline | Calificada, descubrimiento, propuesta, negociación, verbalmente ganada, ganada y perdida. |
| Cotizaciones | MXN, importes DECIMAL e historial de versiones inmutable. |
| Métricas | Job diario interno del backend; el frontend solo consulta resultados. |
| Documentos | Google Cloud Storage privado y metadatos en MySQL. |
| Supresión | Aplica por contacto y medio; no por toda la empresa. |
| Llamadas y WhatsApp | Captura manual en la primera versión. |
| Reintentos | Tres intentos: 5 s, 30 s y 120 s. |
| Mensajería | Correo primero; WhatsApp posterior con proveedor aprobado. |

## Puede iniciar hoy

1. Crear repositorio y estructura base.
2. Configurar TypeScript, linting, pruebas y variables de entorno.
3. Implementar migraciones versionadas.
4. Crear schema base: usuarios, roles, empresas, contactos, prospectos y auditoría.
5. Construir autenticación y control de roles.
6. Crear health check.
7. Implementar stub API y colección de pruebas.
8. Cerrar B0 de n8n.
9. Crear `eventos_pendientes` y su despachador.
10. Implementar empresas, contactos y captura de prospectos.

## Prioridad siguiente

1. Tareas y cola de clasificación.
2. Endpoints de automatización.
3. Sustitución de MOCK por HTTP.
4. Oportunidades y pipeline.
5. Historial de interacciones (reordenado 10-sep-2026: es una vista de lectura que agrega lo que generan otros módulos — PLAN_CRM_DEFINITIVO.md #4; construirla antes de Oportunidades dejaría `oportunidad_id` nullable sin FK y habría que retrabajarla).
6. Cotizaciones.
7. Documentos.
8. Métricas y dashboards.

## Dependencias

| Trabajo | Depende de |
| --- | --- |
| Reingresos CRM a n8n | Outbox CRM y webhooks B3 |
| Sustituir MOCK | Endpoints API probados |
| Documentos | Storage privado y permisos |
| Dashboard | Oportunidades, actividades y job diario |
| WhatsApp | Proveedor, plantillas y consentimiento |

## Primera tarea de desarrollo

Crear la base del proyecto con migraciones y las tablas:

- `usuarios`
- `roles`
- `empresas`
- `contactos`
- `medios_contacto`
- `prospectos`
- `auditoria`

Después, implementar autenticación, roles y alta de empresa con contactos.
