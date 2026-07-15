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
  const creds = { username: 'alice', email: 'alice@example.com', password: 'Secret123!' };

  it('register -> login -> verify round-trip', async () => {
    // register
    const reg = await http().post('/auth/register').send(creds).expect(201);
    expect(reg.body).toEqual({ message: 'User registered successfully', user: 'alice' });
    expect(events.some((e) => e.type === AuthEventType.NEW_USER)).toBe(true);

    // login
    const login = await http().post('/auth/login').send({ username: 'alice', password: 'Secret123!' }).expect(201);
    expect(login.body.token).toBeDefined();
    expect(login.body.user.username).toBe('alice');
    expect(login.body.user.password).toBeUndefined(); // never leak the hash

    // verify the issued token
    const verify = await http().post('/auth/verify').send({ token: login.body.token }).expect(201);
    expect(verify.body.valid).toBe(true);
    expect(verify.body.username).toBe('alice');
    expect(verify.body.email).toBe('alice@example.com');
    expect(verify.body.userId).toBeDefined();
  });

  it('login with wrong password -> 401', async () => {
    await http().post('/auth/login').send({ username: 'alice', password: 'wrong' }).expect(401);
  });

  it('duplicate registration -> 409', async () => {
    await http().post('/auth/register').send(creds).expect(409);
  });

  it('verify with missing token -> 400, garbage -> 401', async () => {
    await http().post('/auth/verify').send({}).expect(400);
    await http().post('/auth/verify').send({ token: 'garbage' }).expect(401);
  });

  it('get + update user', async () => {
    const get1 = await http().get('/auth/user/alice').expect(200);
    expect(get1.body.email).toBe('alice@example.com');
    expect(get1.body.password).toBeUndefined();

    await http().patch('/auth/user/alice').send({ firstname: 'Alice', phone: '+1555' }).expect(200);
    const get2 = await http().get('/auth/user/alice').expect(200);
    expect(get2.body.firstname).toBe('Alice');
    expect(get2.body.phone).toBe('+1555');

    await http().get('/auth/user/ghost').expect(404);
  });

  it('forgot-password emits a reset event; reset-password with that token works', async () => {
    events.length = 0;
    await http().post('/auth/forgot-password').query({ email: 'alice@example.com' }).expect(201);
    const evt = events.find((e) => e.type === AuthEventType.RESET_PASSWORD);
    expect(evt).toBeDefined();
    const token = (evt!.payload as { token: string }).token;

    await http().post('/auth/reset-password').send({ token, newPassword: 'NewPass456!' }).expect(201);
    // old password no longer works, new one does
    await http().post('/auth/login').send({ username: 'alice', password: 'Secret123!' }).expect(401);
    await http().post('/auth/login').send({ username: 'alice', password: 'NewPass456!' }).expect(201);
  });

  it('forgot-password for unknown email still 200 (no account enumeration) and emits nothing', async () => {
    events.length = 0;
    await http().post('/auth/forgot-password').query({ email: 'nobody@example.com' }).expect(201);
    expect(events).toHaveLength(0);
  });

  it('reset-password with an invalid token -> 400', async () => {
    await http().post('/auth/reset-password').send({ token: 'bad', newPassword: 'x' }).expect(400);
  });
});
