import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { EmpresasListPage } from "./pages/EmpresasListPage";
import { FichaClientePage } from "./pages/FichaClientePage";
import { ProspectosPage } from "./pages/ProspectosPage";
import { AdministracionPage } from "./pages/AdministracionPage";
import { ContactosPage } from "./pages/ContactosPage";
import { CotizacionesPage } from "./pages/CotizacionesPage";
import { DocumentosPage } from "./pages/DocumentosPage";
import { OportunidadesPage } from "./pages/OportunidadesPage";
import { ReportesPage } from "./pages/ReportesPage";
import { TareasPage } from "./pages/TareasPage";
import { ProtectedRoute } from "./components/ProtectedRoute";

// Catálogo de la base común: solo en `npm run dev`, no entra al build.
const MuestraBasePage = import.meta.env.DEV ? lazy(() => import("./pages/MuestraBasePage").then((m) => ({ default: m.MuestraBasePage }))) : null;

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {MuestraBasePage && (
        <Route
          path="/base"
          element={
            <Suspense fallback={null}>
              <MuestraBasePage />
            </Suspense>
          }
        />
      )}

      <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />

      <Route path="/empresas" element={<ProtectedRoute><EmpresasListPage /></ProtectedRoute>} />
      <Route path="/empresas/:id" element={<ProtectedRoute><FichaClientePage /></ProtectedRoute>} />

      <Route path="/contactos" element={<ProtectedRoute><ContactosPage /></ProtectedRoute>} />
      <Route path="/prospectos" element={<ProtectedRoute><ProspectosPage /></ProtectedRoute>} />
      <Route path="/tareas" element={<ProtectedRoute><TareasPage /></ProtectedRoute>} />
      <Route path="/oportunidades" element={<ProtectedRoute><OportunidadesPage /></ProtectedRoute>} />
      <Route path="/cotizaciones" element={<ProtectedRoute><CotizacionesPage /></ProtectedRoute>} />
      <Route path="/documentos" element={<ProtectedRoute><DocumentosPage /></ProtectedRoute>} />
      <Route
        path="/reportes"
        element={
          <ProtectedRoute soloRoles={["administrador", "supervisor"]}>
            <ReportesPage />
          </ProtectedRoute>
        }
      />
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
  );
}

export default App;
