import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './shared-kernel/presentation/all-exceptions.filter';
import { validateEnv } from './config/env.validation';
import { StorefrontModule } from './storefront/storefront.module';
import { PortalModule } from './portal/portal.module';
import { mountMcp } from './mcp/mcp.http';
import { TaskAwareLogger } from './shared-kernel/infrastructure/scheduled-task';

async function bootstrap() {
  validateEnv(process.env);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // Marks a scheduled-task run as a problem when the job logs a warn/error (most jobs catch and log instead of throwing).
  app.useLogger(new TaskAwareLogger());
  // Product / coupon images go to josh as base64 through /api/josh/admin-call (3.5 MB of files per call).
  app.useBodyParser('json', { limit: '6mb' });
  // COMMERCE_CORS_ORIGINS is a comma-separated allowlist (no spaces), e.g.
  // "http://localhost:4403,http://localhost:4404" — add :4404 (commerce-portal
  // dev server) alongside :4403 (commerce-admin) when running the portal UI locally.
  app.enableCors({
    origin: (process.env.COMMERCE_CORS_ORIGINS ?? 'http://localhost:4403,http://localhost:4404').split(','),
  });
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // Public API contract only: storefront (X-Api-Key) + developer portal (Bearer JWT).
  // Admin/internal modules are deliberately excluded from `include` below.
  const docConfig = new DocumentBuilder()
    .setTitle('Commerce Platform API')
    .setDescription('Public v1 contract: storefront (X-Api-Key) + developer portal (Bearer JWT)')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'X-Api-Key', in: 'header' }, 'apiKey')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, docConfig, {
    include: [StorefrontModule, PortalModule], // admin/internal endpoints excluded
  });
  SwaggerModule.setup('api/docs', app, document);

  mountMcp(app); // AI connectors (MCP + OAuth) at the origin root, outside /api

  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();
