import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './shared-kernel/presentation/all-exceptions.filter';
import { validateEnv } from './config/env.validation';
import { StorefrontModule } from './storefront/storefront.module';
import { PortalModule } from './portal/portal.module';

async function bootstrap() {
  validateEnv(process.env);

  const app = await NestFactory.create(AppModule, { rawBody: true });
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

  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();
