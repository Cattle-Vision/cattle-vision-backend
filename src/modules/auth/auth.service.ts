import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import bcrypt from "bcryptjs";
import { PrismaService } from "../../prisma/prisma.service";
import { signJwtToken, TokenPayload } from "./jwt.utils";

/**
 * Serviço de Autenticação e Perfil de Operadores (`src/modules/auth/auth.service.ts`).
 */
@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  private getEnvAdminConfig() {
    const email = (
      process.env.ADMIN_EMAIL ||
      process.env.ADMIN_USER ||
      "admin@cattlecapture.com"
    )
      .trim()
      .toLowerCase();
    const password = process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || "admin123";
    const name = (process.env.ADMIN_NAME || "Administrador CattleVision").trim();
    return { email, password, name };
  }

  async login(body: { email?: string; password?: string }) {
    const rawEmail = String(body.email ?? "")
      .trim()
      .toLowerCase();
    const rawPassword = String(body.password ?? "");

    if (!rawEmail || !rawPassword) {
      throw new BadRequestException("E-mail e senha são obrigatórios.");
    }

    const envAdmin = this.getEnvAdminConfig();
    const isEnvAdminIdentifier =
      rawEmail === envAdmin.email ||
      rawEmail === "admin" ||
      rawEmail === "admin@cattlecapture.com";

    const isEnvAdminPassword =
      rawPassword === envAdmin.password ||
      (!process.env.ADMIN_PASSWORD && (rawPassword === "admin123" || rawPassword === "admin"));

    if (isEnvAdminIdentifier && isEnvAdminPassword) {
      let adminId = "1";
      try {
        const hashedPassword = await bcrypt.hash(rawPassword, 10);
        const adminUser = await this.prisma.user.upsert({
          where: { email: envAdmin.email },
          update: {
            role: "ADMIN",
            name: envAdmin.name,
          },
          create: {
            email: envAdmin.email,
            name: envAdmin.name,
            password: hashedPassword,
            role: "ADMIN",
          },
        });
        adminId = String(adminUser.id);
      } catch (dbErr) {
        console.warn("[auth/login] Aviso ao sincronizar Admin no banco:", dbErr);
      }

      const userPayload: TokenPayload = {
        id: adminId,
        email: envAdmin.email,
        name: envAdmin.name,
        role: "ADMIN",
      };
      const token = signJwtToken(userPayload);
      return { token, user: userPayload };
    }

    const emailToLookup = rawEmail === "admin" ? envAdmin.email : rawEmail;
    const user = await this.prisma.user.findUnique({ where: { email: emailToLookup } });
    if (!user) {
      throw new UnauthorizedException("E-mail ou senha incorretos.");
    }

    const passwordMatches = await bcrypt.compare(rawPassword, user.password);
    if (!passwordMatches) {
      throw new UnauthorizedException("E-mail ou senha incorretos.");
    }

    const resolvedRole = user.email.toLowerCase() === envAdmin.email ? "ADMIN" : user.role;
    const userPayload: TokenPayload = {
      id: String(user.id),
      email: user.email,
      name: user.name,
      role: resolvedRole,
    };

    const token = signJwtToken(userPayload);
    return { token, user: userPayload };
  }

  async register(body: { name?: string; email?: string; password?: string }) {
    const trimmedName = String(body.name ?? "").trim();
    const normalizedEmail = String(body.email ?? "")
      .trim()
      .toLowerCase();
    const pwd = String(body.password ?? "");

    if (!trimmedName || !normalizedEmail || !pwd) {
      throw new BadRequestException("Preencha todos os campos.");
    }
    if (pwd.length < 6) {
      throw new BadRequestException("A senha precisa ter pelo menos 6 caracteres.");
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingUser) {
      throw new BadRequestException("Este e-mail já está cadastrado.");
    }

    const role = normalizedEmail === this.getEnvAdminConfig().email ? "ADMIN" : "USER";
    const hashedPassword = await bcrypt.hash(pwd, 10);

    const user = await this.prisma.user.create({
      data: {
        name: trimmedName,
        email: normalizedEmail,
        password: hashedPassword,
        role,
      },
    });

    const userPayload: TokenPayload = {
      id: String(user.id),
      email: user.email,
      name: user.name,
      role: user.role,
    };
    const token = signJwtToken(userPayload);

    return {
      token,
      user: userPayload,
      message: "Conta criada com sucesso!",
    };
  }

  async getMe(user: TokenPayload) {
    const dbUser = await this.prisma.user
      .findUnique({
        where: { id: Number(user.id) },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      })
      .catch(() => null);

    return {
      user: dbUser
        ? {
            id: String(dbUser.id),
            name: dbUser.name,
            email: dbUser.email,
            role: dbUser.role,
            createdAt: dbUser.createdAt,
          }
        : user,
    };
  }

  async updateMe(
    user: TokenPayload,
    body: { name?: unknown; currentPassword?: unknown; newPassword?: unknown }
  ) {
    const nextName = typeof body.name === "string" ? body.name.trim() : undefined;
    const currentPassword =
      typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

    if (nextName !== undefined && nextName.length < 2) {
      throw new BadRequestException("Nome deve ter pelo menos 2 caracteres.");
    }
    if (newPassword && newPassword.length < 6) {
      throw new BadRequestException("Nova senha deve ter pelo menos 6 caracteres.");
    }

    const userId = Number(user.id);
    if (!Number.isFinite(userId)) {
      throw new BadRequestException("Usuário inválido.");
    }

    const dbUser = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!dbUser) {
      throw new NotFoundException("Usuário não encontrado.");
    }

    const dataToUpdate: { name?: string; password?: string } = {};
    if (nextName !== undefined && nextName !== dbUser.name) {
      dataToUpdate.name = nextName;
    }

    if (newPassword) {
      if (!currentPassword) {
        throw new BadRequestException("Informe a senha atual para definir uma nova senha.");
      }
      const validCurrent = await bcrypt.compare(currentPassword, dbUser.password);
      if (!validCurrent) {
        throw new BadRequestException("Senha atual incorreta.");
      }
      dataToUpdate.password = await bcrypt.hash(newPassword, 10);
    }

    const updatedUser =
      Object.keys(dataToUpdate).length > 0
        ? await this.prisma.user.update({
            where: { id: userId },
            data: dataToUpdate,
            select: { id: true, name: true, email: true, role: true, createdAt: true },
          })
        : {
            id: dbUser.id,
            name: dbUser.name,
            email: dbUser.email,
            role: dbUser.role,
            createdAt: dbUser.createdAt,
          };

    const userPayload = {
      id: String(updatedUser.id),
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
      createdAt: updatedUser.createdAt,
    };

    const token = signJwtToken({
      id: userPayload.id,
      name: userPayload.name,
      email: userPayload.email,
      role: userPayload.role,
    });

    return {
      message: "Perfil atualizado com sucesso.",
      user: userPayload,
      token,
    };
  }
}
