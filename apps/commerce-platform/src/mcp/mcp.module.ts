import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../modules/core/auth/auth.module';
import { User } from '../modules/core/user/infrastructure/user.entity';
import { CompetitorPricesModule } from '../modules/integration/competitor-prices/competitor-prices.module';
import { ScrapingModule } from '../modules/platform/scraping/scraping.module';
import { MarketingResearchModule } from '../modules/platform/marketing-research/marketing-research.module';
import { WebhookSubscriptionModule } from '../modules/integration/webhook-subscription/webhook-subscription.module';
import { IntegrationModule } from '../modules/integration/integration.module';
import { McpOAuthClient, McpOAuthGrant } from './mcp-oauth.entity';
import { McpOAuthProvider } from './mcp-oauth.provider';
import { McpTools } from './mcp.tools';
import { McpConnectionsController } from './mcp-connections.controller';

/** MCP server for AI connectors. HTTP routes are mounted in main.ts by mountMcp (they live outside /api). */
@Module({
  imports: [
    TypeOrmModule.forFeature([McpOAuthClient, McpOAuthGrant, User]),
    AuthModule, CompetitorPricesModule, ScrapingModule, MarketingResearchModule, WebhookSubscriptionModule, IntegrationModule,
  ],
  controllers: [McpConnectionsController],
  providers: [McpOAuthProvider, McpTools],
})
export class McpModule {}
