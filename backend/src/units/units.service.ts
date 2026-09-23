import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Read-only for now — Unit rows are seeded (see prisma/seed.ts) rather than
// managed through the UI. A create/update/delete admin page can be added
// later the same way Departments' was, without changing this list endpoint.
@Injectable()
export class UnitsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.unit.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }
}
