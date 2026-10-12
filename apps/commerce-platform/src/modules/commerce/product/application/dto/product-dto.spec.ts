import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateProductDto } from './update-product.dto';
import { UpdateCustomerDto } from '../../../customer/application/dto/update-customer.dto';

const errors = (cls: new () => object, body: object) =>
  validateSync(plainToInstance(cls, body)).map((e) => e.property);

describe('product / customer DTOs reject blank names', () => {
  it.each(['', '   '])('product name %j is rejected', (name) => {
    expect(errors(UpdateProductDto, { name })).toEqual(['name']);
  });

  it('product sku "" is rejected', () => {
    expect(errors(UpdateProductDto, { sku: '' })).toEqual(['sku']);
  });

  it('a partial product update without name still passes', () => {
    expect(errors(UpdateProductDto, { description: 'x' })).toEqual([]);
  });

  it('customer name " " is rejected', () => {
    expect(errors(UpdateCustomerDto, { name: ' ' })).toEqual(['name']);
  });
});
