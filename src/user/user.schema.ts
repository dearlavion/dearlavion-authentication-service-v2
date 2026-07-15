import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** UI-switching profile (matches the Java Role enum, plus the additive BUSINESS_OWNER/STAFF). */
export enum Role {
  WISHER = 'WISHER',
  COPILOT = 'COPILOT',
  BUSINESS_OWNER = 'BUSINESS_OWNER',
  STAFF = 'STAFF',
}

export enum AuthType {
  SIMPLE = 'SIMPLE',
  GOOGLE = 'GOOGLE',
}

export type UserDocument = HydratedDocument<User>;

/**
 * A user. Same `users` collection and field names as the Java v1 service so both stacks read the
 * same documents. Passwords are bcrypt hashes (interoperable with Spring's BCryptPasswordEncoder).
 */
@Schema({ collection: 'users' })
export class User {
  @Prop({ unique: true, index: true })
  username!: string;

  @Prop()
  firstname?: string;

  @Prop()
  lastname?: string;

  @Prop({ unique: true, index: true })
  email!: string;

  @Prop()
  phone?: string;

  @Prop()
  password?: string;

  @Prop()
  image?: string;

  @Prop({ enum: Role, default: Role.WISHER })
  activeProfile!: Role;

  @Prop({ enum: AuthType, default: AuthType.SIMPLE })
  type!: AuthType;
}

export const UserSchema = SchemaFactory.createForClass(User);
