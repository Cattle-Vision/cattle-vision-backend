import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { VisionModule } from "../vision/vision.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [AuthModule, VisionModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
