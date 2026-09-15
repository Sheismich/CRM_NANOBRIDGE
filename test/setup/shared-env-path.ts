import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Ruta compartida entre global-setup.ts (la escribe una sola vez) y
// setup-env.ts (la lee en cada archivo de prueba) -- ver comentario en
// global-setup.ts sobre por qué no basta con una variable en memoria.
export const ENV_FILE = join(fileURLToPath(new URL(".", import.meta.url)), ".test-env.json");
