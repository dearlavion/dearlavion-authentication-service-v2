/**
 * Typed configuration (see .env.example). Mirrors the Java v1 keys. The JWT secret is base64 and
 * defaults to the exact key baked into the Java JwtService, so v1- and v2-issued tokens interoperate.
 */
export interface AppConfig {
  port: number;
  mongoUri: string;
  jwt: {
    secretBase64: string;
    expiresIn: string;
    resetExpiresIn: string;
  };
  kafka: {
    enabled: boolean;
    brokers: string[];
    clientId: string;
  };
  google: {
    enabled: boolean;
    clientId: string;
  };
}

const V1_JWT_KEY = '5B6F7D3E2A9C4B8E0A1F6D9B3E7A2C9D4F8E5B6C3A7B1D6F4C9A3E8D2B5F7A1';

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '9081', 10),
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/authentication-service',
  jwt: {
    secretBase64: process.env.JWT_SECRET ?? V1_JWT_KEY,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '24h',
    resetExpiresIn: process.env.JWT_RESET_EXPIRES_IN ?? '15m',
  },
  kafka: {
    enabled: (process.env.KAFKA_ENABLED ?? 'true').toLowerCase() === 'true',
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:29092').split(',').map((b) => b.trim()).filter(Boolean),
    clientId: process.env.KAFKA_CLIENT_ID ?? 'dearlavion-authentication-service-v2',
  },
  google: {
    enabled: (process.env.GOOGLE_ENABLED ?? 'true').toLowerCase() === 'true',
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
  },
});
