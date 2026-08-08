import { Body, Controller, Get, Put } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsInt, IsString, Min } from 'class-validator';
import { ErpStubStock } from './erp-stub-stock.entity';

export class UpsertStubStockDto {
  @IsString() sku: string;
  @IsInt() @Min(0) qty: number;
}

/** Admin-console helper: stage ERP stock scenarios. */
@Controller('erp-stub/stock')
export class ErpStubStockController {
  constructor(
    @InjectRepository(ErpStubStock) private readonly repo: Repository<ErpStubStock>,
  ) {}

  @Get()
  async list() {
    const items = await this.repo.find({ order: { sku: 'ASC' } });
    return { items, total: items.length, page: 1, pageSize: items.length };
  }

  @Put()
  async upsert(@Body() dto: UpsertStubStockDto) {
    const existing = await this.repo.findOne({ where: { sku: dto.sku } });
    return this.repo.save(existing ? { ...existing, qty: dto.qty } : this.repo.create(dto));
  }
}
