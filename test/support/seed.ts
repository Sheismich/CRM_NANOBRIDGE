import type { INestApplication } from "@nestjs/common";
import request from "supertest";

// Credenciales fijas de la cuenta administradora "semilla". Todos los
// archivos de prueba comparten UN solo contenedor MySQL durante toda la
// corrida (ver global-setup.ts), pero Vitest NO garantiza que los archivos
// se ejecuten en orden alfabético/numérico -- por defecto reordena por
// tamaño de archivo para balancear mejor el trabajo (comprobado en vivo:
// 20-usuarios-last-admin corrió antes que 00-auth). Por eso ensureSeedAdmin()
// es idempotente (bootstrap-o-login) y es lo único que cualquier archivo
// debe llamar para obtener una sesión de administrador -- nunca asumir que
// "otro archivo ya la creó primero".
export const SEED_ADMIN = {
  nombre: "Admin Semilla",
  correo: "admin.semilla@test.local",
  password: "password_semilla_1"
};

export async function loginAs(app: INestApplication, correo: string, password: string) {
  const res = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ correo, password });
  if (res.status !== 200) {
    throw new Error(`loginAs(${correo}) falló con status ${res.status}: ${JSON.stringify(res.body)}`);
  }
  const cookie = res.headers["set-cookie"];
  if (!cookie) throw new Error(`loginAs(${correo}) no devolvió cookie de sesión`);
  return cookie as unknown as string[];
}

// Intenta crear la cuenta semilla; si otro archivo ya lo hizo primero
// (409 "la cuenta inicial ya fue creada"), simplemente inicia sesión con
// las mismas credenciales fijas. Cualquier otro status es un error real.
export async function ensureSeedAdmin(app: INestApplication) {
  const res = await request(app.getHttpServer()).post("/api/v1/auth/bootstrap").send(SEED_ADMIN);
  if (res.status !== 201 && res.status !== 409) {
    throw new Error(`ensureSeedAdmin: bootstrap devolvió ${res.status} inesperado: ${JSON.stringify(res.body)}`);
  }
  return loginAs(app, SEED_ADMIN.correo, SEED_ADMIN.password);
}
