import { Module } from "@nestjs/common";
import { AdminModule } from "./modules/admin/admin.module";
import { AnimalsModule } from "./modules/animals/animals.module";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./modules/health/health.module";
import { PhotosModule } from "./modules/photos/photos.module";
import { VisionModule } from "./modules/vision/vision.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    HealthModule,
    VisionModule,
    PhotosModule,
    AnimalsModule,
    AdminModule,
  ],
})
export class AppModule {}
