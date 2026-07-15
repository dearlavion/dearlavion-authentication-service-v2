import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';
import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AppConfig } from '../config/configuration';

export const AUTH_EVENT_PUBLISHER = 'AUTH_EVENT_PUBLISHER';
export const AUTH_TOPIC = 'authentication-service-event';

/** Event types match the Java v1 EventType so notification-service consumes v2 events unchanged. */
export enum AuthEventType {
  RESET_PASSWORD = 'RESET_PASSWORD',
  NEW_USER = 'NEW_USER',
}

export interface AuthEventPublisher {
  publish(type: AuthEventType, payload: unknown): Promise<void>;
}

class NoopAuthEventPublisher implements AuthEventPublisher {
  async publish(): Promise<void> {
    /* no-op */
  }
}

/** kafkajs publisher — sends the { type, payload } envelope to authentication-service-event. */
class KafkaAuthEventPublisher implements AuthEventPublisher, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaAuthEventPublisher.name);
  private readonly producer: Producer;
  private connected = false;

  constructor(brokers: string[], clientId: string) {
    this.producer = new Kafka({ clientId, brokers }).producer();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.producer.connect();
      this.connected = true;
    } catch (e) {
      this.logger.error(`Kafka producer failed to connect: ${(e as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.connected) await this.producer.disconnect().catch(() => undefined);
  }

  async publish(type: AuthEventType, payload: unknown): Promise<void> {
    try {
      await this.producer.send({
        topic: AUTH_TOPIC,
        messages: [{ value: JSON.stringify({ type, payload }) }],
      });
    } catch (e) {
      this.logger.error(`Failed to publish ${type}: ${(e as Error).message}`);
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: AUTH_EVENT_PUBLISHER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>): AuthEventPublisher => {
        const kafka = config.get('kafka', { infer: true });
        if (!kafka.enabled) {
          new Logger('KafkaModule').log('KAFKA_ENABLED=false — auth events will not be published');
          return new NoopAuthEventPublisher();
        }
        return new KafkaAuthEventPublisher(kafka.brokers, kafka.clientId);
      },
    },
  ],
  exports: [AUTH_EVENT_PUBLISHER],
})
export class KafkaModule {}
