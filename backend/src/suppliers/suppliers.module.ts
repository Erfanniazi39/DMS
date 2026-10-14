import { Module } from '@nestjs/common';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { SupplierBankAccountsService } from './supplier-bank-accounts.service';

@Module({
  controllers: [SuppliersController],
  providers: [SuppliersService, SupplierBankAccountsService],
})
export class SuppliersModule {}
