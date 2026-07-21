import { Module } from '@nestjs/common';
import { TenantService } from '../tenant/tenant.service';
import { UserService } from './user.service';

// No MongooseModule.forFeature here: the User model is resolved per-customer at runtime by
// TenantService (each customer has its own authentication-<customer> DB). The root connection
// comes from MongooseModule.forRootAsync in AppModule and is injectable app-wide.
@Module({
  providers: [TenantService, UserService],
  exports: [UserService, TenantService],
})
export class UserModule {}
