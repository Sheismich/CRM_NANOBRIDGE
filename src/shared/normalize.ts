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
