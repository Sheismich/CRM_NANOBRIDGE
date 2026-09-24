# CRM NANOBRIDGE — Frontend

Interfaz web del CRM de prospección outbound. Vive dentro de este mismo
repo, en `frontend/` -- proyecto de Node separado del backend (su propio
`package.json`, su propio árbol de dependencias), pero mismo repositorio
y mismo historial de git (decisión del 24-sep-2026: monorepo en vez de
repo aparte). Consume la API de `../` (ver el README de la raíz del
repo). El diseño calca 1:1 los mockups del artifact "CRM NANOBRIDGE —
Mockups" (colores, tipografías, layout de cada pantalla).

## Stack

React 19 + TypeScript + Vite, React Router, TanStack Query, React Hook
Form + Zod, Tailwind CSS v4 — el mismo stack que recomienda
`../docs/planes/PLAN_FRONTEND.md` §3, salvo shadcn/ui: los mockups no usan
componentes de shadcn (son marcado + estilos propios), así que se
replicaron los tokens de diseño directamente en `src/index.css` en vez de
instalar una librería de componentes que hubiera divergido del mockup.

## Cómo correr esto

1. `cd frontend && npm install` (dependencias propias, no se comparten con
   las del backend en la raíz del repo).
2. Backend corriendo en `http://localhost:3000` (desde la raíz del repo:
   `npm run migrate` + `npm run start:dev` — en desarrollo normalmente ni
   hace falta tocar `CORS_ORIGINS`, ver la nota del proxy abajo).
3. `npm run dev` (dentro de `frontend/`) — abre `http://localhost:5173`.

**Sobre CORS en desarrollo:** `vite.config.ts` pone un proxy de `/api`
hacia el backend, así que el navegador solo habla con `localhost:5173` (un
solo origen) y la cookie de sesión viaja sin problema, sin que el backend
necesite `CORS_ORIGINS` para desarrollo local. `CORS_ORIGINS` sí importa
para producción (ver más abajo).

## Variables de entorno

Ver `.env.example`. Solo hace falta `VITE_API_URL` cuando el backend local
corre en otro puerto, o para apuntar el build de producción al backend
real de Cloud Run.

## Estructura

```
src/
  types.ts                 tipos calcados del contrato HTTP real del backend
                            (snake_case, igual que responde cada *.service.ts)
  lib/
    api.ts                 cliente fetch: credentials:"include", maneja
                            el contrato de error del backend ({error,message})
    auth-context.ts         AuthContext + useAuth()
    auth.tsx                AuthProvider (GET /auth/me al cargar la app)
  components/
    layout/                 Sidebar, Topbar, AppShell (calco del mockup)
    ProtectedRoute.tsx       redirige a /login sin sesión; oculta por rol
                            (UX -- el backend ya aplica el permiso real)
    ui/                      Card, Button
  pages/
    LoginPage.tsx
    DashboardPage.tsx        resumen de pipeline (admin/supervisor) o
                            bandeja propia (agente)
    EmpresasListPage.tsx
    FichaClientePage.tsx     pestaña "Información y contactos" completa;
                            el resto de pestañas son PlaceholderPage
    PlaceholderPage.tsx      módulos que llegan en fases siguientes
```

## Qué ya funciona (fase Fundacional, `../docs/planes/PLAN_FRONTEND.md` §6)

Probado de punta a punta contra el backend real (bootstrap → login →
crear empresa con Facebook/Instagram → listar → ver ficha), no solo
`npm run build`:

- Login/sesión vía cookie (`POST /auth/login`, `GET /auth/me`), logout.
- Layout con navegación por rol (Reportes/Administración solo
  administrador/supervisor).
- Lista de empresas, paginada (`GET /empresas`).
- Ficha de cliente — pestaña de información y contactos, con sus medios de
  contacto agrupados y coloreados por estado (activo / no_contactar /
  obsoleto).

## Qué falta

Todo lo demás del plan de pantallas: Contactos, Prospectos (importación
CSV), Tareas/cola de clasificación, Oportunidades (embudo), Cotizaciones,
Documentos (subida), Reportes (incluida la tabla "Desempeño por agente"
que ya expone `GET /reportes/desempeno-por-agente`) y Administración. Cada
uno ya tiene su lugar en el sidebar y su ruta (`App.tsx`), mostrando un
`PlaceholderPage` hasta construirse — ver el plan de fases en
`../docs/planes/PLAN_FRONTEND.md` §6.

Las demás pestañas de la Ficha de cliente (Historial, Oportunidades,
Cotizaciones, Documentos de esa empresa) también están pendientes, mismo
criterio.

## Despliegue

Sin configurar todavía. `../docs/planes/PLAN_FRONTEND.md` §3 recomienda Firebase Hosting
(mismo proyecto de GCP que ya usa la API) para el build estático de Vite
(`npm run build` → `dist/`). Para producción, el backend necesita la URL
real del frontend en `CORS_ORIGINS` (a diferencia de desarrollo, sin
proxy de por medio ahí sí aplica CORS de verdad).
