# Onboarding a new customer (tenant)

This service is **multi-tenant by configuration**: one running instance serves exactly **one
customer**, fixed by the `CUSTOMER` environment variable. Each customer gets its own isolated user
store (`authentication-<customer>` DB) and its JWTs are stamped with a `customer` claim so a token
minted for one customer is **rejected** everywhere else.

To add a customer you don't change any code — you run another instance (or another deployment) of
this service with a different `CUSTOMER` + `MONGODB_URI`, and point that customer's backend at it.

> Worked example throughout: customer **`travel-besty`**, backed by **`dearlavion-store-engine`**
> and the **`dearlavion-travel-besty-ui`** frontend.

---

## How isolation works (the model)

```
                         ┌─────────────────────────────────────┐
  UI (login form)  ──▶   │  auth-service-v2   CUSTOMER=<name>   │
   POST /auth/login      │  DB: authentication-<name>          │
                         │  JWT: { username, sub, customer,... }│
                         └─────────────────────────────────────┘
                                     ▲            issues JWT
        Bearer <jwt>                 │ POST /auth/verify
            │                        │  (rejects if token.customer ≠ CUSTOMER)
            ▼                        │
   ┌──────────────────────────────────────┐
   │  backend (e.g. store-engine)          │
   │  EXPECTED_CUSTOMER=<name>             │
   │  AuthGuard → /auth/verify             │
   │  (also rejects token.customer ≠ name) │
   └──────────────────────────────────────┘
```

- The **auth instance** signs `{ username, sub, customer, iat, exp }` and, on `/auth/verify`,
  refuses any token whose `customer` claim ≠ its own `CUSTOMER`.
- The **backend** sets `EXPECTED_CUSTOMER` and independently refuses tokens from another tenant
  (defense-in-depth — it never trusts a token just because verify returned `valid`).
- **Admin** is by role: a user's `activeProfile` must be `BUSINESS_OWNER` or `STAFF`.

---

## Steps

### 1. Pick a customer id

Use a short, URL-safe slug — e.g. `travel-besty`. It becomes:

| Thing | Value |
|---|---|
| `CUSTOMER` env | `travel-besty` |
| Users database | `authentication-travel-besty` |
| JWT `customer` claim | `travel-besty` |
| Backend `EXPECTED_CUSTOMER` | `travel-besty` |

### 2. Run an auth-service-v2 instance for the customer

Create a `.env` (gitignored) in this repo — or set these vars in the customer's deployment:

```bash
PORT=9081
CUSTOMER=travel-besty
# Same cluster, DB named authentication-<customer>. Mongo creates the DB on first write —
# nothing to pre-provision.
MONGODB_URI=mongodb+srv://admin:<db_password>@dearlavioncluster.xnanadi.mongodb.net/authentication-travel-besty?retryWrites=true&w=majority&appName=DearLavionCluster

# Local dev: no broker / no Google OAuth needed for username+password login.
KAFKA_ENABLED=false
GOOGLE_ENABLED=false
# JWT_SECRET omitted → defaults to the shared key (fine for local; set a per-env secret in prod).
```

Then:

```bash
npm install
npm run start:dev          # or: npm run build && npm run start:prod
curl http://localhost:9081/actuator/health   # {"status":"UP"}
```

> Running **multiple** customers on one host? Give each its own `PORT` and `CUSTOMER`/`MONGODB_URI`.
> Each process is still single-tenant; you just run one per customer.

### 3. Create the first users (the DB starts empty)

A brand-new tenant DB has **no users** — register them against the running instance:

```bash
# a regular user
curl -X POST http://localhost:9081/auth/register \
  -H 'content-type: application/json' \
  -d '{"username":"traveler","email":"traveler@example.com","password":"secret123"}'

# your admin, then promote to an admin role
curl -X POST http://localhost:9081/auth/register \
  -H 'content-type: application/json' \
  -d '{"username":"owner","email":"owner@example.com","password":"secret123"}'

curl -X PATCH http://localhost:9081/auth/user/owner \
  -H 'content-type: application/json' \
  -d '{"activeProfile":"BUSINESS_OWNER"}'
```

