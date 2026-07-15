import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
  );

  app.enableCors({
    origin: [
      'http://dearlavion.site',
      'https://dearlavion.site',
      'https://www.dearlavion.site',
      /\.ngrok\.pizza$/,
      'http://localhost:4200',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    credentials: true,
  });

  const swagger = new DocumentBuilder()
    .setTitle('Dearlavion Authentication Service v2')
    .setDescription('NestJS port of the authentication service')
    .setVersion('1.0.0')
    .build();
  SwaggerModule.setup('swagger-ui', app, SwaggerModule.createDocument(app, swagger));

  const config = app.get(ConfigService<AppConfig, true>);
  const port = config.get('port', { infer: true });
  await app.listen(port);
  new Logger('Bootstrap').log(`Authentication service v2 listening on :${port}`);
}

bootstrap();
