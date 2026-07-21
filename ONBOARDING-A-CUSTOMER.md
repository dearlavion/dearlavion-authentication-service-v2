# Onboarding a new customer (tenant)

This service is **multi-tenant**: **one running instance serves many customers**. Each customer has
its own isolated user store (`authentication-<customer>` DB), and its JWTs carry a `customer` claim
so a token minted for one customer is **rejected** everywhere else.

The customer is chosen **per request**:
- **credential endpoints** (`register`, `login`, `forgot-password`, `GET/PATCH /user/:username`) read
  it from the **`X-Customer` header**;
- **`verify`** and **`reset-password`** read it from the **token's `customer` claim** (no header).

Adding a customer is **config, not a new deployment**: add the slug to the `CUSTOMERS` allowlist and
restart. No new port, no new instance.

> Worked example: customer **`travel-besty`**, backed by **`dearlavion-store-engine`** and the
> **`dearlavion-travel-besty-ui`** frontend.

---

## How isolation works (the model)

```
  UI (X-Customer: travel-besty)  ─▶  ┌────────────────────────────────────────┐
   POST /auth/login                  │  auth-service-v2  (ONE instance)        │
                                     │  CUSTOMERS=travel-besty,acme            │
                                     │  header/claim → useDb(authentication-X) │
                                     │  JWT: { username, sub, customer, ... }  │
                                     └────────────────────────────────────────┘
                                          ▲            issues JWT
        Bearer <jwt>                      │ POST /auth/verify   (tenant from the token claim)
            │                             │  → { valid, ..., activeProfile, customer }
            ▼                             │
   ┌──────────────────────────────────────────┐
   │  backend (e.g. store-engine)              │
   │  EXPECTED_CUSTOMER=travel-besty           │
   │  AuthGuard → /auth/verify, then rejects   │
   │  any token whose customer ≠ EXPECTED      │
   └──────────────────────────────────────────┘
```

- One instance, one connection pool. `connection.useDb('authentication-<customer>')` routes each
  request to that customer's DB — no pool-per-tenant.
- The **`CUSTOMERS` allowlist** rejects unknown/typo slugs (→ 400) so nobody can spawn arbitrary DBs.
- **Admin** is by role: a user's `activeProfile` must be `ADMIN` or `STAFF`. Assigning those roles is
  gated by the `X-Provision-Secret` header (matching the `PROVISION_SECRET` env).

---

## Steps

### 1. Pick a customer id

A short, URL-safe slug — e.g. `travel-besty`. It becomes:

| Thing | Value |
|---|---|
| Entry in `CUSTOMERS` | `travel-besty` |
| Users database | `authentication-travel-besty` |
| `X-Customer` header on auth calls | `travel-besty` |
| JWT `customer` claim | `travel-besty` |
| Backend `EXPECTED_CUSTOMER` | `travel-besty` |

### 2. Add the customer to the auth instance

Append the slug to `CUSTOMERS` (comma-separated) and restart the **existing** instance — no new
process:

```bash
# .env
CUSTOMERS=travel-besty,acme,globex

# One-time per instance: set a strong provisioning secret so you can create admins (below).
# You generate this — the service never issues it. e.g. `openssl rand -hex 32`.
PROVISION_SECRET=<paste a strong random value>
```

That's the whole server-side change. The DB `authentication-<customer>` is created automatically on
the first `register` (nothing to pre-provision), and its unique username/email indexes are built the
first time the tenant is touched.

### 3. Create the first users (the DB starts empty)

Register against the running instance, **passing `X-Customer`**:

```bash
# a regular user
curl -X POST http://localhost:9081/auth/register \
  -H 'content-type: application/json' -H 'X-Customer: travel-besty' \
  -d '{"username":"traveler","email":"traveler@example.com","password":"secret123"}'

# an admin — pass activeProfile + the provisioning secret (one call, no separate promote)
curl -X POST http://localhost:9081/auth/register \
  -H 'content-type: application/json' -H 'X-Customer: travel-besty' \
  -H 'X-Provision-Secret: <PROVISION_SECRET>' \
  -d '{"username":"owner","email":"owner@example.com","password":"secret123","activeProfile":"ADMIN"}'
```

Roles that grant admin: **`ADMIN`**, **`STAFF`**. `SIMPLE` is a regular user (the default). Assigning
`ADMIN`/`STAFF` requires the `X-Provision-Secret` header — without it the user is created/kept `SIMPLE`.
The same username/email may exist under a **different** customer — the tenants are fully separate.

### 4. Point the customer's backend at the shared instance

In the backend (e.g. `dearlavion-store-engine`) `.env`:

