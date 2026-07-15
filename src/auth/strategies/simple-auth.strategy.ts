import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserService } from '../../user/user.service';
import { AuthType, UserDocument } from '../../user/user.schema';
import { UserVoDto } from '../../user/user.dto';
import { matchesPassword } from '../password.util';

/** Username/email + password authentication (matches the Java SimpleAuthenticationStrategy). */
@Injectable()
export class SimpleAuthStrategy {
  readonly type = AuthType.SIMPLE;

  constructor(private readonly userService: UserService) {}

  async authenticate(vo: UserVoDto): Promise<UserDocument> {
    let user = vo.username ? await this.userService.findByUsername(vo.username) : null;
    if (!user && vo.email) {
      user = await this.userService.findByEmail(vo.email);
    }
    if (!user || !matchesPassword(vo.password ?? '', user.password)) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return user;
  }

  async register(vo: UserVoDto): Promise<UserDocument> {
    if (vo.email && (await this.userService.findByEmail(vo.email))) {
      throw new ConflictException('User already exists');
    }
    return this.userService.registerUser(vo, AuthType.SIMPLE);
  }
}
