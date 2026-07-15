import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AuthType, UserDocument } from '../user/user.schema';
import { UserVoDto } from '../user/user.dto';
import { SimpleAuthStrategy } from './strategies/simple-auth.strategy';
import { GoogleAuthStrategy } from './strategies/google-auth.strategy';
import {
  AUTH_EVENT_PUBLISHER,
  AuthEventPublisher,
  AuthEventType,
} from '../kafka/kafka.module';

interface AuthStrategy {
  type: AuthType;
  authenticate(vo: UserVoDto): Promise<UserDocument>;
  register(vo: UserVoDto): Promise<UserDocument>;
}

@Injectable()
export class AuthService {
  private readonly strategies: AuthStrategy[];

  constructor(
    simple: SimpleAuthStrategy,
    google: GoogleAuthStrategy,
    @Inject(AUTH_EVENT_PUBLISHER) private readonly events: AuthEventPublisher,
  ) {
    this.strategies = [simple, google];
  }

  resolve(type: AuthType): AuthStrategy {
    const strategy = this.strategies.find((s) => s.type === type);
    if (!strategy) {
      throw new BadRequestException('Unsupported login type');
    }
    return strategy;
  }

  /** Publishes the new-user welcome event (consumed by notification-service). */
  async sendNewUserWelcomeEmail(user: UserDocument): Promise<void> {
    await this.events.publish(AuthEventType.NEW_USER, { username: user.username });
  }

  /** Publishes the password-reset event carrying the reset token + recipient email. */
  async sendResetPasswordEvent(user: UserDocument, token: string): Promise<void> {
    await this.events.publish(AuthEventType.RESET_PASSWORD, {
      username: user.username,
      email: user.email,
      token,
    });
  }
}
