import { Module } from '@nestjs/common';
import { NumberingController } from './numbering.controller';
import { NumberingService } from './numbering.service';

@Module({
  controllers: [NumberingController],
  providers: [NumberingService],
})
export class NumberingModule {}
