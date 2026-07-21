import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
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
import { AuthType, Role, UserDocument } from '../user/user.schema';
import { UserVoDto } from '../user/user.dto';
import { Customer } from '../tenant/customer.decorator';
import { AuthService } from './auth.service';
import { JwtService } from './jwt.service';
import { PasswordService } from './password.service';
import { GoogleVerifierService } from './google-verifier.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly googleEnabled: boolean;
  private readonly provisionSecret: string;

  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
    private readonly passwordService: PasswordService,
    private readonly googleVerifier: GoogleVerifierService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.googleEnabled = config.get('google', { infer: true }).enabled;
    this.provisionSecret = config.get('provisionSecret', { infer: true });
  }

  /** Privileged-role assignment is allowed only with a matching X-Provision-Secret (fail closed if
   * no secret is configured). Keeps the public signup endpoint from self-granting admin. */
  private canProvision(secret?: string): boolean {
    return !!this.provisionSecret && secret === this.provisionSecret;
  }

  @Post('register')
  async register(
    @Customer() customer: string,
    @Body() request: UserVoDto,
    @Headers('x-provision-secret') provisionSecret?: string,
    @Query('type') typeParam?: string,
    @Query('googleToken') googleToken?: string,
  ) {
    let type = (typeParam as AuthType) ?? AuthType.SIMPLE;
    if (!this.googleEnabled) type = AuthType.SIMPLE;
    if (type === AuthType.GOOGLE && googleToken) request.googleToken = googleToken;

    // A privileged role from the body is honored only with the provisioning secret; else SIMPLE.
    const wantsPrivileged = request.activeProfile === Role.ADMIN || request.activeProfile === Role.STAFF;
    request.activeProfile = wantsPrivileged && this.canProvision(provisionSecret) ? request.activeProfile : Role.SIMPLE;

    const strategy = this.authService.resolve(type);
    const user = await strategy.register(request, customer);
    await this.authService.sendNewUserWelcomeEmail(user);
    return { message: 'User registered successfully', user: user.username };
  }

  @Patch('user/:username')
  async updateUser(
    @Customer() customer: string,
    @Param('username') username: string,
    @Body() u: UserVoDto,
    @Headers('x-provision-secret') provisionSecret?: string,
  ) {
    // Role changes are gated by the same secret; without it, ignore any activeProfile in the body
    // (other profile fields still update). Closes the promote-anyone hole on this open endpoint.
    if (u.activeProfile != null && !this.canProvision(provisionSecret)) {
      u.activeProfile = undefined;
    }
    const updated = await this.userService.updateUser(customer, username, u);
    return { message: 'User updated successfully', username: updated.username };
  }

  @Get('user/:username')
  async getUser(@Customer() customer: string, @Param('username') username: string) {
    const user = await this.userService.loadByUsernameOrThrow(customer, username);
    return this.userService.toView(user);
  }

  @Post('login')
  async login(@Customer() customer: string, @Body() request: UserVoDto, @Query('type') typeParam?: string) {
    let type = (typeParam as AuthType) ?? AuthType.SIMPLE;
    if (!this.googleEnabled) type = AuthType.SIMPLE;

    const strategy = this.authService.resolve(type);
    const user = await strategy.authenticate(request, customer);
    const token = this.jwtService.generateToken(user.username, customer);
    return { token, user: this.userResponse(user, customer) };
  }

  @Post('forgot-password')
  async forgotPassword(@Customer() customer: string, @Query('email') email: string) {
    await this.passwordService.initiateReset(customer, email);
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
    // The tenant comes from the token's own `customer` claim — a token with no claim can't be
    // resolved to a DB, so it's rejected. The user is then looked up in that tenant's DB; any
    // failure (unknown customer, missing user) collapses to 401 { valid: false }.
    if (!claims?.customer) {
      throw new UnauthorizedException({ valid: false });
    }
    let user: UserDocument | null = null;
    try {
      user = await this.userService.findByUsername(claims.customer, claims.username);
    } catch {
      user = null;
    }
    if (!user) {
      // 401 with { valid: false } — the shape core/notification/booking-engine expect.
      throw new UnauthorizedException({ valid: false });
    }
    // `activeProfile` (role) and `customer` (tenant) are additive — existing consumers ignore them;
    // store-engine uses the role for admin authz and the customer for tenant enforcement.
    return {
      valid: true,
      username: claims.username,
      email: user.email,
      userId: String(user._id),
      activeProfile: user.activeProfile,
      customer: claims.customer,
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
  private userResponse(user: UserDocument, customer: string) {
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
      customer,
    };
  }
}
