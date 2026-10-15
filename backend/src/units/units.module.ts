import { Module } from '@nestjs/common';
import { UnitsController } from './units.controller';
import { UnitsService } from './units.service';
import { UnitsRestorer } from './units.restorer';

@Module({
  controllers: [UnitsController],
  providers: [UnitsService, UnitsRestorer],
})
export class UnitsModule {}