Roles that grant admin: **`BUSINESS_OWNER`**, **`STAFF`**. (`WISHER`/`COPILOT` are regular users.)

### 4. Point the customer's backend at this instance

In the backend (e.g. `dearlavion-store-engine`) `.env`:

```bash
AUTH_SERVER_URL=http://localhost:9081     # this customer's auth instance
EXPECTED_CUSTOMER=travel-besty            # must equal the auth instance's CUSTOMER
```

`AuthGuard` verifies every request against `AUTH_SERVER_URL/auth/verify` and rejects any token
whose `customer` ≠ `EXPECTED_CUSTOMER`. Admin routes additionally require a `BUSINESS_OWNER`/`STAFF`
role. (`ADMIN_USERNAMES`, default `admin`, remains only as a bootstrap escape hatch.)

### 5. Point the frontend at both

In the UI (`dearlavion-travel-besty-ui`) `src/environments/environment.dev.ts`:

```ts
export const environment = {
  production: false,
  useMockData: false,
  apiUrl: 'http://localhost:4000',   // the customer's backend
  authUrl: 'http://localhost:9081',  // the customer's auth instance
};
```

Login/registration go to `authUrl`; the issued JWT is attached to `apiUrl` requests automatically.
No per-customer code in the UI — the tenant is entirely server-side.

---

## Verify it end-to-end

```bash
AUTH=http://localhost:9081 ; API=http://localhost:4000

# login → grab the JWT
TOK=$(curl -s -X POST $AUTH/auth/login -H 'content-type: application/json' \
  -d '{"email":"owner@example.com","password":"secret123"}' | npx --yes json token 2>/dev/null \
  || echo "use your own JSON parse")

# the token carries the customer claim
#   payload → { "username":"owner", "customer":"travel-besty", ... }

# verify returns the customer + role
curl -s -X POST $AUTH/auth/verify -H 'content-type: application/json' -d "{\"token\":\"$TOK\"}"
#   {"valid":true,...,"activeProfile":"BUSINESS_OWNER","customer":"travel-besty"}

# admin route accepts this tenant's admin
curl -s -o /dev/null -w '%{http_code}\n' $API/admin/products -H "Authorization: Bearer $TOK"   # 200

# a token from a DIFFERENT customer is rejected (401) by both auth-verify and the backend.
```

---

## Environment variable reference

**auth-service-v2 (per customer instance)**

| Var | Example | Purpose |
|---|---|---|
| `CUSTOMER` | `travel-besty` | The tenant this instance serves. Stamped into JWTs and enforced on verify. Defaults to `dearlavion`. |
| `MONGODB_URI` | `…/authentication-travel-besty?…` | The tenant's user store. Use DB name `authentication-<customer>`. |
| `PORT` | `9081` | HTTP port (`/actuator/health`). |
| `KAFKA_ENABLED` | `false` | Disable user-event publishing when no broker is available. |
| `GOOGLE_ENABLED` | `false` | Disable Google OAuth (username+password still works). |
| `JWT_SECRET` | *(unset)* | Base64 HS256 secret; defaults to the shared key. Set a unique value per environment in prod. |

**consuming backend (e.g. store-engine)**

| Var | Example | Purpose |
|---|---|---|
| `AUTH_SERVER_URL` | `http://localhost:9081` | This customer's auth instance. |
| `EXPECTED_CUSTOMER` | `travel-besty` | Reject tokens whose `customer` claim differs. Leave empty to disable the check. |
| `ADMIN_USERNAMES` | `admin` | Bootstrap admin escape hatch (role is the primary admin signal). |

---

## Notes & gotchas

- **DB creation is automatic** — MongoDB creates `authentication-<customer>` on the first
  `register`. There's nothing to pre-create.
- **Fresh tenants start empty.** Users are not shared between customers by design; register each
  customer's users separately.
- **`EXPECTED_CUSTOMER` must match `CUSTOMER`** exactly, or every request 401s.
- **Legacy tokens** (no `customer` claim) are allowed through `/auth/verify` only if the username
  also exists in this tenant's DB — so they can't cross tenants in practice.
- **Production**: give each customer instance a **unique `JWT_SECRET`** so tokens can't even be
  cryptographically forged across tenants, on top of the claim check.
