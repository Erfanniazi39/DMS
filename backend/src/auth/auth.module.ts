import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginThrottle } from './login-throttle';
import './session.types';

@Module({
  controllers: [AuthController],
  // One shared limiter for the whole process (failed-login counters live in memory).
  providers: [AuthService, { provide: LoginThrottle, useFactory: () => new LoginThrottle() }],
  exports: [AuthService],
})
export class AuthModule {}
