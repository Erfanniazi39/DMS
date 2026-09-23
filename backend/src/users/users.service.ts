import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

// USER is an independent account — it is never linked to, or used to
// create, an EMPLOYEE record. See database_plan.txt at the project root.
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto) {
    const existingUsername = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (existingUsername) {
      throw new ConflictException('این نام کاربری قبلاً استفاده شده است');
    }

    const role = await this.prisma.role.findUnique({ where: { name: dto.roleName } });
    if (!role) {
      throw new ConflictException('نقش انتخاب‌شده معتبر نیست');
    }

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        passwordHash,
        email: dto.email,
        phone: dto.phone,
        roleId: role.id,
        status: dto.status,
      },
      include: { role: true },
    });

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      role: user.role.name,
      status: user.status,
    };
  }

  async list() {
    const users = await this.prisma.user.findMany({
      include: { role: true },
      orderBy: { id: 'asc' },
    });
    return users.map((user) => ({
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      role: user.role.name,
      status: user.status,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    }));
  }

  // Partial update — only the fields present in dto are changed.
  // Used by the "edit user" action: username, password, role, and
  // status (lock/disable) can each be changed independently.
  async update(id: number, dto: UpdateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('کاربر پیدا نشد');
    }

    if (dto.username && dto.username !== existing.username) {
      const usernameTaken = await this.prisma.user.findUnique({
        where: { username: dto.username },
      });
      if (usernameTaken) {
        throw new ConflictException('این نام کاربری قبلاً استفاده شده است');
      }
    }

    let roleId: number | undefined;
    if (dto.roleName) {
      const role = await this.prisma.role.findUnique({ where: { name: dto.roleName } });
      if (!role) {
        throw new ConflictException('نقش انتخاب‌شده معتبر نیست');
      }
      roleId = role.id;
    }

    const passwordHash = dto.password
      ? await argon2.hash(dto.password, { type: argon2.argon2id })
      : undefined;

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        username: dto.username,
        passwordHash,
        email: dto.email,
        phone: dto.phone,
        roleId,
        status: dto.status,
      },
      include: { role: true },
    });

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      role: user.role.name,
      status: user.status,
    };
  }
}
