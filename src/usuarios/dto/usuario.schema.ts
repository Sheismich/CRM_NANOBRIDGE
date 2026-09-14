import { z } from "zod";

// 'sistema' deliberadamente excluido de los roles asignables aquí: ese rol
// es exclusivo de ApiKeyGuard (llamadas de n8n), nunca de sesión de
// usuario -- auth.service.ts login() y session-auth.guard.ts ya lo
// rechazan explícitamente los dos por separado. Dejar crear una cuenta con
// ese rol desde aquí produciría un usuario que nunca puede iniciar sesión.
const rolAsignableSchema = z.enum(["administrador", "supervisor", "agente"]);

export const crearUsuarioSchema = z.object({
  nombre: z.string().trim().min(2).max(160),
  correo: z.string().trim().email().max(254).transform((v) => v.toLowerCase()),
  password: z.string().min(12).max(128),
  rol: rolAsignableSchema
});
export type CrearUsuarioInput = z.infer<typeof crearUsuarioSchema>;

// Todos los campos opcionales (PATCH parcial): un campo ausente deja el
// valor actual sin tocar (mismo patrón que updateCompanySchema en
// crm/dto/empresa.schema.ts). `password`, si viene, se reemplaza por
// completo -- no hay "password anterior" que conservar.
export const actualizarUsuarioSchema = z
  .object({
    nombre: z.string().trim().min(2).max(160).optional(),
    correo: z.string().trim().email().max(254).transform((v) => v.toLowerCase()).optional(),
    rol: rolAsignableSchema.optional(),
    password: z.string().min(12).max(128).optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Debes incluir al menos un campo para actualizar" });
export type ActualizarUsuarioInput = z.infer<typeof actualizarUsuarioSchema>;

export const listarUsuariosQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  rol: z.enum(["administrador", "supervisor", "agente", "sistema"]).optional(),
  // OJO: z.coerce.boolean() en zod trata CUALQUIER string no vacío (incluido
  // "false") como true -- Boolean("false") === true en JS. Por eso este
  // filtro usa z.enum(["true","false"]) + transform manual, no
  // z.coerce.boolean(), para que ?activo=false funcione de verdad.
  activo: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true"))
});
export type ListarUsuariosQuery = z.infer<typeof listarUsuariosQuerySchema>;
