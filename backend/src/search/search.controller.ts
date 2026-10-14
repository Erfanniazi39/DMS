import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { SearchService } from './search.service';

// Any signed-in user may search; what comes back is limited per group by the
// permission of the page each hit opens (see search.service.ts).
@Controller('search')
@UseGuards(SessionAuthGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  find(@Query('q') q: string | undefined, @Req() req: Request) {
    return this.search.search(q ?? '', req.session.permissions ?? []);
  }
}
