import { SetMetadata } from "@nestjs/common";
import type { CurrentUser } from "../current-user.type.js";

export const ROLES_KEY = "roles";

/** Reemplaza a requireRole(...roles): marca qué roles puede usar una ruta. RolesGuard lee esta metadata. */
export const Roles = (...roles: CurrentUser["rol"][]) => SetMetadata(ROLES_KEY, roles);
