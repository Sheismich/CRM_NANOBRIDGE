import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import App from "./App.tsx";
import { AuthProvider } from "./lib/auth.tsx";

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
