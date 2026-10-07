import { Module } from '@nestjs/common';
import { PaymentTermsController } from './payment-terms.controller';
import { PaymentTermsService } from './payment-terms.service';

@Module({
  controllers: [PaymentTermsController],
  providers: [PaymentTermsService],
})
export class PaymentTermsModule {}
