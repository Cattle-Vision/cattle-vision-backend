import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { TokenPayload } from "../auth/jwt.utils";
import { parseOptionalCoordinate } from "../../common/utils/animal.utils";
import { CustodyService } from "./custody.service";

const VALID_DISEASE_STATUSES = new Set(["ACTIVE", "MONITORING", "RECOVERED"]);
const VALID_OBSERVATION_CATEGORIES = new Set([
  "GERAL",
  "MANEJO",
  "NUTRICAO",
  "COMPORTAMENTO",
  "OUTRA",
]);

/**
 * Serviço de Gestão Sanitária, Localização e Observações Gerais (`src/modules/animals/animal-health.service.ts`).
 *
 * Implementa RF08 completo:
 * - Controle de Vacinas (`VaccineRecord`)
 * - Histórico de Doenças (`DiseaseRecord`)
 * - Histórico de Localização (`AnimalLocationLog`)
 * - Tabela dedicada de Observações Gerais (`AnimalObservation`)
 */
@Injectable()
export class AnimalHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly custodyService: CustodyService
  ) {}

  private async assertAnimalAccess(animalId: string, user: TokenPayload) {
    const animal = await this.prisma.animal.findUnique({
      where: { id: animalId },
      select: { id: true, ownerId: true, location: true },
    });
    if (!animal) {
      throw new NotFoundException("Animal não encontrado.");
    }

    const hasAccess = await this.custodyService.canAccessAnimal(
      animal.id,
      animal.ownerId,
      Number(user.id),
      user.role === "ADMIN"
    );
    if (!hasAccess) {
      throw new ForbiddenException("Você não possui permissão para acessar este animal.");
    }
    return animal;
  }

  private parseDateOrThrow(raw: unknown, fieldLabel: string): Date {
    const parsed = raw ? new Date(String(raw)) : new Date();
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`Data inválida para ${fieldLabel}.`);
    }
    return parsed;
  }

  /* ── Vacinas ── */
  async listVaccines(animalId: string, user: TokenPayload) {
    await this.assertAnimalAccess(animalId, user);
    return this.prisma.vaccineRecord.findMany({
      where: { animalId },
      orderBy: { appliedAt: "desc" },
    });
  }

  async createVaccine(
    animalId: string,
    user: TokenPayload,
    body: {
      name?: unknown;
      dose?: unknown;
      batch?: unknown;
      appliedAt?: unknown;
      nextDueAt?: unknown;
      notes?: unknown;
    }
  ) {
    await this.assertAnimalAccess(animalId, user);
    const name = String(body.name ?? "").trim();
    if (!name) {
      throw new BadRequestException("Informe o nome da vacina.");
    }

    const appliedAt = this.parseDateOrThrow(body.appliedAt || new Date(), "data de aplicação");
    const nextDueAt = body.nextDueAt ? this.parseDateOrThrow(body.nextDueAt, "próximo reforço") : null;

    return this.prisma.vaccineRecord.create({
      data: {
        animalId,
        name,
        dose: String(body.dose ?? "").trim(),
        batch: String(body.batch ?? "").trim(),
        appliedAt,
        nextDueAt,
        notes: String(body.notes ?? "").trim(),
        createdById: Number(user.id) || null,
      },
    });
  }

  async deleteVaccine(animalId: string, vaccineId: string, user: TokenPayload) {
    await this.assertAnimalAccess(animalId, user);
    const record = await this.prisma.vaccineRecord.findFirst({
      where: { id: vaccineId, animalId },
    });
    if (!record) {
      throw new NotFoundException("Registro de vacina não encontrado.");
    }
    await this.prisma.vaccineRecord.delete({ where: { id: vaccineId } });
    return { ok: true, message: "Registro de vacina excluído." };
  }

  /* ── Doenças ── */
  async listDiseases(animalId: string, user: TokenPayload) {
    await this.assertAnimalAccess(animalId, user);
    return this.prisma.diseaseRecord.findMany({
      where: { animalId },
      orderBy: { diagnosedAt: "desc" },
    });
  }

  async createDisease(
    animalId: string,
    user: TokenPayload,
    body: {
      name?: unknown;
      symptoms?: unknown;
      treatment?: unknown;
      status?: unknown;
      diagnosedAt?: unknown;
      recoveredAt?: unknown;
      notes?: unknown;
    }
  ) {
    await this.assertAnimalAccess(animalId, user);
    const name = String(body.name ?? "").trim();
    if (!name) {
      throw new BadRequestException("Informe o nome da enfermidade ou suspeita clínica.");
    }

    const rawStatus = String(body.status ?? "ACTIVE").trim().toUpperCase();
    const status = VALID_DISEASE_STATUSES.has(rawStatus) ? rawStatus : "ACTIVE";
    const diagnosedAt = this.parseDateOrThrow(body.diagnosedAt || new Date(), "data do diagnóstico");
    const recoveredAt = body.recoveredAt
      ? this.parseDateOrThrow(body.recoveredAt, "data de recuperação")
      : status === "RECOVERED"
      ? new Date()
      : null;

    return this.prisma.diseaseRecord.create({
      data: {
        animalId,
        name,
        symptoms: String(body.symptoms ?? "").trim(),
        treatment: String(body.treatment ?? "").trim(),
        status,
        diagnosedAt,
        recoveredAt,
        notes: String(body.notes ?? "").trim(),
        createdById: Number(user.id) || null,
      },
    });
  }

  async updateDisease(
    animalId: string,
    diseaseId: string,
    user: TokenPayload,
    body: {
      name?: unknown;
      symptoms?: unknown;
      treatment?: unknown;
      status?: unknown;
      diagnosedAt?: unknown;
      recoveredAt?: unknown;
      notes?: unknown;
    }
  ) {
    await this.assertAnimalAccess(animalId, user);
    const existing = await this.prisma.diseaseRecord.findFirst({
      where: { id: diseaseId, animalId },
    });
    if (!existing) {
      throw new NotFoundException("Registro de doença não encontrado.");
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const nextName = String(body.name).trim();
      if (!nextName) throw new BadRequestException("Nome da enfermidade não pode ficar vazio.");
      data.name = nextName;
    }
    if (body.symptoms !== undefined) data.symptoms = String(body.symptoms).trim();
    if (body.treatment !== undefined) data.treatment = String(body.treatment).trim();
    if (body.notes !== undefined) data.notes = String(body.notes).trim();
    if (body.diagnosedAt !== undefined) {
      data.diagnosedAt = this.parseDateOrThrow(body.diagnosedAt, "data do diagnóstico");
    }
    if (body.status !== undefined) {
      const nextStatus = String(body.status).trim().toUpperCase();
      if (!VALID_DISEASE_STATUSES.has(nextStatus)) {
        throw new BadRequestException("Status clínico inválido.");
      }
      data.status = nextStatus;
      if (nextStatus === "RECOVERED" && body.recoveredAt === undefined && !existing.recoveredAt) {
        data.recoveredAt = new Date();
      } else if (nextStatus !== "RECOVERED" && body.recoveredAt === undefined) {
        data.recoveredAt = null;
      }
    }
    if (body.recoveredAt !== undefined) {
      data.recoveredAt = body.recoveredAt
        ? this.parseDateOrThrow(body.recoveredAt, "data de recuperação")
        : null;
    }

    return this.prisma.diseaseRecord.update({
      where: { id: diseaseId },
      data,
    });
  }

  async deleteDisease(animalId: string, diseaseId: string, user: TokenPayload) {
    await this.assertAnimalAccess(animalId, user);
    const existing = await this.prisma.diseaseRecord.findFirst({
      where: { id: diseaseId, animalId },
    });
    if (!existing) {
      throw new NotFoundException("Registro de doença não encontrado.");
    }
    await this.prisma.diseaseRecord.delete({ where: { id: diseaseId } });
    return { ok: true, message: "Registro de doença excluído." };
  }

  /* ── Localizações (Fazenda / GPS / Endereço) ── */
  async listLocations(animalId: string, user: TokenPayload) {
    await this.assertAnimalAccess(animalId, user);
    return this.prisma.animalLocationLog.findMany({
      where: { animalId },
      orderBy: { movedAt: "desc" },
    });
  }

  async createLocation(
    animalId: string,
    user: TokenPayload,
    body: {
      location?: unknown;
      address?: unknown;
      latitude?: unknown;
      longitude?: unknown;
      reason?: unknown;
    }
  ) {
    await this.assertAnimalAccess(animalId, user);
    const location = String(body.location ?? "").trim();
    const address = String(body.address ?? "").trim();
    const latitude = parseOptionalCoordinate(body.latitude, -90, 90, "Latitude GPS");
    const longitude = parseOptionalCoordinate(body.longitude, -180, 180, "Longitude GPS");
    const reason = String(body.reason ?? "").trim() || "Movimentação entre fazendas/propriedades";

    if (!location && !address && (latitude === null || longitude === null)) {
      throw new BadRequestException(
        "Informe o nome da fazenda, o endereço ou as coordenadas GPS."
      );
    }

    const effectiveLocation = location || address || "Localização registrada via GPS";

    const [log] = await this.prisma.$transaction([
      this.prisma.animalLocationLog.create({
        data: {
          animalId,
          location: effectiveLocation,
          address,
          latitude,
          longitude,
          reason,
          movedById: Number(user.id) || null,
        },
      }),
      this.prisma.animal.update({
        where: { id: animalId },
        data: {
          location: effectiveLocation,
          locationAddress: address,
          latitude,
          longitude,
        },
      }),
    ]);

    return log;
  }

  /* ── Observações Gerais (`AnimalObservation`) ── */
  async listObservations(animalId: string, user: TokenPayload, category?: string) {
    await this.assertAnimalAccess(animalId, user);
    const normalizedCat = category?.trim().toUpperCase();
    return this.prisma.animalObservation.findMany({
      where: {
        animalId,
        ...(normalizedCat && VALID_OBSERVATION_CATEGORIES.has(normalizedCat)
          ? { category: normalizedCat }
          : {}),
      },
      orderBy: { observedAt: "desc" },
    });
  }

  async createObservation(
    animalId: string,
    user: TokenPayload,
    body: {
      category?: unknown;
      title?: unknown;
      content?: unknown;
      observedAt?: unknown;
    }
  ) {
    await this.assertAnimalAccess(animalId, user);
    const content = String(body.content ?? "").trim();
    if (!content) {
      throw new BadRequestException("Escreva o conteúdo da observação geral.");
    }

    const rawCat = String(body.category ?? "GERAL").trim().toUpperCase();
    const category = VALID_OBSERVATION_CATEGORIES.has(rawCat) ? rawCat : "GERAL";
    const observedAt = body.observedAt
      ? this.parseDateOrThrow(body.observedAt, "data da observação")
      : new Date();

    const created = await this.prisma.animalObservation.create({
      data: {
        animalId,
        category,
        title: String(body.title ?? "").trim(),
        content,
        observedAt,
        createdById: Number(user.id) || null,
        createdByName: user.name || user.email || "Operador",
      },
    });

    // Mantém `Animal.observations` atualizado com o resumo da última observação registrada
    await this.prisma.animal
      .update({
        where: { id: animalId },
        data: { observations: content },
      })
      .catch(() => {});

    return created;
  }

  async updateObservation(
    animalId: string,
    observationId: string,
    user: TokenPayload,
    body: {
      category?: unknown;
      title?: unknown;
      content?: unknown;
      observedAt?: unknown;
    }
  ) {
    await this.assertAnimalAccess(animalId, user);
    const existing = await this.prisma.animalObservation.findFirst({
      where: { id: observationId, animalId },
    });
    if (!existing) {
      throw new NotFoundException("Observação não encontrada.");
    }

    const data: Record<string, unknown> = {};
    if (body.category !== undefined) {
      const rawCat = String(body.category).trim().toUpperCase();
      data.category = VALID_OBSERVATION_CATEGORIES.has(rawCat) ? rawCat : "GERAL";
    }
    if (body.title !== undefined) data.title = String(body.title).trim();
    if (body.content !== undefined) {
      const nextContent = String(body.content).trim();
      if (!nextContent) throw new BadRequestException("Conteúdo da observação não pode ficar vazio.");
      data.content = nextContent;
    }
    if (body.observedAt !== undefined) {
      data.observedAt = this.parseDateOrThrow(body.observedAt, "data da observação");
    }

    return this.prisma.animalObservation.update({
      where: { id: observationId },
      data,
    });
  }

  async deleteObservation(animalId: string, observationId: string, user: TokenPayload) {
    await this.assertAnimalAccess(animalId, user);
    const existing = await this.prisma.animalObservation.findFirst({
      where: { id: observationId, animalId },
    });
    if (!existing) {
      throw new NotFoundException("Observação não encontrada.");
    }
    await this.prisma.animalObservation.delete({ where: { id: observationId } });
    return { ok: true, message: "Observação removida." };
  }
}
