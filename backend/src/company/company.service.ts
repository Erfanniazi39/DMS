import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, unlink } from 'fs';
import { writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { AUDIT_ENTITY, AuditService, diffChanges } from '../audit/audit.service';
import { matchesFileSignature } from '../common/file-signature';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateCompanyProfileDto } from './dto/company.dto';

export const LOGO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);
const LOGO_DIR = join(process.cwd(), 'uploads', 'company');
const STORED_LOGO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg)$/;
const FIELDS = [
  'legalName', 'brandName', 'companyType', 'nationalId', 'economicCode', 'registrationNumber', 'province', 'city',
  'postalCode', 'address', 'phone1', 'phone2', 'fax', 'email', 'website', 'documentFooter',
] as const;

// The company's own details (one row, id = 1). Read by every logged-in user
// (printed documents need it); written only with company.manage. Documents
// read it live — nothing is copied onto invoices.
@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get() {
    // The migration inserts the row; upsert keeps a restored/blank install working.
    const row = await this.prisma.companyProfile.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    const { logoPath, ...rest } = row;
    return { ...rest, hasLogo: Boolean(logoPath), logoUrl: logoPath ? `/company/logo?v=${row.updatedAt.getTime()}` : null };
  }

  async update(dto: UpdateCompanyProfileDto, userId: number | null, ipAddress?: string) {
    const before = await this.prisma.companyProfile.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    const after = await this.prisma.companyProfile.update({ where: { id: 1 }, data: dto });
    const changes = diffChanges(before, after, FIELDS);
    if (changes.length > 0) {
      await this.audit.log({
        userId,
        ipAddress,
        action: 'COMPANY_PROFILE_UPDATED',
        entityType: AUDIT_ENTITY.COMPANY_PROFILE,
        entityId: 1,
        details: changes.map((c) => c.field).join('، '),
        changes,
      });
    }
    return this.get();
  }

  async setLogo(file: { originalName: string; buffer: Buffer }, userId: number | null, ipAddress?: string) {
    const extension = extname(file.originalName).toLowerCase();
    if (!LOGO_EXTENSIONS.has(extension)) throw new BadRequestException('فقط تصویر با فرمت png، jpg یا jpeg مجاز است');
    if (!matchesFileSignature(file.buffer, extension)) throw new BadRequestException('محتوای فایل با نوع آن مطابقت ندارد');
    const current = await this.prisma.companyProfile.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    const filename = `${randomUUID()}${extension}`;
    await writeFile(join(LOGO_DIR, filename), file.buffer);
    try {
      await this.prisma.companyProfile.update({ where: { id: 1 }, data: { logoPath: `/uploads/company/${filename}` } });
    } catch (error) {
      this.deleteFile(`/uploads/company/${filename}`);
      throw error;
    }
    if (current.logoPath) this.deleteFile(current.logoPath);
    await this.audit.log({ userId, ipAddress, action: 'COMPANY_LOGO_UPDATED', entityType: AUDIT_ENTITY.COMPANY_PROFILE, entityId: 1, details: file.originalName.slice(0, 200) });
    return this.get();
  }

  async removeLogo(userId: number | null, ipAddress?: string) {
    const current = await this.prisma.companyProfile.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    if (!current.logoPath) return this.get();
    await this.prisma.companyProfile.update({ where: { id: 1 }, data: { logoPath: null } });
    this.deleteFile(current.logoPath);
    await this.audit.log({ userId, ipAddress, action: 'COMPANY_LOGO_REMOVED', entityType: AUDIT_ENTITY.COMPANY_PROFILE, entityId: 1 });
    return this.get();
  }

  // Absolute path of the current logo for the guarded download route.
  async resolveLogo(): Promise<string> {
    const row = await this.prisma.companyProfile.findUnique({ where: { id: 1 }, select: { logoPath: true } });
    const filename = row?.logoPath?.split('/').pop();
    if (!filename || !STORED_LOGO.test(filename)) throw new NotFoundException('لوگو پیدا نشد');
    const absolute = join(LOGO_DIR, filename);
    if (!existsSync(absolute)) throw new NotFoundException('لوگو پیدا نشد');
    return absolute;
  }

  private deleteFile(relativePath: string) {
    const absolute = join(process.cwd(), relativePath.replace(/^\//, ''));
    if (existsSync(absolute)) unlink(absolute, () => undefined);
  }
}
