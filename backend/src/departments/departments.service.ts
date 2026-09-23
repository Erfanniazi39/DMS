import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.department.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, status: true, note: true },
    });
  }

  async get(id: number) {
    const department = await this.prisma.department.findUnique({
      where: { id },
      select: { id: true, code: true, name: true, status: true, note: true },
    });
    if (!department) throw new NotFoundException('واحد سازمانی پیدا نشد');
    return department;
  }

  async create(dto: CreateDepartmentDto) {
    await this.ensureUnique(dto.code, dto.name);
    return this.prisma.department.create({
      data: { code: dto.code, name: dto.name, note: dto.note || undefined },
      select: { id: true, code: true, name: true, status: true, note: true },
    });
  }

  async update(id: number, dto: UpdateDepartmentDto) {
    await this.get(id);
    await this.ensureUnique(dto.code, dto.name, id);
    return this.prisma.department.update({
      where: { id },
      data: { code: dto.code, name: dto.name, status: dto.status, note: dto.note || null },
      select: { id: true, code: true, name: true, status: true, note: true },
    });
  }

  async remove(id: number) {
    await this.get(id);
    const employeeCount = await this.prisma.employee.count({ where: { departmentId: id } });
    if (employeeCount > 0) {
      throw new ConflictException('این دپارتمان دارای کارمند است و قابل حذف نیست.');
    }
    await this.prisma.department.delete({ where: { id } });
    return { success: true };
  }

  private async ensureUnique(code: string, name: string, excludedId?: number) {
    const duplicate = await this.prisma.department.findFirst({
      where: {
        OR: [{ code }, { name }],
        ...(excludedId ? { NOT: { id: excludedId } } : {}),
      },
      select: { code: true, name: true },
    });
    if (duplicate?.code === code) throw new ConflictException('کد واحد قبلاً استفاده شده است');
    if (duplicate?.name === name) throw new ConflictException('نام واحد قبلاً استفاده شده است');
  }
}
