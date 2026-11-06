// Compartido entre crm/empresas.service.ts (alta manual) y
// automatizacion/automatizacion.service.ts (alta desde n8n): la
// deduplicación de contactos por correo/teléfono (PLAN_CRM_DEFINITIVO.md,
// módulo 3) depende de que ambos caminos normalicen exactamente igual. Si
// cada uno tuviera su propia copia, podrían desincronizarse y romper la
// deduplicación sin que nadie lo note.

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

// Ensayo de la carga de la semana 12 (6-nov-2026): "81 1234 5678" y
// "+52 81 1234 5678" quedaban como dos teléfonos distintos (la auditoría los
// marcaba como duplicado y la deduplicación no los juntaba), y "999 123 4567
// ext 12" se guardaba como 999123456712.
// - La extensión al final ("ext 12", "ext. 12", "extensión 12", "x 12", "#12")
//   no es parte del número: se quita antes de sacar los dígitos.
// - La lada de México (52, con o sin "+" o "00", y el "1" de los celulares que
//   ya no se usa) se quita solo si deja exactamente 10 dígitos.
// La migración 041 pasa a esta forma lo que ya estaba guardado; si se cambia
// aquí, hay que cambiarla allá también (MySQL no puede llamar a esta función).
const EXTENSION_AL_FINAL = /\s*(?:ext\.?|extensi[oó]n|x|#)\s*:?\s*\d{1,6}\s*$/i;

export function normalizePhone(value: string): string {
  let digitos = value.replace(EXTENSION_AL_FINAL, "").replace(/\D/g, "");
  if (digitos.startsWith("0052")) digitos = digitos.slice(2);
  if (digitos.length === 13 && digitos.startsWith("521")) return digitos.slice(3);
  if (digitos.length === 12 && digitos.startsWith("52")) return digitos.slice(2);
  return digitos;
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
  // Sin la extensión: "123 ext 4567" no tiene 7 dígitos de teléfono.
  return (value.replace(EXTENSION_AL_FINAL, "").match(/\d/g) ?? []).length >= minimo;
}
