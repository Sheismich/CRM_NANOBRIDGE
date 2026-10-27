/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Proxy de /api hacia el backend en desarrollo: así el navegador ve la API
// en el mismo origen que el frontend (localhost:5173) y la cookie de
// sesión (SameSite=Lax por default en el backend) viaja sin problemas de
// CORS ni de cookie de terceros. En producción (Firebase Hosting, ver
// firebase.json) el rewrite de /api/** a Cloud Run hace el mismo papel.
//
// Para usar producción desde local: $env:API_URL="https://…run.app"; npm run dev
// API_URL (sin VITE_) solo la lee este proxy. Con VITE_API_URL el navegador
// llamaría DIRECTO a la API desde localhost y producción lo rechaza (otro
// origen, la cookie no viaja): sale "Error inesperado" al entrar (13-oct-2026).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: process.env.API_URL ?? "http://localhost:3000",
        changeOrigin: true
      }
    }
  },
  // Pruebas de las funciones de lib/ (npm test). Con la hora de México, que es
  // la de los vendedores: los rangos de Reportes y los avisos de fechas dependen de ella.
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    env: { TZ: "America/Mexico_City" }
  }
});
