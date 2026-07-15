import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ApiTags } from '@nestjs/swagger';

/** Health endpoint, kept at /actuator/health to match the Java v1 path. */
@ApiTags('health')
@Controller('actuator/health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  health() {
    return { status: this.connection.readyState === 1 ? 'UP' : 'DOWN' };
  }
}
