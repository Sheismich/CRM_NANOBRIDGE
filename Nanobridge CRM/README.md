# Nanobridge CRM API

Backend modular único para el CRM y la automatización outbound. El CRM y n8n usan HTTP; solo este servicio ejecuta SQL en MySQL.

## Inicio local

1. Copia `.env.example` como `.env` y configura una instancia local de MySQL.
2. Instala dependencias con `npm install`.
3. Ejecuta `npm run migrate`.
4. Ejecuta `npm run dev`.

El health check queda disponible en `GET /health`.

## Módulos iniciales

- `auth`: sesiones con cookies seguras, roles y contraseñas Argon2id.
- `crm`: empresas, contactos, prospectos y tareas.
- `automatizacion`: contratos HTTP, outbox y callbacks de n8n.
- `comercial`: actividades, oportunidades y cotizaciones.
- `documentos`, `metricas`, `auditoria` y `workers`: reservados para sus fases del plan.

Las migraciones viven en `src/database/migrations` y son la única fuente de verdad del esquema.
