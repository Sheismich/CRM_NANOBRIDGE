# Plan definitivo de implementación del CRM

## Decisiones de diseño cerradas

- El modelo central es `empresas` -> `contactos` -> `prospectos`.
- Una empresa tiene muchos contactos; un contacto puede tener varios prospectos o ciclos de automatización.
- `prospectos` representa el registro de captación, scoring y automatización de un contacto.
- Una oportunidad comercial pertenece a una empresa y puede tener un contacto principal.
- El backend es la única vía de acceso a MySQL. El frontend CRM nunca consulta la base directamente.
- El CRM y la API viven en un backend modular único.
- La baja aplica al contacto, no a toda la empresa. Cuando una persona pide la baja al responder un correo, se suprimen **todos** sus medios de contacto (correo, teléfono y WhatsApp), no solo el canal por el que respondió (regla del 25-sep-2026). Cada medio queda como una fila propia en `lista_supresion`, y los demás contactos de la misma empresa no se tocan. Una supresión que no nace de una respuesta (por ejemplo, el link de baja del proveedor de correo) sigue aplicando al medio específico.
- Las llamadas y WhatsApp se registran manualmente en la primera versión.
- Las oportunidades se crean cuando un prospecto interesado es tomado por un asesor, no automáticamente por score alto.

## Modelo de datos objetivo

### Entidades base

- `usuarios`
- `roles`
- `empresas`
- `contactos`
- `medios_contacto`
- `prospectos`
- `campanas`
- `tareas`
- `actividades`
- `eventos_pendientes`
- `procesos_fallidos`
- `auditoria`

### Entidades comerciales

- `oportunidades`
- `catalogo_etapa_embudo`
- `catalogo_motivo_perdida`
- `historial_etapa_oportunidad`
- `cotizaciones`
- `cotizacion_partidas`
- `documentos`
- `catalogo_tipo_documento`
- `metricas_comerciales_diarias`

## Módulos del CRM

### 1. Autenticación, usuarios y permisos

- Sesión con cookies seguras y contraseñas usando Argon2id.
- Roles: administrador, supervisor, agente y sistema.
- El agente ve sus empresas, contactos, tareas y oportunidades asignadas.
- El supervisor ve la información de su equipo.
- El administrador gestiona usuarios, catálogos, parámetros y auditoría.

### 2. Empresas y contactos

- Ficha de empresa: nombre, giro, tamaño, región, país, sitio web y estado.
- Contactos: nombre, puesto, correo, teléfono, redes sociales y estado de contacto.
- Los medios corporativos compartidos pertenecen a la empresa, no a un contacto individual.
- No se borra información; se desactiva o se marca como obsoleta.

### 3. Prospectos e importación

- Alta manual e importación CSV.
- Validación de correo, teléfono, giro, tamaño y canal.
- Coincidencia de duplicados por correo normalizado y después por teléfono normalizado.
- La razón social nunca fusiona prospectos automáticamente.
- Los borradores viven en `borradores_captura`, expiran a los 30 días y no activan automatización.

### 4. Historial integral

Una línea de tiempo unificada por empresa, contacto y oportunidad muestra:

- Correos enviados y recibidos.
- Llamadas y WhatsApp registrados manualmente.
- Comentarios del asesor.
- Documentos enviados.
- Tareas y seguimientos.
- Confirmaciones de revisión.
- Respuestas negativas, inactividad y reactivaciones.
- Fecha, responsable, canal, resultado y próxima acción.

La línea de tiempo es una vista de lectura: no duplica la información que ya generan automatización, tareas o documentos.

### 5. Tareas, clasificación y reingresos

- Bandeja de tareas por responsable, estado, prioridad y SLA.
- Cola de clasificación manual.
- Cierre de tarea de corrección, clasificación manual y reactivación generan eventos en `eventos_pendientes`.
- El patrón outbox es obligatorio: ninguna pantalla llama a n8n directamente.
- Los eventos fallidos son visibles y reintentables desde la pantalla de eventos pendientes.

### 6. Oportunidades y pipeline

| Etapa | Probabilidad |
| --- | ---: |
| Calificada | 10% |
| Descubrimiento | 25% |
| Propuesta | 50% |
| Negociación | 75% |
| Verbalmente ganada | 90% |
| Ganada | 100% |
| Perdida | 0% |

- Las oportunidades ganadas o perdidas quedan cerradas.
- Una pérdida exige motivo.
- Una oportunidad perdida puede reabrirse, conservando su historial.
- El ciclo comercial no modifica el ciclo de automatización del prospecto.

Motivos de pérdida: sin presupuesto, sin necesidad, sin respuesta, competidor, fuera de perfil, decisión pospuesta, contacto inválido u otro con explicación obligatoria.

### 7. Cotizaciones

- Cotizaciones ligadas a empresa, oportunidad y contacto.
- Moneda inicial: MXN.
- Importes con `DECIMAL`, nunca `float`.
- Campos: subtotal, descuento, impuestos, total, fecha de emisión, fecha de envío, fecha esperada de cierre y probabilidad.
- Una edición crea una nueva versión; la versión anterior queda obsoleta.
- Estados: borrador, enviada, aceptada, rechazada, vencida y obsoleta.

### 8. Expediente documental

- Archivos en Google Cloud Storage privado.
- Metadatos, permisos y vínculos en MySQL.
- URL firmadas de corta duración para descarga.
- Tamaño inicial máximo: 25 MB.
- Tipos permitidos: PDF, DOCX, XLSX, PNG y JPG.
- Cada carga, descarga, revisión, versión y cambio de estado queda auditado.
- La política de retención será configurable y aprobada por la empresa.

### 9. Dashboards y reportes

- Actividades por agente.
- Tareas cerradas y vencidas.
- Conversiones por etapa.
- Oportunidades abiertas, ganadas y perdidas.
- Ingresos cerrados.
- Valor de pipeline.
- Forecast mensual: monto por probabilidad y fecha estimada de cierre.
- Exportación de reportes.

## Fases de implementación

1. Migraciones, usuarios, roles, sesiones, auditoría y health check.
2. Empresas, contactos, prospectos, importación y tareas.
3. Outbox, eventos pendientes, cola de clasificación y reingresos n8n.
4. Historial unificado, oportunidades y pipeline.
5. Cotizaciones y expediente documental.
6. Métricas, dashboards y reportes.

## Criterio de terminado

El CRM permite capturar una empresa, registrar contactos, automatizar un prospecto, atender tareas, llevar historial, abrir una oportunidad, emitir cotizaciones, adjuntar documentos y consultar resultados comerciales sin perder trazabilidad.
