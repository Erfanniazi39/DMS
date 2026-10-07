import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomerFilesController } from './customer-files.controller';
import { CustomersService } from './customers.service';
import { CustomerContactsService } from './customer-contacts.service';
import { CustomerAddressesService } from './customer-addresses.service';
import { CustomerNotesService } from './customer-notes.service';
import { CustomerDocumentsService } from './customer-documents.service';
import { CustomerComplaintsService } from './customer-complaints.service';
import { CustomerFinancialService } from './customer-financial.service';

// Imports no other feature module. Reference-data checks (customer group,
// territory, payment term "exists and is active") use those modules' plain
// *-rules.ts functions, and the child services share customer-rules.ts —
// no service here injects another, so there are no provider cycles.
// A future Sales module should import ensureTransactableCustomer() from
// customer-rules.ts rather than inject CustomersService.
@Module({
  controllers: [CustomersController, CustomerFilesController],
  providers: [
    CustomersService,
    CustomerContactsService,
    CustomerAddressesService,
    CustomerNotesService,
    CustomerDocumentsService,
    CustomerComplaintsService,
    CustomerFinancialService,
  ],
})
export class CustomersModule {}
