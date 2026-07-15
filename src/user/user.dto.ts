import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { Role } from './user.schema';

/** Mirrors the Java UserVO used across register/login/update. */
export class UserVoDto {
  @IsOptional() @IsString() username?: string;
  @IsOptional() @IsString() firstname?: string;
  @IsOptional() @IsString() lastname?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() password?: string;
  @IsOptional() @IsString() image?: string;
  @IsOptional() @IsEnum(Role) activeProfile?: Role;
  @IsOptional() @IsString() googleToken?: string;
}

/** Public projection of a user (no password), returned by GET /auth/user/{username}. */
export interface UserView {
  username: string;
  email?: string;
  firstname?: string;
  lastname?: string;
  phone?: string;
  image?: string;
  activeProfile?: Role;
}
