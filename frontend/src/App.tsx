import { lazy, Suspense, type ComponentType } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { ProtectedRoute } from "./components/ProtectedRoute";

// Cada pantalla se baja al entrar a ella (15-oct-2026): con todas juntas el
// bundle pasaba de 800 KB y el Login esperaba a que llegara entero. El Login
// va directo porque es lo primero que se ve.
const perezosa = <K extends string>(cargar: () => Promise<Record<K, ComponentType>>, nombre: K) => lazy(() => cargar().then((m) => ({ default: m[nombre] })));
const DashboardPage = perezosa(() => import("./pages/DashboardPage"), "DashboardPage");
const EmpresasListPage = perezosa(() => import("./pages/EmpresasListPage"), "EmpresasListPage");
const FichaClientePage = perezosa(() => import("./pages/FichaClientePage"), "FichaClientePage");
const ProspectosPage = perezosa(() => import("./pages/ProspectosPage"), "ProspectosPage");
const AdministracionPage = perezosa(() => import("./pages/AdministracionPage"), "AdministracionPage");
const ContactosPage = perezosa(() => import("./pages/ContactosPage"), "ContactosPage");
const CotizacionesPage = perezosa(() => import("./pages/CotizacionesPage"), "CotizacionesPage");
const DocumentosPage = perezosa(() => import("./pages/DocumentosPage"), "DocumentosPage");
const OportunidadesPage = perezosa(() => import("./pages/OportunidadesPage"), "OportunidadesPage");
const ReportesPage = perezosa(() => import("./pages/ReportesPage"), "ReportesPage");
const TareasPage = perezosa(() => import("./pages/TareasPage"), "TareasPage");

// Catálogo de la base común: solo en `npm run dev`, no entra al build.
const MuestraBasePage = import.meta.env.DEV ? perezosa(() => import("./pages/MuestraBasePage"), "MuestraBasePage") : null;

function App() {
  return (
    // Mientras llega una pantalla, solo el fondo (sin texto que parpadee).
    <Suspense fallback={<div className="min-h-dvh bg-bg" />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {MuestraBasePage && <Route path="/base" element={<MuestraBasePage />} />}

        <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />

        <Route path="/empresas" element={<ProtectedRoute><EmpresasListPage /></ProtectedRoute>} />
        <Route path="/empresas/:id" element={<ProtectedRoute><FichaClientePage /></ProtectedRoute>} />

        <Route path="/contactos" element={<ProtectedRoute><ContactosPage /></ProtectedRoute>} />
        <Route path="/prospectos" element={<ProtectedRoute><ProspectosPage /></ProtectedRoute>} />
        <Route path="/tareas" element={<ProtectedRoute><TareasPage /></ProtectedRoute>} />
        <Route path="/oportunidades" element={<ProtectedRoute><OportunidadesPage /></ProtectedRoute>} />
        <Route path="/cotizaciones" element={<ProtectedRoute><CotizacionesPage /></ProtectedRoute>} />
        <Route path="/documentos" element={<ProtectedRoute><DocumentosPage /></ProtectedRoute>} />
        {/* Un agente también entra: solo ve Reportes · Día, lo suyo (GET /reportes/dia). */}
        <Route path="/reportes" element={<ProtectedRoute><ReportesPage /></ProtectedRoute>} />
        <Route
          path="/administracion"
          element={
            <ProtectedRoute soloRoles={["administrador", "supervisor"]}>
              <AdministracionPage />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
