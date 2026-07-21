import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserService } from '../../user/user.service';
import { AuthType, UserDocument } from '../../user/user.schema';
import { UserVoDto } from '../../user/user.dto';
import { GoogleVerifierService } from '../google-verifier.service';

/** Google ID-token authentication (matches the Java GoogleAuthenticationStrategy). */
@Injectable()
export class GoogleAuthStrategy {
  readonly type = AuthType.GOOGLE;

  constructor(
    private readonly userService: UserService,
    private readonly googleVerifier: GoogleVerifierService,
  ) {}

  async authenticate(vo: UserVoDto, customer: string): Promise<UserDocument> {
    const payload = await this.googleVerifier.verify(vo.googleToken ?? '');
    const user = payload.email ? await this.userService.findByEmail(customer, payload.email) : null;
    if (!user) {
      throw new UnauthorizedException('User not registered. Please sign up first.');
    }
    return user;
  }

  async register(vo: UserVoDto, customer: string): Promise<UserDocument> {
    const payload = await this.googleVerifier.verify(vo.googleToken ?? '');
    if (!payload.email_verified) {
      throw new UnauthorizedException('Google authentication failed');
    }
    // Security check: the Google account email must match the submitted email.
    if (payload.email !== vo.email) {
      throw new UnauthorizedException('Email does not match Google account');
    }
    if (vo.email && (await this.userService.findByEmail(customer, vo.email))) {
      throw new ConflictException('User already exists');
    }
    return this.userService.registerUser(customer, vo, AuthType.GOOGLE);
  }
}
