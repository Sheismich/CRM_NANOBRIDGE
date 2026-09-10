import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { CurrentUser as CurrentUserType } from "../current-user.type.js";

/** Inyecta request.currentUser (dejado por SessionAuthGuard) directo como parámetro del handler. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): CurrentUserType => {
  const request = ctx.switchToHttp().getRequest<Request & { currentUser?: CurrentUserType }>();
  return request.currentUser as CurrentUserType;
});
