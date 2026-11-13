import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { CurrentUser } from "./current-user.decorator";
import type { TokenPayload } from "./jwt.utils";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: { email?: string; password?: string }) {
    return this.authService.login(body);
  }

  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() body: { name?: string; email?: string; password?: string }) {
    return this.authService.register(body);
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  async getMe(@CurrentUser() user: TokenPayload) {
    return this.authService.getMe(user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch("me")
  async updateMe(
    @CurrentUser() user: TokenPayload,
    @Body() body: { name?: unknown; currentPassword?: unknown; newPassword?: unknown }
  ) {
    return this.authService.updateMe(user, body);
  }
}
