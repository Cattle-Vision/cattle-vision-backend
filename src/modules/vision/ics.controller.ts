import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import { memoryStorage } from "multer";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { IcsService } from "./ics.service";

@Controller("ics")
export class IcsController {
  constructor(private readonly icsService: IcsService) {}

  @Get()
  getStatus() {
    return this.icsService.getServiceInfo();
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    })
  )
  async evaluate(@UploadedFile() file?: Express.Multer.File, @Req() req?: Request) {
    if (file?.buffer && file.buffer.byteLength >= 256) {
      return this.icsService.evaluateIcsFromBuffer(file.buffer);
    }

    // Se a requisição vier como JSON ({ photoId, animalId }), retorna explicitamente
    // que o modelo neural ainda não está em execução sem tentar inferência simulada.
    if (req?.is("application/json")) {
      return this.icsService.buildDevelopmentPlaceholder();
    }

    if (Buffer.isBuffer(req?.body) && req.body.byteLength >= 256) {
      return this.icsService.evaluateIcsFromBuffer(req.body);
    }

    throw new BadRequestException("Envie um frame de imagem válido ou JSON com photoId/animalId.");
  }
}
