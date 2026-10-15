import { Module } from '@nestjs/common';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { SupplierBankAccountsService } from './supplier-bank-accounts.service';
import { SuppliersRestorer } from './suppliers.restorer';

@Module({
  controllers: [SuppliersController],
  providers: [SuppliersRestorer, SuppliersService, SupplierBankAccountsService],
})
export class SuppliersModule {}
