import { Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { EmpresasListPage } from "./pages/EmpresasListPage";
import { FichaClientePage } from "./pages/FichaClientePage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { ProspectosPage } from "./pages/ProspectosPage";
import { AdministracionPage } from "./pages/AdministracionPage";
import { ContactosPage } from "./pages/ContactosPage";
import { OportunidadesPage } from "./pages/OportunidadesPage";
import { ReportesPage } from "./pages/ReportesPage";
import { TareasPage } from "./pages/TareasPage";
import { ProtectedRoute } from "./components/ProtectedRoute";

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />

      <Route path="/empresas" element={<ProtectedRoute><EmpresasListPage /></ProtectedRoute>} />
      <Route path="/empresas/:id" element={<ProtectedRoute><FichaClientePage /></ProtectedRoute>} />

      {/* Resto de módulos: nav completa desde el inicio, contenido real
          llega fase por fase (ver PlaceholderPage.tsx). */}
      <Route path="/contactos" element={<ProtectedRoute><ContactosPage /></ProtectedRoute>} />
      <Route path="/prospectos" element={<ProtectedRoute><ProspectosPage /></ProtectedRoute>} />
      <Route path="/tareas" element={<ProtectedRoute><TareasPage /></ProtectedRoute>} />
      <Route path="/oportunidades" element={<ProtectedRoute><OportunidadesPage /></ProtectedRoute>} />
      <Route path="/cotizaciones" element={<ProtectedRoute><PlaceholderPage titulo="Cotizaciones" fase="Cotizaciones y documentos" /></ProtectedRoute>} />
      <Route path="/documentos" element={<ProtectedRoute><PlaceholderPage titulo="Documentos" fase="Cotizaciones y documentos" /></ProtectedRoute>} />
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
