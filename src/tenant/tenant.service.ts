import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AppConfig } from '../config/configuration';
import { User, UserDocument, UserSchema } from '../user/user.schema';

/**
 * Resolves the per-customer `User` model. Each customer's users live in an isolated
 * `authentication-<customer>` database on the same cluster; `connection.useDb(..., { useCache })`
 * hands back a tenant-scoped handle that shares the base connection's pool (no pool-per-tenant).
 * Models are cached by Mongoose per Db handle; we reuse `db.models[...]` to avoid OverwriteModelError.
 */
@Injectable()
export class TenantService {
  private readonly allowed: Set<string>;
  private readonly indexSyncs = new Map<string, Promise<void>>();

  constructor(
    @InjectConnection() private readonly connection: Connection,
    config: ConfigService<AppConfig, true>,
  ) {
    this.allowed = new Set(config.get('customers', { infer: true }));
  }

  /** Throw 400 unless the customer is in the allowlist. Returns it for convenient chaining. */
  assertCustomer(customer: string | undefined): string {
    if (!customer || !this.allowed.has(customer)) {
      throw new BadRequestException(`Unknown customer: ${customer || '(none)'}`);
    }
    return customer;
  }

  /** The `User` model bound to a customer's isolated DB. */
  userModel(customer: string): Model<UserDocument> {
    this.assertCustomer(customer);
    const db = this.connection.useDb(`authentication-${customer}`, { useCache: true });
    const model =
      (db.models[User.name] as Model<UserDocument>) ??
      (db.model(User.name, UserSchema) as unknown as Model<UserDocument>);
    this.ensureIndexes(customer, model);
    return model;
  }

  /** Build the unique username/email indexes in each tenant DB the first time it's touched.
   * (useDb().model() doesn't auto-build them.) Cached so it runs at most once per customer. */
  private ensureIndexes(customer: string, model: Model<UserDocument>): void {
    if (this.indexSyncs.has(customer)) return;
    this.indexSyncs.set(
      customer,
      model
        .syncIndexes()
        .then(() => undefined)
        .catch(() => {
          // Allow a retry on a later request if the build failed transiently.
          this.indexSyncs.delete(customer);
        }),
    );
  }
}
