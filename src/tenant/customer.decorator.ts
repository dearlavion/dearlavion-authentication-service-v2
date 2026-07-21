import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Extracts the tenant from the `X-Customer` request header. Membership in the allowlist is enforced
 * downstream by TenantService (a missing/unknown value surfaces as 400 when the model is resolved).
 */
export const Customer = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | undefined => {
  const header = ctx.switchToHttp().getRequest<Request>().headers['x-customer'];
  return Array.isArray(header) ? header[0] : header;
});
