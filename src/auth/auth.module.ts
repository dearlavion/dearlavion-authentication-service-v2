import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtService } from './jwt.service';
import { PasswordService } from './password.service';
import { GoogleVerifierService } from './google-verifier.service';
import { SimpleAuthStrategy } from './strategies/simple-auth.strategy';
import { GoogleAuthStrategy } from './strategies/google-auth.strategy';

@Module({
  imports: [UserModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtService,
    PasswordService,
    GoogleVerifierService,
    SimpleAuthStrategy,
    GoogleAuthStrategy,
  ],
  exports: [JwtService],
})
export class AuthModule {}
