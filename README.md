# dearlavion-authentication-service-v2

NestJS / TypeScript port of the Java `dearlavion-authentication-service`. Issues and verifies JWTs,
registers/authenticates users (username+password and Google), and publishes user events. The
**keystone** service — every other service verifies tokens against its `POST /auth/verify`.

Runs **alongside** the Java v1 on a **new port (9081)** against the same MongoDB (`users`) and Kafka.

## Token & password interoperability (the critical part)

- **JWT**: HS256, key = the **base64-decoded** secret (default is the exact key baked into the Java
  `JwtService`), claims `{ username, sub, iat, exp }`, 24h. Because key + algorithm + claim shape
  match v1, **v1- and v2-issued tokens verify on either stack**. A unit test signs a "v1-shaped"
  token and verifies it under v2.
- **Passwords**: bcrypt (`bcryptjs`, strength 10) — hash-compatible with Spring's
  `BCryptPasswordEncoder`, so v1-hashed passwords verify under v2 and vice versa.
- Same `users` collection, field names, and unique username/email indexes.

## Endpoints (`/auth`)

| Method | Path | Notes |
|---|---|---|
| POST | `/register?type=SIMPLE&googleToken=` | 201 `{message, user}`; 409 if the user exists |
| POST | `/login?type=SIMPLE` | 201 `{token, user}` (user excludes the password hash); 401 on bad creds |
| POST | `/verify` | `{token}` → `{valid, username, email, userId}` (400 missing, 401 invalid) |
| GET | `/user/{username}` | public user view (no password); 404 if missing |
| PATCH | `/user/{username}` | update firstname/lastname/phone/activeProfile/image |
| POST | `/forgot-password?email=` | always 200; emits a reset event if the account exists |
| POST | `/reset-password` | `{token, newPassword}` → 200; 400 on bad/expired token |
| POST | `/verify-google` | `{idToken}` → `{email}` |

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
| `MONGODB_URI` | `mongodb://localhost:27017/authentication-service` |
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
