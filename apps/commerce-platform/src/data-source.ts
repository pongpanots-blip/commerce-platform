/**
 * Standalone TypeORM DataSource used exclusively by the `typeorm` CLI for the
 * Commerce Platform. Its own migration ledger, separate from `apps/backend`.
 *
 * Usage (from repo root):
 *   npm run cp:migration:run      → apply pending migrations
 *   npm run cp:migration:revert   → rollback last migration
 *   npm run cp:migration:show     → show pending / applied status
 *   npm run cp:migration:generate -- apps/commerce-platform/src/migrations/MyMigration
 *
 * NOTE: Do NOT import this into NestJS modules. The app uses
 *       TypeOrmModule.forRootAsync() in app.module.ts with the same
 *       buildDataSourceOptions() factory.
 */
import 'reflect-metadata';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './config/typeorm.config';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const AppDataSource = new DataSource(buildDataSourceOptions(process.env));
