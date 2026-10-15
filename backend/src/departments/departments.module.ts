import { Module } from '@nestjs/common';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';
import { DepartmentsRestorer } from './departments.restorer';

@Module({
  controllers: [DepartmentsController],
  providers: [DepartmentsService, DepartmentsRestorer],
})
export class DepartmentsModule {}
