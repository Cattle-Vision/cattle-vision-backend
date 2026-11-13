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
import { AnimalHealthService } from "./animal-health.service";

/**
 * Controller de Manejo, Saúde e Observações Gerais (`src/modules/animals/animal-health.controller.ts`).
 */
@UseGuards(JwtAuthGuard)
@Controller("animals/:id")
export class AnimalHealthController {
  constructor(private readonly healthService: AnimalHealthService) {}

  /* ── Vacinas ── */
  @Get("vaccines")
  listVaccines(@Param("id") animalId: string, @CurrentUser() user: TokenPayload) {
    return this.healthService.listVaccines(animalId, user);
  }

  @Post("vaccines")
  @HttpCode(HttpStatus.CREATED)
  createVaccine(
    @Param("id") animalId: string,
    @CurrentUser() user: TokenPayload,
    @Body() body: Record<string, unknown>
  ) {
    return this.healthService.createVaccine(animalId, user, body);
  }

  @Delete("vaccines/:vaccineId")
  deleteVaccine(
    @Param("id") animalId: string,
    @Param("vaccineId") vaccineId: string,
    @CurrentUser() user: TokenPayload
  ) {
    return this.healthService.deleteVaccine(animalId, vaccineId, user);
  }

  /* ── Doenças ── */
  @Get("diseases")
  listDiseases(@Param("id") animalId: string, @CurrentUser() user: TokenPayload) {
    return this.healthService.listDiseases(animalId, user);
  }

  @Post("diseases")
  @HttpCode(HttpStatus.CREATED)
  createDisease(
    @Param("id") animalId: string,
    @CurrentUser() user: TokenPayload,
    @Body() body: Record<string, unknown>
  ) {
    return this.healthService.createDisease(animalId, user, body);
  }

  @Patch("diseases/:diseaseId")
  updateDisease(
    @Param("id") animalId: string,
    @Param("diseaseId") diseaseId: string,
    @CurrentUser() user: TokenPayload,
    @Body() body: Record<string, unknown>
  ) {
    return this.healthService.updateDisease(animalId, diseaseId, user, body);
  }

  @Delete("diseases/:diseaseId")
  deleteDisease(
    @Param("id") animalId: string,
    @Param("diseaseId") diseaseId: string,
    @CurrentUser() user: TokenPayload
  ) {
    return this.healthService.deleteDisease(animalId, diseaseId, user);
  }

  /* ── Histórico de Localização ── */
  @Get("locations")
  listLocations(@Param("id") animalId: string, @CurrentUser() user: TokenPayload) {
    return this.healthService.listLocations(animalId, user);
  }

  @Post("locations")
  @HttpCode(HttpStatus.CREATED)
  createLocation(
    @Param("id") animalId: string,
    @CurrentUser() user: TokenPayload,
    @Body() body: Record<string, unknown>
  ) {
    return this.healthService.createLocation(animalId, user, body);
  }

  /* ── Tabela de Observações Gerais (`AnimalObservation`) ── */
  @Get("observations")
  listObservations(
    @Param("id") animalId: string,
    @CurrentUser() user: TokenPayload,
    @Query("category") category?: string
  ) {
    return this.healthService.listObservations(animalId, user, category);
  }

  @Post("observations")
  @HttpCode(HttpStatus.CREATED)
  createObservation(
    @Param("id") animalId: string,
    @CurrentUser() user: TokenPayload,
    @Body() body: Record<string, unknown>
  ) {
    return this.healthService.createObservation(animalId, user, body);
  }

  @Patch("observations/:observationId")
  updateObservation(
    @Param("id") animalId: string,
    @Param("observationId") observationId: string,
    @CurrentUser() user: TokenPayload,
    @Body() body: Record<string, unknown>
  ) {
    return this.healthService.updateObservation(animalId, observationId, user, body);
  }

  @Delete("observations/:observationId")
  deleteObservation(
    @Param("id") animalId: string,
    @Param("observationId") observationId: string,
    @CurrentUser() user: TokenPayload
  ) {
    return this.healthService.deleteObservation(animalId, observationId, user);
  }
}
