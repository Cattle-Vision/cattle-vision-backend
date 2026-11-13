import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { VisionModule } from "../vision/vision.module";
import { AnimalHealthController } from "./animal-health.controller";
import { AnimalHealthService } from "./animal-health.service";
import { AnimalsController } from "./animals.controller";
import { AnimalsService } from "./animals.service";
import { CustodyService } from "./custody.service";

@Module({
  imports: [AuthModule, VisionModule],
  controllers: [AnimalsController, AnimalHealthController],
  providers: [CustodyService, AnimalsService, AnimalHealthService],
  exports: [CustodyService, AnimalsService, AnimalHealthService],
})
export class AnimalsModule {}
