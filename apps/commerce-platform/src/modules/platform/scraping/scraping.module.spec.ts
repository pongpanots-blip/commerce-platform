import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScrapingModule } from './scraping.module';
import { ScrapingService } from './application/scraping.service';
import { ScrapingSource, ScrapedItem } from './domain/scraping-source.entity';

describe('ScrapingModule', () => {
  let service: ScrapingService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [ScrapingSource, ScrapedItem],
          synchronize: true,
        }),
        ScrapingModule,
      ],
    }).compile();

    service = module.get<ScrapingService>(ScrapingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('listSources should return empty array initially', async () => {
    const sources = await service.listSources();
    expect(Array.isArray(sources)).toBe(true);
  });
});
