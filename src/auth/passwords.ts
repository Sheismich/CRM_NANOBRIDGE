import argon2 from "argon2";

export function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id });
}

export function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}

// Hash real precalculado (de una contraseña fija arbitraria, nunca usada
// para nada más) para que login() pueda correr argon2.verify() incluso
// cuando el usuario no existe -- si se corta camino antes de verificar,
// una respuesta para un correo inexistente es mucho más rápida (solo un
// SELECT) que una para un correo real (SELECT + argon2id), filtrando por
// temporización qué correos tienen cuenta (hallazgo de code review,
// 10-sep-2026; mismo tipo de cuidado que ya existe en api-key.guard.ts
// con timingSafeEqual).
export const DUMMY_PASSWORD_HASH = "$argon2id$v=19$m=65536,p=4,t=3$bRZGqR0lmbV0ynAOYf2ykA$yRnOUuc08dZL4DeXPWJLwTIK5kM9e/B68jPPILX2RHo";
