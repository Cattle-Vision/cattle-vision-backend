import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { memoryStorage } from "multer";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard, OptionalJwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TokenPayload } from "../auth/jwt.utils";
import { PhotosService } from "./photos.service";

const photoUploadInterceptor = FileInterceptor("file", {
  storage: memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

/**
 * Controller de Fotos, Upload Multipart e Score IA (`src/modules/photos/photos.controller.ts`).
 *
 * Mantém também os aliases `/api/upload` e `/api/ai/score` antes configurados no `next.config.ts`.
 */
@Controller()
export class PhotosController {
  constructor(private readonly photosService: PhotosService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Get("photos/:id")
  async getPhoto(
    @Param("id") photoId: string,
    @Query("w") rawWidth: string | undefined,
    @Headers("accept") acceptHeader: string | undefined,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @CurrentUser() user: TokenPayload | undefined,
    @Res() res: Response
  ) {
    const result = await this.photosService.getPhotoBinary({
      photoId,
      user,
      rawWidth,
      acceptHeader,
      ifNoneMatch,
    });

    const cacheControl = "public, max-age=31536000, immutable";
    if (result.notModified) {
      res.setHeader("ETag", result.etag);
      res.setHeader("Cache-Control", cacheControl);
      res.setHeader("Vary", "Accept");
      res.status(HttpStatus.NOT_MODIFIED).send();
      return;
    }

    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Content-Length", String(result.buffer.byteLength));
    res.setHeader("Cache-Control", cacheControl);
    res.setHeader("ETag", result.etag);
    res.setHeader("Vary", "Accept");
    res.status(HttpStatus.OK).send(result.buffer);
  }

  @Post("photos/score")
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(photoUploadInterceptor)
  scorePhoto(
    @UploadedFile() file?: Express.Multer.File,
    @Query("mode") mode?: string
  ) {
    if (!file?.buffer) {
      throw new BadRequestException("Imagem ausente");
    }
    return this.photosService.scoreBuffer(file.buffer, mode === "live");
  }

  @Post("ai/score")
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(photoUploadInterceptor)
  scorePhotoAlias(
    @UploadedFile() file?: Express.Multer.File,
    @Query("mode") mode?: string
  ) {
    if (!file?.buffer) {
      throw new BadRequestException("Imagem ausente");
    }
    return this.photosService.scoreBuffer(file.buffer, mode === "live");
  }

  @UseGuards(JwtAuthGuard)
  @Post("photos/upload")
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(photoUploadInterceptor)
  uploadPhoto(
    @CurrentUser() user: TokenPayload,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { animalId?: string; view?: string; preScore?: string; aiSource?: string }
  ) {
    return this.photosService.uploadPhoto({
      user,
      file,
      animalId: body?.animalId,
      view: body?.view,
      preScore: body?.preScore,
      aiSource: body?.aiSource,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post("upload")
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(photoUploadInterceptor)
  uploadPhotoAlias(
    @CurrentUser() user: TokenPayload,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { animalId?: string; view?: string; preScore?: string; aiSource?: string }
  ) {
    return this.photosService.uploadPhoto({
      user,
      file,
      animalId: body?.animalId,
      view: body?.view,
      preScore: body?.preScore,
      aiSource: body?.aiSource,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post("photos/:id/recalibrate")
  @HttpCode(HttpStatus.OK)
  recalibratePhoto(@Param("id") photoId: string, @CurrentUser() user: TokenPayload) {
    return this.photosService.recalibratePhoto(photoId, user);
  }

  @UseGuards(JwtAuthGuard)
  @Delete("photos/:id")
  deletePhoto(@Param("id") photoId: string, @CurrentUser() user: TokenPayload) {
    return this.photosService.deletePhoto(photoId, user);
  }
}
