# dearlavion-authentication-service-v2

NestJS / TypeScript port of the Java `dearlavion-authentication-service`. Issues and verifies JWTs,
registers/authenticates users (username+password and Google), and publishes user events. The
**keystone** service — every other service verifies tokens against its `POST /auth/verify`.

Runs **alongside** the Java v1 on a **new port (9081)**, on the same MongoDB cluster and Kafka. It's
also **multi-tenant** — one instance serves many customers, each with its own users DB (see below).

## Multi-tenancy (per-customer isolation)

**One instance serves many customers** (allowlisted in `CUSTOMERS`). The tenant is chosen per
request — the **`X-Customer` header** on credential endpoints, the token's **`customer` claim** on
`verify`/`reset-password` — and each customer's users live in an isolated `authentication-<customer>`
DB (routed via `connection.useDb`, one shared pool). Issued JWTs carry the `customer` claim, which
`/auth/verify` and downstream backends enforce. Onboard a customer by adding its slug to `CUSTOMERS`
and restarting — no new instance, no code changes. See
**[ONBOARDING-A-CUSTOMER.md](ONBOARDING-A-CUSTOMER.md)** for the step-by-step guide.

## Registering customers, users & admins

Three levels — a **customer** (tenant) is config; **users** and **admins** are created via the API,
always scoped by the **`X-Customer`** header.

### 1. Register a new customer (tenant)

Add its slug to the `CUSTOMERS` allowlist and restart the instance. Its
`authentication-<customer>` DB is created automatically on the first user registration — nothing to
pre-provision.

```bash
# .env
CUSTOMERS=travel-besty,acme          # add the new slug, then restart
```

Full walkthrough (backend + frontend wiring): **[ONBOARDING-A-CUSTOMER.md](ONBOARDING-A-CUSTOMER.md)**.

Roles are **`ADMIN`**, **`STAFF`** (both privileged — admin on consuming backends) and **`SIMPLE`**
(a normal user, the default). Assigning a privileged role is gated by the **`X-Provision-Secret`**
header (matching the `PROVISION_SECRET` env), so the public signup endpoint can't self-grant admin.

### 2. Register a user (regular customer/traveler)

`POST /auth/register` with `X-Customer`. New users are always created as `SIMPLE` — any `activeProfile`
in the body is ignored without the provisioning secret.

```bash
curl -X POST http://localhost:9081/auth/register \
  -H 'content-type: application/json' \
  -H 'X-Customer: travel-besty' \
  -d '{"username":"traveler","email":"traveler@example.com","password":"secret123"}'
# → 201 { "message": "User registered successfully", "user": "traveler" }   (role: SIMPLE)
# 409 if the username/email already exists in this tenant.
```

The same username/email may be reused under a **different** customer — tenants are isolated.

### 3. Register an admin

Pass `activeProfile` **and** the `X-Provision-Secret` header — one call, no separate promote step:

```bash
curl -X POST http://localhost:9081/auth/register \
  -H 'content-type: application/json' \
  -H 'X-Customer: travel-besty' \
  -H 'X-Provision-Secret: <PROVISION_SECRET>' \
  -d '{"username":"owner","email":"owner@example.com","password":"secret123","activeProfile":"ADMIN"}'
```

Or promote an existing user (also secret-gated):

```bash
curl -X PATCH http://localhost:9081/auth/user/owner \
  -H 'content-type: application/json' \
  -H 'X-Customer: travel-besty' \
  -H 'X-Provision-Secret: <PROVISION_SECRET>' \
  -d '{"activeProfile":"ADMIN"}'
```

Verify a login token now carries the role/tenant:

```bash
TOK=$(curl -s -X POST http://localhost:9081/auth/login \
  -H 'content-type: application/json' -H 'X-Customer: travel-besty' \
  -d '{"email":"owner@example.com","password":"secret123"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).token))")

curl -s -X POST http://localhost:9081/auth/verify -H 'content-type: application/json' -d "{\"token\":\"$TOK\"}"
# → { "valid": true, ..., "activeProfile": "ADMIN", "customer": "travel-besty" }
```

> Without a valid `X-Provision-Secret`, both `register` and `PATCH` silently force/ignore the role so
> the user stays `SIMPLE`. If `PROVISION_SECRET` is unset, privileged roles can't be assigned via the
> API at all (fail closed). The `ADMIN_USERNAMES` allowlist on the consuming backend remains only as a
> bootstrap escape hatch.

**Where the secret comes from.** `PROVISION_SECRET` is **not** issued by the service — *you* (the
operator) generate one strong random value per environment and set it in that instance's config:

