import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import { memoryStorage } from "multer";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TokenPayload } from "../auth/jwt.utils";
import { IcsQueueService } from "./ics-queue.service";
import { IcsService } from "./ics.service";

@Controller("ics")
export class IcsController {
  constructor(
    private readonly icsService: IcsService,
    private readonly icsQueue: IcsQueueService
  ) {}

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

    if (Buffer.isBuffer(req?.body) && req.body.byteLength >= 256) {
      return this.icsService.evaluateIcsFromBuffer(req.body);
    }

    throw new BadRequestException("Envie um arquivo de imagem válido para avaliar o ICS.");
  }

  @UseGuards(JwtAuthGuard)
  @Post("queue/photo/:photoId")
  @HttpCode(HttpStatus.OK)
  enqueuePhoto(
    @Param("photoId") photoId: string,
    @CurrentUser() user: TokenPayload,
    @Body() body?: { force?: boolean }
  ) {
    return this.icsQueue.enqueuePhoto(photoId, user, { force: Boolean(body?.force) });
  }

  @UseGuards(JwtAuthGuard)
  @Post("queue/animal/:animalId")
  @HttpCode(HttpStatus.OK)
  enqueueAnimal(
    @Param("animalId") animalId: string,
    @CurrentUser() user: TokenPayload,
    @Body() body?: { force?: boolean }
  ) {
    return this.icsQueue.enqueueAnimal(animalId, user, { force: Boolean(body?.force) });
  }

  @UseGuards(JwtAuthGuard)
  @Get("queue/status")
  getQueueStatus(@Query("animalId") animalId?: string) {
    return this.icsQueue.getQueueStatus(animalId);
  }

  @UseGuards(JwtAuthGuard)
  @Post("queue/process")
  @HttpCode(HttpStatus.OK)
  processNext() {
    return this.icsQueue.processNextJob();
  }
}
