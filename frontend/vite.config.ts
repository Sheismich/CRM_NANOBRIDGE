import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Proxy de /api hacia el backend en desarrollo: así el navegador ve la API
// en el mismo origen que el frontend (localhost:5173) y la cookie de
// sesión (SameSite=Lax por default en el backend) viaja sin problemas de
// CORS ni de cookie de terceros. En producción (Firebase Hosting, ver
// PLAN_FRONTEND.md) esto no aplica: ahí el cliente llama VITE_API_URL
// directo y el backend necesita esa URL en CORS_ORIGINS.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL ?? "http://localhost:3000",
        changeOrigin: true
      }
    }
  }
});
