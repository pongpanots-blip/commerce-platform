import {
  Body,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { BaseCrudService } from '../application/base-crud.service';
import { ListQueryDto } from '../application/pagination.dto';

/**
 * Factory producing a base REST controller bound to a {@link BaseCrudService}.
 * Concrete controllers extend the returned class, decorate it with
 * `@Controller('resource')`, and inject the concrete service into `service`.
 *
 *   @Controller('customers')
 *   export class CustomerController extends BaseCrudController<CustomerEntity>() {
 *     constructor(protected readonly service: CustomerService) { super(); }
 *   }
 */
export function BaseCrudController<T extends { id: string }>() {
  class BaseController {
    protected service!: BaseCrudService<T>;

    @Get()
    list(@Query() query: ListQueryDto) {
      return this.service.list(query);
    }

    @Get(':id')
    get(@Param('id', ParseUUIDPipe) id: string) {
      return this.service.findOne(id);
    }

    @Post()
    create(@Body() dto: Partial<T>) {
      return this.service.create(dto);
    }

    @Patch(':id')
    update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: Partial<T>) {
      return this.service.update(id, dto);
    }

    @Delete(':id')
    remove(@Param('id', ParseUUIDPipe) id: string) {
      return this.service.remove(id);
    }
  }

  return BaseController;
}
