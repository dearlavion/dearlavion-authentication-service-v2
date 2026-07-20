import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { AppConfig } from '../config/configuration';
import { UserService } from '../user/user.service';
import { AuthType, UserDocument } from '../user/user.schema';
import { UserVoDto } from '../user/user.dto';
import { AuthService } from './auth.service';
import { JwtService } from './jwt.service';
import { PasswordService } from './password.service';
import { GoogleVerifierService } from './google-verifier.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly googleEnabled: boolean;

  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
    private readonly passwordService: PasswordService,
    private readonly googleVerifier: GoogleVerifierService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.googleEnabled = config.get('google', { infer: true }).enabled;
  }

  @Post('register')
  async register(
    @Body() request: UserVoDto,
    @Query('type') typeParam?: string,
    @Query('googleToken') googleToken?: string,
  ) {
    let type = (typeParam as AuthType) ?? AuthType.SIMPLE;
    if (!this.googleEnabled) type = AuthType.SIMPLE;
    if (type === AuthType.GOOGLE && googleToken) request.googleToken = googleToken;

    const strategy = this.authService.resolve(type);
    const user = await strategy.register(request);
    await this.authService.sendNewUserWelcomeEmail(user);
    return { message: 'User registered successfully', user: user.username };
  }

  @Patch('user/:username')
  async updateUser(@Param('username') username: string, @Body() u: UserVoDto) {
    const updated = await this.userService.updateUser(username, u);
    return { message: 'User updated successfully', username: updated.username };
  }

  @Get('user/:username')
  async getUser(@Param('username') username: string) {
    const user = await this.userService.loadByUsernameOrThrow(username);
    return this.userService.toView(user);
  }

  @Post('login')
  async login(@Body() request: UserVoDto, @Query('type') typeParam?: string) {
    let type = (typeParam as AuthType) ?? AuthType.SIMPLE;
    if (!this.googleEnabled) type = AuthType.SIMPLE;

    const strategy = this.authService.resolve(type);
    const user = await strategy.authenticate(request);
    const token = this.jwtService.generateToken(user.username);
    return { token, user: this.userResponse(user) };
  }

  @Post('forgot-password')
  async forgotPassword(@Query('email') email: string) {
    await this.passwordService.initiateReset(email);
    return { message: 'If an account exists, a reset link was sent.' };
  }

  @Post('reset-password')
  async resetPassword(@Body() body: { token?: string; newPassword?: string }) {
    if (!body?.token || !body?.newPassword) {
      throw new BadRequestException('Invalid or expired token');
    }
    try {
      await this.passwordService.resetPassword(body.token, body.newPassword);
    } catch {
      throw new BadRequestException('Invalid or expired token');
    }
    return { message: 'Password reset successful' };
  }

  @Post('verify')
  async verify(@Body() req: { token?: string }) {
    const token = req?.token;
    if (!token || token.trim() === '') {
      throw new BadRequestException({ valid: false, error: 'Token missing' });
    }
    const claims = this.jwtService.verifyToken(token);
    // Reject tokens minted for a different customer (tenant isolation). Tokens with no customer
    // claim (legacy/v1) are allowed through — the per-tenant user lookup below still gates them.
    if (claims?.customer && claims.customer !== this.jwtService.customer) {
      throw new UnauthorizedException({ valid: false });
    }
    const username = claims?.username ?? null;
    const user = username ? await this.userService.findByUsername(username) : null;
    if (!username || !user) {
      // 401 with { valid: false } — the shape core/notification/booking-engine expect.
      throw new UnauthorizedException({ valid: false });
    }
    // `activeProfile` (role) and `customer` (tenant) are additive — existing consumers ignore them;
    // store-engine uses the role for admin authz and the customer for tenant enforcement.
    return {
      valid: true,
      username,
      email: user.email,
      userId: String(user._id),
      activeProfile: user.activeProfile,
      customer: this.jwtService.customer,
    };
  }

  @Post('verify-google')
  async verifyGoogle(@Body() body: { idToken?: string }) {
    if (!body?.idToken || body.idToken.trim() === '') {
      throw new BadRequestException('Google token missing');
    }
    const payload = await this.googleVerifier.verify(body.idToken);
    return { email: payload.email };
  }

  /** Login response user object — excludes the password hash (a small improvement over v1). */
  private userResponse(user: UserDocument) {
    return {
      id: String(user._id),
      username: user.username,
      email: user.email,
      firstname: user.firstname,
      lastname: user.lastname,
      phone: user.phone,
      image: user.image,
      activeProfile: user.activeProfile,
      type: user.type,
    };
  }
}
