import { Module } from "@nestjs/common";
import { AnimalsModule } from "../animals/animals.module";
import { AuthModule } from "../auth/auth.module";
import { VisionModule } from "../vision/vision.module";
import { PhotosController } from "./photos.controller";
import { PhotosService } from "./photos.service";

@Module({
  imports: [AuthModule, VisionModule, AnimalsModule],
  controllers: [PhotosController],
  providers: [PhotosService],
})
export class PhotosModule {}
