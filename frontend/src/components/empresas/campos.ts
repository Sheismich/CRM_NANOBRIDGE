import { z } from "zod";

// Validaciones compartidas por EmpresaForm y ContactoForm. Son copia
// deliberada de src/crm/dto/empresa.schema.ts del backend (front y back son
// proyectos separados): los campos opcionales llegan del formulario como ""
// y se aceptan vacíos; la conversión a undefined/null la hacen los helpers
// de abajo antes de mandar la petición.

export const textoOpcional = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`);

export const urlOpcional = z
  .string()
  .trim()
  .max(2048, "Máximo 2048 caracteres")
  .refine((v) => v === "" || /^https?:\/\/[^\s]+\.[^\s]+/i.test(v), "URL no válida; debe empezar con http:// o https://");

export const correoOpcional = z
  .string()
  .trim()
  .max(254, "Máximo 254 caracteres")
  .refine((v) => v === "" || z.email().safeParse(v).success, "Correo no válido");

// Mismo criterio que tieneDigitosSuficientes (src/shared/normalize.ts):
// al menos 7 dígitos, no solo 7 caracteres.
export const telefonoOpcional = z
  .string()
  .trim()
  .max(40, "Máximo 40 caracteres")
  .refine((v) => v === "" || (v.replace(/\D/g, "").length >= 7 && v.length >= 7), "Debe contener al menos 7 dígitos");

export const TAMANOS = [
  { valor: "micro", etiqueta: "Micro" },
  { valor: "pequena", etiqueta: "Pequeña" },
  { valor: "mediana", etiqueta: "Mediana" },
  { valor: "grande", etiqueta: "Grande" }
] as const;

// Alta: un campo vacío no se manda (el backend lo toma como "sin dato").
export function sinVacios<T extends Record<string, string>>(valores: T) {
  return Object.fromEntries(Object.entries(valores).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, v.trim()]));
}

// Edición (PATCH parcial): solo los campos que el usuario tocó; vaciar uno
// manda null, que el backend interpreta como "borrar el valor" (y en un
// medio de contacto, marcarlo obsoleto).
export function soloCambios<T extends Record<string, string>>(valores: T, sucios: Partial<Record<keyof T, unknown>>) {
  return Object.fromEntries(
    Object.keys(valores)
      .filter((k) => sucios[k as keyof T])
      .map((k) => {
        const v = valores[k].trim();
        return [k, v === "" ? null : v];
      })
  );
}
