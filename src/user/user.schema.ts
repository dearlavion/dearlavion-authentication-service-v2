import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Access role. ADMIN/STAFF are privileged (admin on consuming backends); SIMPLE is a normal user. */
export enum Role {
  ADMIN = 'ADMIN',
  STAFF = 'STAFF',
  SIMPLE = 'SIMPLE',
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

  @Prop({ enum: Role, default: Role.SIMPLE })
  activeProfile!: Role;

  @Prop({ enum: AuthType, default: AuthType.SIMPLE })
  type!: AuthType;
}

export const UserSchema = SchemaFactory.createForClass(User);
