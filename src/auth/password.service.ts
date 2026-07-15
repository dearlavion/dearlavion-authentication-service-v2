import { Injectable } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { JwtService } from './jwt.service';
import { AuthService } from './auth.service';

@Injectable()
export class PasswordService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Starts the reset flow. Silently does nothing if the email is unknown (so the response never
   * reveals whether an account exists — a small fix over v1, which threw on unknown emails).
   */
  async initiateReset(email: string): Promise<void> {
    const user = await this.userService.findByEmail(email);
    if (!user) return;
    const token = this.jwtService.generatePasswordResetToken(user.username);
    await this.authService.sendResetPasswordEvent(user, token);
  }

  /** Resets the password given a valid reset token. Throws 401 if the token is invalid/expired. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const username = this.jwtService.validatePasswordResetToken(token);
    await this.userService.updatePassword(username, newPassword);
  }
}
