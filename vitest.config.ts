import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts"],
    globalSetup: ["./test/setup/global-setup.ts"],
    setupFiles: ["./test/setup/setup-env.ts"],
    // Todas las pruebas comparten UN solo contenedor MySQL real (ver
    // global-setup.ts) -- correr archivos de prueba en paralelo dejaría que
    // se pisen entre sí en invariantes globales como "al menos un
    // administrador activo". Dentro de cada archivo, los tests ya corren
    // secuenciales por default.
    fileParallelism: false,
    testTimeout: 20_000,
    // Arrancar el contenedor MySQL (descarga de imagen incluida la primera
    // vez) puede tardar más que el timeout normal de un hook.
    hookTimeout: 120_000
  }
});
