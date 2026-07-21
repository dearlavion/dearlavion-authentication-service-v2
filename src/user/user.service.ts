import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hashPassword } from '../auth/password.util';
import { TenantService } from '../tenant/tenant.service';
import { AuthType, User, UserDocument } from './user.schema';
import { UserVoDto, UserView } from './user.dto';

// Every lookup/write is scoped to a customer's own DB, resolved via TenantService.
@Injectable()
export class UserService {
  constructor(private readonly tenants: TenantService) {}

  findByUsername(customer: string, username: string): Promise<UserDocument | null> {
    return this.tenants.userModel(customer).findOne({ username }).exec();
  }

  findByEmail(customer: string, email: string): Promise<UserDocument | null> {
    return this.tenants.userModel(customer).findOne({ email }).exec();
  }

  async loadByUsernameOrThrow(customer: string, username: string): Promise<UserDocument> {
    const user = await this.findByUsername(customer, username);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async registerUser(customer: string, vo: UserVoDto, type: AuthType): Promise<UserDocument> {
    try {
      return await this.tenants.userModel(customer).create({
        username: vo.username,
        email: vo.email,
        phone: vo.phone,
        password: vo.password ? hashPassword(vo.password) : undefined,
        // Already gated by the controller (privileged roles need X-Provision-Secret); defaults to SIMPLE.
        activeProfile: vo.activeProfile,
        type,
      });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) {
        throw new ConflictException('User already exists');
      }
      throw e;
    }
  }

  async updateUser(customer: string, username: string, u: UserVoDto): Promise<UserDocument> {
    const user = await this.loadByUsernameOrThrow(customer, username);
    if (u.firstname != null) user.firstname = u.firstname;
    if (u.lastname != null) user.lastname = u.lastname;
    if (u.phone != null) user.phone = u.phone;
    if (u.activeProfile != null) user.activeProfile = u.activeProfile;
    if (u.image != null) user.image = u.image;
    return user.save();
  }

  async updatePassword(customer: string, username: string, newPassword: string): Promise<void> {
    const user = await this.loadByUsernameOrThrow(customer, username);
    user.password = hashPassword(newPassword);
    await user.save();
  }

  toView(user: User): UserView {
    return {
      username: user.username,
      email: user.email,
      firstname: user.firstname,
      lastname: user.lastname,
      phone: user.phone,
      image: user.image,
      activeProfile: user.activeProfile,
    };
  }
}
