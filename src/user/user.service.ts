import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { hashPassword } from '../auth/password.util';
import { AuthType, User, UserDocument } from './user.schema';
import { UserVoDto, UserView } from './user.dto';

@Injectable()
export class UserService {
  constructor(@InjectModel(User.name) private readonly model: Model<UserDocument>) {}

  findByUsername(username: string): Promise<UserDocument | null> {
    return this.model.findOne({ username }).exec();
  }

  findByEmail(email: string): Promise<UserDocument | null> {
    return this.model.findOne({ email }).exec();
  }

  async loadByUsernameOrThrow(username: string): Promise<UserDocument> {
    const user = await this.findByUsername(username);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async registerUser(vo: UserVoDto, type: AuthType): Promise<UserDocument> {
    try {
      return await this.model.create({
        username: vo.username,
        email: vo.email,
        phone: vo.phone,
        password: vo.password ? hashPassword(vo.password) : undefined,
        type,
      });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) {
        throw new ConflictException('User already exists');
      }
      throw e;
    }
  }

  async updateUser(username: string, u: UserVoDto): Promise<UserDocument> {
    const user = await this.loadByUsernameOrThrow(username);
    if (u.firstname != null) user.firstname = u.firstname;
    if (u.lastname != null) user.lastname = u.lastname;
    if (u.phone != null) user.phone = u.phone;
    if (u.activeProfile != null) user.activeProfile = u.activeProfile;
    if (u.image != null) user.image = u.image;
    return user.save();
  }

  async updatePassword(username: string, newPassword: string): Promise<void> {
    const user = await this.loadByUsernameOrThrow(username);
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
