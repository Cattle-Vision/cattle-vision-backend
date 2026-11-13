import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AiVisionService } from "./ai-vision.service";
import { IcsController } from "./ics.controller";
import { IcsService } from "./ics.service";
import { PhotoRecalibrationService } from "./photo-recalibration.service";
import { StorageService } from "./storage.service";

@Module({
  imports: [AuthModule],
  controllers: [IcsController],
  providers: [AiVisionService, StorageService, IcsService, PhotoRecalibrationService],
  exports: [AiVisionService, StorageService, IcsService, PhotoRecalibrationService],
})
export class VisionModule {}
