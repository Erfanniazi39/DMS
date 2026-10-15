import { Injectable } from '@nestjs/common';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { DocumentRestorer } from '../audit/restore/document-restorer';
import { RestoreRegistry } from '../audit/restore/restore.registry';

@Injectable()
export class CreditNotesRestorer extends DocumentRestorer {
  readonly entityType = AUDIT_ENTITY.CREDIT_NOTE;
  protected readonly model = 'CreditNote';
  protected readonly itemModel = 'CreditNoteItem';
  protected readonly delegate = 'creditNote';
  protected readonly itemDelegate = 'creditNoteItem';
  protected readonly auditEntity = AUDIT_ENTITY.CREDIT_NOTE;
  protected readonly auditAction = 'CREDIT_NOTE_RESTORED';

  constructor(registry: RestoreRegistry, audit: AuditService) {
    super(registry, audit);
  }

  protected describe(record: Record<string, unknown>) {
    return `پیش‌نویس اعلامیه بستانکار ${String(record.creditNoteNumber ?? '')}`.trim();
  }
}
