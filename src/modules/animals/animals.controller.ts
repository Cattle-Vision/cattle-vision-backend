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
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TokenPayload } from "../auth/jwt.utils";
import { AnimalsService } from "./animals.service";

@UseGuards(JwtAuthGuard)
@Controller("animals")
export class AnimalsController {
  constructor(private readonly animalsService: AnimalsService) {}

  @Get()
  list(
    @CurrentUser() user: TokenPayload,
    @Query("tag") tag?: string,
    @Query("summary") summary?: string,
    @Query("limit") limit?: string
  ) {
    return this.animalsService.listAnimals(user, { tag, summary, limit });
  }

  // Rotas estáticas registradas antes de `:id`
  @Post("rfid-scan")
  @HttpCode(HttpStatus.OK)
  rfidScan(@CurrentUser() user: TokenPayload, @Body() body: Record<string, unknown>) {
    return this.animalsService.rfidScan(user, body);
  }

  @Post("recalibrate")
  @HttpCode(HttpStatus.OK)
  recalibrateHerd(@CurrentUser() user: TokenPayload) {
    return this.animalsService.recalibrateHerd(user);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: TokenPayload, @Body() body: Record<string, unknown>) {
    return this.animalsService.createAnimal(user, body);
  }

  @Get(":id")
  getOne(@Param("id") id: string, @CurrentUser() user: TokenPayload) {
    return this.animalsService.getAnimalById(id, user);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @CurrentUser() user: TokenPayload,
    @Body() body: Record<string, unknown>
  ) {
    return this.animalsService.updateAnimal(id, user, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @CurrentUser() user: TokenPayload) {
    return this.animalsService.deleteAnimal(id, user);
  }

  @Post(":id/recalibrate")
  @HttpCode(HttpStatus.OK)
  recalibrateAnimal(@Param("id") id: string, @CurrentUser() user: TokenPayload) {
    return this.animalsService.recalibrateAnimal(id, user);
  }

  @Post(":id/collaborators")
  @HttpCode(HttpStatus.OK)
  addCollaborator(
    @Param("id") id: string,
    @CurrentUser() user: TokenPayload,
    @Body() body: Record<string, unknown>
  ) {
    return this.animalsService.addCollaborator(id, user, body);
  }

  @Delete(":id/collaborators/:userId")
  removeCollaborator(
    @Param("id") id: string,
    @Param("userId") targetUserId: string,
    @CurrentUser() user: TokenPayload
  ) {
    return this.animalsService.removeCollaborator(id, targetUserId, user);
  }

  @Post(":id/transfer-ownership")
  @HttpCode(HttpStatus.OK)
  transferOwnership(
    @Param("id") id: string,
    @CurrentUser() user: TokenPayload,
    @Body() body: Record<string, unknown>
  ) {
    return this.animalsService.transferOwnership(id, user, body);
  }
}
