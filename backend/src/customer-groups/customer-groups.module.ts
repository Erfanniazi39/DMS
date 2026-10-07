import { Module } from '@nestjs/common';
import { CustomerGroupsController } from './customer-groups.controller';
import { CustomerGroupsService } from './customer-groups.service';

@Module({
  controllers: [CustomerGroupsController],
  providers: [CustomerGroupsService],
})
export class CustomerGroupsModule {}
