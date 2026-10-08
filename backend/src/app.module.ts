import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DepartmentsModule } from './departments/departments.module';
import { AccessModule } from './access/access.module';
import { EmployeesModule } from './employees/employees.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { CustomersModule } from './customers/customers.module';
import { CustomerGroupsModule } from './customer-groups/customer-groups.module';
import { TerritoriesModule } from './territories/territories.module';
import { PaymentTermsModule } from './payment-terms/payment-terms.module';
import { UnitsModule } from './units/units.module';
import { ItemCategoriesModule } from './item-categories/item-categories.module';
import { ItemsModule } from './items/items.module';
import { PurchaseTypesModule } from './purchase-types/purchase-types.module';
import { PurchasesModule } from './purchases/purchases.module';
import { PurchaseRequestsModule } from './purchase-requests/purchase-requests.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { InventoryModule } from './inventory/inventory.module';
import { SalesModule } from './sales/sales.module';
import { ReceivablesModule } from './receivables/receivables.module';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    DepartmentsModule,
    AccessModule,
    EmployeesModule,
    SuppliersModule,
    CustomersModule,
    CustomerGroupsModule,
    TerritoriesModule,
    PaymentTermsModule,
    UnitsModule,
    ItemCategoriesModule,
    ItemsModule,
    PurchaseTypesModule,
    PurchasesModule,
    PurchaseRequestsModule,
    DashboardModule,
    InventoryModule,
    SalesModule,
    ReceivablesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