```bash
AUTH_SERVER_URL=http://localhost:9081     # the shared auth instance (same for every customer)
EXPECTED_CUSTOMER=travel-besty            # this backend only accepts travel-besty tokens
```

`AuthGuard` verifies each request against `/auth/verify` (which resolves the tenant from the token
claim) and rejects any token whose `customer` ≠ `EXPECTED_CUSTOMER`. Admin routes additionally
require an `ADMIN`/`STAFF` role.

### 5. Point the frontend at both, and tell it its tenant

In the UI (`dearlavion-travel-besty-ui`) `src/environments/environment.dev.ts`:

```ts
export const environment = {
  production: false,
  useMockData: false,
  apiUrl: 'http://localhost:4000',   // the customer's backend
  authUrl: 'http://localhost:9081',  // the shared auth instance
  customer: 'travel-besty',          // sent as X-Customer on every auth call
};
```

`AuthService` attaches `X-Customer: <customer>` to `login()`/`register()`. No other UI change.

---

## Verify it end-to-end

```bash
AUTH=http://localhost:9081 ; API=http://localhost:4000

# login WITH the header → JWT carries { customer: "travel-besty" }
TOK=$(curl -s -X POST $AUTH/auth/login -H 'content-type: application/json' \
  -H 'X-Customer: travel-besty' -d '{"email":"owner@example.com","password":"secret123"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).token))")

# verify needs NO header — the tenant comes from the token
curl -s -X POST $AUTH/auth/verify -H 'content-type: application/json' -d "{\"token\":\"$TOK\"}"
#   {"valid":true,...,"activeProfile":"ADMIN","customer":"travel-besty"}

curl -s -o /dev/null -w '%{http_code}\n' $API/admin/products -H "Authorization: Bearer $TOK"   # 200

# guardrails
curl -s -o /dev/null -w '%{http_code}\n' -X POST $AUTH/auth/login \
  -d '{"username":"x","password":"y"}'                                    # 400 (missing X-Customer)
curl -s -o /dev/null -w '%{http_code}\n' -X POST $AUTH/auth/login \
  -H 'X-Customer: unknown' -d '{"username":"x","password":"y"}'           # 400 (not in CUSTOMERS)
# a token from a DIFFERENT customer → verify + backend both 401
```

---

## Environment variable reference

**auth-service-v2 (one shared instance)**

| Var | Example | Purpose |
|---|---|---|
| `CUSTOMERS` | `travel-besty,acme` | Allowlist of tenants this instance serves. Unknown `X-Customer` → 400. Falls back to the legacy single `CUSTOMER` if unset. |
| `PROVISION_SECRET` | *(unset)* | Required via `X-Provision-Secret` to assign `ADMIN`/`STAFF` at register/patch. Unset ⇒ privileged roles can't be set via the API. |
| `MONGODB_URI` | `…/authentication?…` | Base connection to the cluster. Every query is routed to `authentication-<customer>` via `useDb()`, so the DB in this URI is just the base default. |
| `PORT` | `9081` | HTTP port (`/actuator/health`). |
| `KAFKA_ENABLED` / `GOOGLE_ENABLED` | `false` | Disable broker / Google OAuth for local dev. |
| `JWT_SECRET` | *(unset)* | Base64 HS256 secret; defaults to the shared key. |

**consuming backend (per customer)**

| Var | Example | Purpose |
|---|---|---|
| `AUTH_SERVER_URL` | `http://localhost:9081` | The shared auth instance (same value for every customer). |
| `EXPECTED_CUSTOMER` | `travel-besty` | Reject tokens whose `customer` claim differs. Empty disables the check. |
| `ADMIN_USERNAMES` | `admin` | Bootstrap admin escape hatch (role is the primary admin signal). |

**frontend (per customer)**

| Var | Example | Purpose |
|---|---|---|
| `customer` | `travel-besty` | Sent as `X-Customer` on auth calls. |

---

## Notes & gotchas

- **DB creation is automatic** — `authentication-<customer>` is created on the first `register`.
- **Fresh tenants start empty** — users are never shared across customers by design.
- **`EXPECTED_CUSTOMER` must match** the `X-Customer` a UI sends, or that UI's tokens 401 downstream.
- **`PROVISION_SECRET` is operator-generated** (`openssl rand -hex 32`), one per instance — the
  service never issues it. It's a shared operator credential (not per user/tenant): keep it out of
  the frontend/git/logs, source it from your secrets manager in prod, and rotate it if it leaks.
- **Same secret signs all tenants** — isolation rests on the `customer` claim + allowlist, not
  crypto. A per-customer secret map is a later hardening (easy once a `customers` collection exists).
- **Scaling past a handful of customers?** Move the allowlist from `CUSTOMERS` env to a `customers`
  collection for self-serve onboarding (no redeploy) + per-customer settings.
