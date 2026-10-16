import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export type MaintenanceProgress = { phase: string; percent: number; message: string };

// While a restore replaces the data, nobody else may use the system. The middleware answers every request
// with 503 and the restore's progress — without touching the database (its tables are locked), so the
// admin's screen can keep showing how far the restore is.
@Injectable()
export class BackupMaintenanceState {
  private current: MaintenanceProgress | null = null;

  get active(): boolean {
    return this.current !== null;
  }
  get progress(): MaintenanceProgress | null {
    return this.current;
  }
  begin(progress: MaintenanceProgress) {
    this.current = progress;
  }
  update(progress: MaintenanceProgress) {
    if (this.current) this.current = progress;
  }
  end() {
    this.current = null;
  }
}

@Injectable()
export class BackupMaintenanceMiddleware implements NestMiddleware {
  constructor(private readonly state: BackupMaintenanceState) {}

  use(_request: Request, response: Response, next: NextFunction) {
    if (!this.state.active) return next();
    response.status(503).json({
      statusCode: 503,
      code: 'MAINTENANCE_RESTORE',
      message: 'سیستم در حال بازیابی از پشتیبان است؛ لطفاً تا پایان کار صبر کنید.',
      progress: this.state.progress,
    });
  }
}
