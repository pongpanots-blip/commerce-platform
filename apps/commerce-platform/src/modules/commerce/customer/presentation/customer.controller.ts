import { Body, Controller, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { BaseCrudController } from '../../../../shared-kernel/presentation/base-crud.controller';
import { Customer } from '../infrastructure/customer.entity';
import { CustomerService } from '../application/customer.service';
import { CreateCustomerDto } from '../application/dto/create-customer.dto';
import { UpdateCustomerDto } from '../application/dto/update-customer.dto';

@Controller('customers')
export class CustomerController extends BaseCrudController<Customer>() {
  constructor(protected readonly service: CustomerService) {
    super();
  }

  @Post()
  override create(@Body() dto: CreateCustomerDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  override update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.service.update(id, dto);
  }
}
