import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { HttpError } from "../../shared/http-error.js";
import { ROLES_KEY } from "../decorators/roles.decorator.js";
import type { CurrentUser } from "../current-user.type.js";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<CurrentUser["rol"][] | undefined>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { currentUser?: CurrentUser }>();
    if (!request.currentUser || !requiredRoles.includes(request.currentUser.rol)) {
      throw new HttpError(403, "No tienes permiso para esta acción");
    }
    return true;
  }
}
