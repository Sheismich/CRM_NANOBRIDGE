import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import App from "./App.tsx";
import { AuthProvider } from "./lib/auth.tsx";
import { aplicarTemaInicial } from "./lib/tema";

aplicarTemaInicial();

// Después de publicar una versión nueva, quien tenía el CRM abierto pide el
// código de una pantalla con el nombre viejo, que ya no existe. Vite avisa con
// este evento: se recarga una vez para traer la versión nueva. El candado de
// 10 s evita recargar en bucle si el problema es otro (sin internet).
window.addEventListener("vite:preloadError", (evento) => {
  try {
    const ultima = Number(sessionStorage.getItem("recarga-por-version") ?? 0);
    if (Date.now() - ultima < 10_000) return;
    sessionStorage.setItem("recarga-por-version", String(Date.now()));
  } catch {
    return;
  }
  evento.preventDefault();
  window.location.reload();
});

const queryClient = new QueryClient({
  defaultOptions: {
    // El backend ya distingue 401 (sin sesión) del resto de errores --
    // reintentar una petición fallida por permisos no la arregla, solo
    // demora el mensaje de error.
    queries: { retry: false }
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
