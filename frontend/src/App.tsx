import { Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { EmpresasListPage } from "./pages/EmpresasListPage";
import { FichaClientePage } from "./pages/FichaClientePage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
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
      <Route path="/contactos" element={<ProtectedRoute><PlaceholderPage titulo="Contactos" fase="Fundacional" /></ProtectedRoute>} />
      <Route path="/prospectos" element={<ProtectedRoute><PlaceholderPage titulo="Prospectos" fase="Prospectos" /></ProtectedRoute>} />
      <Route path="/tareas" element={<ProtectedRoute><PlaceholderPage titulo="Tareas" fase="Historial y ventas" /></ProtectedRoute>} />
      <Route path="/oportunidades" element={<ProtectedRoute><PlaceholderPage titulo="Oportunidades" fase="Historial y ventas" /></ProtectedRoute>} />
      <Route path="/cotizaciones" element={<ProtectedRoute><PlaceholderPage titulo="Cotizaciones" fase="Cotizaciones y documentos" /></ProtectedRoute>} />
      <Route path="/documentos" element={<ProtectedRoute><PlaceholderPage titulo="Documentos" fase="Cotizaciones y documentos" /></ProtectedRoute>} />
      <Route
        path="/reportes"
        element={
          <ProtectedRoute soloRoles={["administrador", "supervisor"]}>
            <PlaceholderPage titulo="Reportes" fase="Desempeño" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/administracion"
        element={
          <ProtectedRoute soloRoles={["administrador", "supervisor"]}>
            <PlaceholderPage titulo="Administración" fase="Administración" />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
