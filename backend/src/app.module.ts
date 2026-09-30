import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DepartmentsModule } from './departments/departments.module';
import { AccessModule } from './access/access.module';
import { EmployeesModule } from './employees/employees.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { UnitsModule } from './units/units.module';
import { PurchaseTypesModule } from './purchase-types/purchase-types.module';
import { PurchasesModule } from './purchases/purchases.module';
import { PurchaseRequestsModule } from './purchase-requests/purchase-requests.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    DepartmentsModule,
    AccessModule,
    EmployeesModule,
    SuppliersModule,
    UnitsModule,
    PurchaseTypesModule,
    PurchasesModule,
    PurchaseRequestsModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
