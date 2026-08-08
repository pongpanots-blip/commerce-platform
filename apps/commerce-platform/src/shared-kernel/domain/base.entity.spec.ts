import { getMetadataArgsStorage } from 'typeorm';
import { BaseEntity } from './base.entity';

describe('BaseEntity', () => {
  it('declares a generated uuid primary key', () => {
    const gen = getMetadataArgsStorage().generations.find(
      (g) => g.target === BaseEntity && g.propertyName === 'id',
    );
    expect(gen?.strategy).toBe('uuid');
  });

  it('declares timestamp + organization + soft-delete columns', () => {
    const cols = getMetadataArgsStorage()
      .filterColumns(BaseEntity)
      .map((c) => c.propertyName);
    expect(cols).toEqual(
      expect.arrayContaining(['organizationId', 'createdAt', 'updatedAt', 'deletedAt']),
    );
  });
});
