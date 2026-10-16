import { CompanyService } from './company.service';
import { updateCompanyProfileSchema } from './dto/company.dto';

const base = { legalName: 'شرکت آزمون' };

describe('updateCompanyProfileSchema', () => {
  it('accepts a minimal profile and turns blanks into null', () => {
    const parsed = updateCompanyProfileSchema.parse({ ...base, city: '  ', phone1: '' });
    expect(parsed.city).toBeNull();
    expect(parsed.phone1).toBeNull();
    expect(parsed.nationalId).toBeNull();
  });

  it('requires the legal name', () => {
    expect(updateCompanyProfileSchema.safeParse({ legalName: ' ' }).success).toBe(false);
  });

  it('normalises Persian digits and checks lengths', () => {
    const parsed = updateCompanyProfileSchema.parse({ ...base, nationalId: '۱۰۱۰۱۰۱۰۱۰۱', economicCode: '411-1234-56789', postalCode: '۱۲۳۴۵۶۷۸۹۰' });
    expect(parsed.nationalId).toBe('10101010101');
    expect(parsed.economicCode).toBe('411123456789');
    expect(parsed.postalCode).toBe('1234567890');
    expect(updateCompanyProfileSchema.safeParse({ ...base, nationalId: '123' }).success).toBe(false);
    expect(updateCompanyProfileSchema.safeParse({ ...base, postalCode: '12345' }).success).toBe(false);
    expect(updateCompanyProfileSchema.safeParse({ ...base, economicCode: '12345' }).success).toBe(false);
  });

  it('validates phone and email', () => {
    expect(updateCompanyProfileSchema.safeParse({ ...base, phone1: '۰۲۱-۱۲۳۴۵۶۷۸' }).success).toBe(true);
    expect(updateCompanyProfileSchema.safeParse({ ...base, phone1: 'abc' }).success).toBe(false);
    expect(updateCompanyProfileSchema.safeParse({ ...base, email: 'nope' }).success).toBe(false);
    expect(updateCompanyProfileSchema.safeParse({ ...base, email: 'a@b.ir' }).success).toBe(true);
  });
});

describe('CompanyService', () => {
  const row = { id: 1, legalName: 'قدیم', city: 'تهران', logoPath: null, updatedAt: new Date('2026-10-16T00:00:00Z') };
  function setup(after: Record<string, unknown>) {
    const prisma = {
      companyProfile: {
        upsert: jest.fn().mockResolvedValueOnce(row).mockResolvedValue({ ...row, ...after }),
        update: jest.fn().mockResolvedValue({ ...row, ...after }),
      },
    };
    const audit = { log: jest.fn() };
    return { prisma, audit, service: new CompanyService(prisma as never, audit as never) };
  }

  it('audits changed fields on update', async () => {
    const { service, audit } = setup({ legalName: 'جدید' });
    const result = await service.update({ legalName: 'جدید' } as never, 7, '1.2.3.4');
    expect(result.legalName).toBe('جدید');
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log.mock.calls[0][0]).toMatchObject({ action: 'COMPANY_PROFILE_UPDATED', userId: 7, changes: [{ field: 'legalName', from: 'قدیم', to: 'جدید' }] });
  });

  it('does not audit an unchanged save', async () => {
    const { service, audit } = setup({});
    await service.update({ legalName: 'قدیم' } as never, 7);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('never exposes the stored logo path, only a flag and url', async () => {
    const { service } = setup({ logoPath: '/uploads/company/x.png' });
    const result = await service.update({ legalName: 'قدیم' } as never, 1);
    expect(result).not.toHaveProperty('logoPath');
    expect(result.hasLogo).toBe(true);
  });

  it('rejects a logo whose content does not match its extension', async () => {
    const { service } = setup({});
    await expect(service.setLogo({ originalName: 'a.png', buffer: Buffer.from('not a png') }, 1)).rejects.toThrow();
    await expect(service.setLogo({ originalName: 'a.gif', buffer: Buffer.from('GIF89a') }, 1)).rejects.toThrow();
  });
});
