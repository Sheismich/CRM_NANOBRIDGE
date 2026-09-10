import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service.js";
import { SessionService } from "./session.service.js";
import { SessionAuthGuard } from "./guards/session-auth.guard.js";
import { CurrentUser } from "./decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "./current-user.type.js";
import { bootstrapSchema, credentialsSchema } from "./dto/credentials.schema.js";
import { env } from "../config/env.js";

@Controller("api/v1/auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService
  ) {}

  @Post("bootstrap")
  @HttpCode(201)
  async bootstrap(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const input = bootstrapSchema.parse(body);
    const { user, session } = await this.authService.bootstrap(input);
    this.sessionService.setSessionCookie(response, session.token, session.expiresAt);
    return user;
  }

  @Post("login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const input = credentialsSchema.parse(body);
    const { user, session } = await this.authService.login(input);
    this.sessionService.setSessionCookie(response, session.token, session.expiresAt);
    return user;
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.sessionService.deleteSession(request.cookies?.[env.SESSION_COOKIE_NAME] as string | undefined);
    this.sessionService.clearSessionCookie(response);
  }

  @Get("me")
  @UseGuards(SessionAuthGuard)
  me(@CurrentUser() user: CurrentUserType) {
    return user;
  }
}