```bash
openssl rand -hex 32          # generate; put the output in .env (local) or your secrets manager (prod)
```

It's a **shared operator credential** (per auth-instance, not per user/tenant): whoever provisions
admins holds a copy and passes it in the header. Treat it like a root credential — keep it out of the
frontend, git, and logs; set it via the deploy pipeline's secret store in real environments; rotate it
(change the value + restart) if it leaks. Rotating only stops *assigning* roles — existing admins keep
theirs.

## Token & password interoperability (the critical part)

- **JWT**: HS256, key = the **base64-decoded** secret (default is the exact key baked into the Java
  `JwtService`), claims `{ username, sub, customer, iat, exp }`, 24h. The additive `customer` claim
  (see Multi-tenancy above) is ignored by v1 verification, so **v1- and v2-issued tokens still
  verify on either stack**. A unit test signs a "v1-shaped" token and verifies it under v2.
- **Passwords**: bcrypt (`bcryptjs`, strength 10) — hash-compatible with Spring's
  `BCryptPasswordEncoder`, so v1-hashed passwords verify under v2 and vice versa.
- Same `users` collection shape, field names, and unique username/email indexes — now one such
  collection **per tenant** (in each `authentication-<customer>` DB) rather than a single shared one.

## Endpoints (`/auth`)

Credential endpoints require the **`X-Customer`** header (the tenant); `verify`/`reset-password` read
the tenant from the token instead. An unknown/missing customer on a header-scoped call → **400**.

| Method | Path | `X-Customer`? | Notes |
|---|---|---|---|
| POST | `/register?type=SIMPLE&googleToken=` | **required** | 201 `{message, user}`; 409 if the user exists. `activeProfile` (ADMIN/STAFF) honored only with `X-Provision-Secret`, else SIMPLE |
| POST | `/login?type=SIMPLE` | **required** | 201 `{token, user}` (user excludes the password hash; includes `customer`); 401 on bad creds |
| POST | `/verify` | — (from token) | `{token}` → `{valid, username, email, userId, activeProfile, customer}` (400 missing token, 401 invalid/wrong-tenant) |
| GET | `/user/{username}` | **required** | public user view (no password); 404 if missing |
| PATCH | `/user/{username}` | **required** | update firstname/lastname/phone/image; changing `activeProfile` requires `X-Provision-Secret` |
| POST | `/forgot-password?email=` | **required** | always 200; emits a reset event if the account exists |
| POST | `/reset-password` | — (from token) | `{token, newPassword}` → 200; 400 on bad/expired token |
| POST | `/verify-google` | — | `{idToken}` → `{email}` |

## Events (Kafka)

Topic `authentication-service-event`, `{ type, payload }` envelope. `NEW_USER` on register,
`RESET_PASSWORD` on forgot-password — matching v1 so notification-service consumes them unchanged.

## Commands

```bash
npm install
npm run build
npm test            # JWT/bcrypt unit tests + full e2e (in-process Mongo)
npm run start:prod
```

Tests use `mongodb-memory-server` (no Docker). Google verification is behind an injectable service
that tests mock — the live Google path can't be exercised offline.

## Configuration (`.env`, see `.env.example`)

| Var | Default |
|---|---|
| `PORT` | 9081 |
| `CUSTOMERS` | `dearlavion` — comma-separated tenant allowlist; each maps to an `authentication-<customer>` DB (falls back to the legacy single `CUSTOMER`) |
| `PROVISION_SECRET` | *(empty)* — **operator-generated** (e.g. `openssl rand -hex 32`); required via `X-Provision-Secret` to assign the `ADMIN`/`STAFF` role at register/patch; empty ⇒ privileged roles can't be set via the API |
| `MONGODB_URI` | `mongodb://localhost:27017/authentication-service` — base connection; queries route to `authentication-<customer>` via `useDb()` |
| `JWT_SECRET` | base64 key matching v1 (do not change if tokens must interoperate) |
| `JWT_EXPIRES_IN` / `JWT_RESET_EXPIRES_IN` | `24h` / `15m` |
| `KAFKA_ENABLED` / `KAFKA_BROKERS` | true / `localhost:29092` |
| `GOOGLE_ENABLED` / `GOOGLE_CLIENT_ID` | true / (v1 client id) |

Health at `/actuator/health`, Swagger at `/swagger-ui`.

## Deviations from v1 (intentional)

- Login response no longer includes the password hash.
- `forgot-password` for an unknown email returns 200 without error (v1 could 500 and leak account
  existence).
- `register`'s `googleToken` is an optional query param (v1 marked it required).
