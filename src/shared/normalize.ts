// Compartido entre crm/empresas.service.ts (alta manual) y
// automatizacion/automatizacion.service.ts (alta desde n8n): la
// deduplicación de contactos por correo/teléfono (PLAN_CRM_DEFINITIVO.md,
// módulo 3) depende de que ambos caminos normalicen exactamente igual. Si
// cada uno tuviera su propia copia, podrían desincronizarse y romper la
// deduplicación sin que nadie lo note.

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

// Cuenta solo los dígitos del valor (ignora separadores: espacios,
// guiones, paréntesis, "+"). z.string().min(7) sobre el texto crudo no
// basta para "parece un teléfono": un valor como "no-phone" (8
// caracteres) pasaba esa validación tal cual, pero normalizePhone() lo
// deja en "" -- insertarMediosContacto() entonces descarta el medio en
// silencio (su guard es `if (valor && valorNormalizado)`), así que un
// teléfono "válido" según el schema nunca llegaba a guardarse y quien
// llamó a la API no se enteraba (hallazgo de code review, 14-sep-2026).
// Se exporta para que los DTOs de teléfono/whatsapp lo usen en un
// .refine() antes de que el valor llegue a normalizePhone().
export function tieneDigitosSuficientes(value: string, minimo = 7): boolean {
  return (value.match(/\d/g) ?? []).length >= minimo;
}
