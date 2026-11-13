import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { AdminGuard } from "../auth/admin.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TokenPayload } from "../auth/jwt.utils";
import { AdminService } from "./admin.service";

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("admin")
  getStatus() {
    return { ok: true, admin: true };
  }

  @Get("admin/animals")
  listAnimals() {
    return this.adminService.listAnimals();
  }

  @Get("admin/users")
  listUsers(@CurrentUser() caller: TokenPayload) {
    return this.adminService.listUsers(caller);
  }

  private async sendExportZip(res: Response) {
    const { buffer, filename } = await this.adminService.buildExportZip();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(buffer.length));
    res.status(HttpStatus.OK).send(buffer);
  }

  @Get("admin/export")
  exportDataset(@Res() res: Response) {
    return this.sendExportZip(res);
  }

  @Get("export")
  exportDatasetAlias(@Res() res: Response) {
    return this.sendExportZip(res);
  }

  @Post("admin/recalibrate")
  @HttpCode(HttpStatus.OK)
  recalibrateAll() {
    return this.adminService.recalibrateAll();
  }

  @Post("admin/users")
  @HttpCode(HttpStatus.CREATED)
  createOrPromoteUser(
    @CurrentUser() caller: TokenPayload,
    @Body() body: Record<string, unknown>
  ) {
    return this.adminService.createOrPromoteUser(caller, body);
  }

  @Patch("admin/users/:id")
  updateUser(
    @Param("id") id: string,
    @CurrentUser() caller: TokenPayload,
    @Body() body: Record<string, unknown>
  ) {
    return this.adminService.updateUser(id, caller, body);
  }

  @Delete("admin/users/:id")
  deleteUser(@Param("id") id: string, @CurrentUser() caller: TokenPayload) {
    return this.adminService.deleteUser(id, caller);
  }
}
