import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { AppModule } from '../app.module';
import { AUTH_EVENT_PUBLISHER, AuthEventType } from '../kafka/kafka.module';

/**
 * Full auth flows through the real NestJS stack against an in-process MongoDB.
 * Kafka is captured (no broker); Google is not exercised (needs live tokens).
 */
describe('Auth API (e2e)', () => {
  let mongo: MongoMemoryServer;
  let app: INestApplication;
  const events: { type: AuthEventType; payload: unknown }[] = [];

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongo.getUri();
    process.env.KAFKA_ENABLED = 'false';
    process.env.GOOGLE_ENABLED = 'true';
    process.env.CUSTOMERS = 'travel-besty,acme';
    process.env.PROVISION_SECRET = 'test-secret';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_EVENT_PUBLISHER)
      .useValue({ publish: async (type: AuthEventType, payload: unknown) => { events.push({ type, payload }); } })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  const http = () => request(app.getHttpServer());
  const CUST = 'travel-besty';
  const creds = { username: 'alice', email: 'alice@example.com', password: 'Secret123!' };

  it('register -> login -> verify round-trip', async () => {
    // register
    const reg = await http().post('/auth/register').set('X-Customer', CUST).send(creds).expect(201);
    expect(reg.body).toEqual({ message: 'User registered successfully', user: 'alice' });
    expect(events.some((e) => e.type === AuthEventType.NEW_USER)).toBe(true);

    // login
    const login = await http()
      .post('/auth/login')
      .set('X-Customer', CUST)
      .send({ username: 'alice', password: 'Secret123!' })
      .expect(201);
    expect(login.body.token).toBeDefined();
    expect(login.body.user.username).toBe('alice');
    expect(login.body.user.customer).toBe(CUST);
    expect(login.body.user.password).toBeUndefined(); // never leak the hash

    // verify the issued token (customer comes from the token claim — no header needed)
    const verify = await http().post('/auth/verify').send({ token: login.body.token }).expect(201);
    expect(verify.body.valid).toBe(true);
    expect(verify.body.username).toBe('alice');
    expect(verify.body.email).toBe('alice@example.com');
    expect(verify.body.userId).toBeDefined();
    expect(verify.body.customer).toBe(CUST);
  });

  it('login with wrong password -> 401', async () => {
    await http().post('/auth/login').set('X-Customer', CUST).send({ username: 'alice', password: 'wrong' }).expect(401);
  });

  it('duplicate registration -> 409', async () => {
    await http().post('/auth/register').set('X-Customer', CUST).send(creds).expect(409);
  });

  it('missing X-Customer -> 400; unknown customer -> 400', async () => {
    await http().post('/auth/login').send({ username: 'alice', password: 'Secret123!' }).expect(400);
    await http().post('/auth/login').set('X-Customer', 'nope').send({ username: 'alice', password: 'x' }).expect(400);
  });

  it('verify with missing token -> 400, garbage -> 401', async () => {
    await http().post('/auth/verify').send({}).expect(400);
    await http().post('/auth/verify').send({ token: 'garbage' }).expect(401);
  });

  it('get + update user', async () => {
    const get1 = await http().get('/auth/user/alice').set('X-Customer', CUST).expect(200);
    expect(get1.body.email).toBe('alice@example.com');
    expect(get1.body.password).toBeUndefined();

    await http().patch('/auth/user/alice').set('X-Customer', CUST).send({ firstname: 'Alice', phone: '+1555' }).expect(200);
    const get2 = await http().get('/auth/user/alice').set('X-Customer', CUST).expect(200);
    expect(get2.body.firstname).toBe('Alice');
    expect(get2.body.phone).toBe('+1555');

    await http().get('/auth/user/ghost').set('X-Customer', CUST).expect(404);
  });

  it('forgot-password emits a reset event; reset-password with that token works', async () => {
    events.length = 0;
    await http().post('/auth/forgot-password').set('X-Customer', CUST).query({ email: 'alice@example.com' }).expect(201);
    const evt = events.find((e) => e.type === AuthEventType.RESET_PASSWORD);
    expect(evt).toBeDefined();
    const token = (evt!.payload as { token: string }).token;

    // reset-password derives the tenant from the token claim — no header
    await http().post('/auth/reset-password').send({ token, newPassword: 'NewPass456!' }).expect(201);
    // old password no longer works, new one does
    await http().post('/auth/login').set('X-Customer', CUST).send({ username: 'alice', password: 'Secret123!' }).expect(401);
    await http().post('/auth/login').set('X-Customer', CUST).send({ username: 'alice', password: 'NewPass456!' }).expect(201);
  });

  it('forgot-password for unknown email still 200 (no account enumeration) and emits nothing', async () => {
    events.length = 0;
    await http().post('/auth/forgot-password').set('X-Customer', CUST).query({ email: 'nobody@example.com' }).expect(201);
    expect(events).toHaveLength(0);
  });

  it('reset-password with an invalid token -> 400', async () => {
    await http().post('/auth/reset-password').send({ token: 'bad', newPassword: 'x' }).expect(400);
  });

  it('tenants are isolated: the same email in two customers, tokens stay in their own tenant', async () => {
    const bob = { username: 'bob', email: 'bob@example.com', password: 'Secret123!' };
    // Same username+email registers cleanly under each customer (separate DBs, separate indexes).
    await http().post('/auth/register').set('X-Customer', 'travel-besty').send(bob).expect(201);
    await http().post('/auth/register').set('X-Customer', 'acme').send(bob).expect(201);

    const tb = await http().post('/auth/login').set('X-Customer', 'travel-besty').send({ email: bob.email, password: bob.password }).expect(201);
    const acme = await http().post('/auth/login').set('X-Customer', 'acme').send({ email: bob.email, password: bob.password }).expect(201);
    expect(tb.body.user.customer).toBe('travel-besty');
    expect(acme.body.user.customer).toBe('acme');
    expect(tb.body.token).not.toBe(acme.body.token);

    // Each token verifies to its own tenant.
    const vtb = await http().post('/auth/verify').send({ token: tb.body.token }).expect(201);
    expect(vtb.body.customer).toBe('travel-besty');
    const vacme = await http().post('/auth/verify').send({ token: acme.body.token }).expect(201);
    expect(vacme.body.customer).toBe('acme');

    // A user registered only under travel-besty does not exist under acme.
    await http().get('/auth/user/alice').set('X-Customer', 'acme').expect(404);
  });

  it('privileged role at register/patch requires the provisioning secret', async () => {
    // register asking for ADMIN without the secret -> forced SIMPLE
    await http()
      .post('/auth/register')
      .set('X-Customer', CUST)
      .send({ username: 'wannabe', email: 'wannabe@example.com', password: 'Secret123!', activeProfile: 'ADMIN' })
      .expect(201);
    expect((await http().get('/auth/user/wannabe').set('X-Customer', CUST)).body.activeProfile).toBe('SIMPLE');

    // register with the secret -> ADMIN honored
    await http()
      .post('/auth/register')
      .set('X-Customer', CUST)
      .set('X-Provision-Secret', 'test-secret')
      .send({ username: 'realadmin', email: 'realadmin@example.com', password: 'Secret123!', activeProfile: 'ADMIN' })
      .expect(201);
    expect((await http().get('/auth/user/realadmin').set('X-Customer', CUST)).body.activeProfile).toBe('ADMIN');

    // PATCH role change without the secret is ignored...
    await http().patch('/auth/user/wannabe').set('X-Customer', CUST).send({ activeProfile: 'ADMIN' }).expect(200);
    expect((await http().get('/auth/user/wannabe').set('X-Customer', CUST)).body.activeProfile).toBe('SIMPLE');

    // ...but works with the secret.
    await http()
      .patch('/auth/user/wannabe')
      .set('X-Customer', CUST)
      .set('X-Provision-Secret', 'test-secret')
      .send({ activeProfile: 'STAFF' })
      .expect(200);
    expect((await http().get('/auth/user/wannabe').set('X-Customer', CUST)).body.activeProfile).toBe('STAFF');
  });
});
