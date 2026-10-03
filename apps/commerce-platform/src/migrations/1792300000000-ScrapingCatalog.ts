import { MigrationInterface, QueryRunner, Table, TableIndex, TableUnique, TableForeignKey } from 'typeorm';

export class ScrapingCatalog1792300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'scraping_sources',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
          { name: 'name', type: 'varchar', length: '100' },
          { name: 'origin', type: 'varchar', length: '500' },
          { name: 'config', type: 'jsonb' },
          { name: 'revision', type: 'int', default: 1 },
          { name: 'enabled', type: 'boolean', default: false },
          { name: 'status', type: 'varchar', length: '20', default: "'idle'" },
          { name: 'progress', type: 'jsonb', default: "'{\"pending\":[],\"visited\":[],\"successful\":0,\"failed\":0,\"items\":0}'::jsonb" },
          { name: 'lease_until', type: 'timestamptz', isNullable: true },
          { name: 'last_error', type: 'varchar', length: '500', isNullable: true },
          { name: 'last_run_at', type: 'timestamptz', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
    );

    await queryRunner.createUniqueConstraint(
      'scraping_sources',
      new TableUnique({ columnNames: ['origin'], name: 'uq_scraping_source_origin' }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'scraped_items',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
          { name: 'source_id', type: 'uuid' },
          { name: 'url', type: 'varchar', length: '2000' },
          { name: 'page_url', type: 'varchar', length: '2000' },
          { name: 'name', type: 'varchar', length: '500' },
          { name: 'sku', type: 'varchar', length: '100', default: "''" },
          { name: 'fields', type: 'jsonb' },
          { name: 'price_inc_vat', type: 'numeric', precision: 12, scale: 2, isNullable: true },
          { name: 'weight_kg', type: 'numeric', precision: 12, scale: 4, isNullable: true },
          { name: 'currency', type: 'varchar', length: '3' },
          { name: 'config_version', type: 'varchar', length: '64' },
          { name: 'observed_at', type: 'timestamptz' },
          { name: 'updated_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
    );

    await queryRunner.createUniqueConstraint(
      'scraped_items',
      new TableUnique({ columnNames: ['source_id', 'url'], name: 'uq_scraped_item_source_url' }),
    );

    await queryRunner.createIndex(
      'scraped_items',
      new TableIndex({ columnNames: ['source_id', 'observed_at'], name: 'ix_scraped_item_source_observed' }),
    );

    await queryRunner.createForeignKey(
      'scraped_items',
      new TableForeignKey({
        columnNames: ['source_id'],
        referencedTableName: 'scraping_sources',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('scraped_items', true);
    await queryRunner.dropTable('scraping_sources', true);
  }
}
