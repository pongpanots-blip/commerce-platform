import { ArgumentMetadata, Injectable, ParseArrayPipe, PipeTransform, Type } from '@nestjs/common';

/**
 * Accept a single object or an array; always hand the handler an array.
 * The ERP spec says qty/moq/price POST an array, but it really sends a bare
 * object per SKU — copied from josh's pipe of the same name for that reason.
 * Each item is still validated, so a malformed item is a 400.
 */
@Injectable()
export class SingleOrArrayPipe<T> implements PipeTransform {
  private readonly inner: ParseArrayPipe;

  constructor(items: Type<T>) {
    this.inner = new ParseArrayPipe({ items });
  }

  transform(value: unknown, metadata: ArgumentMetadata): Promise<T[]> {
    return this.inner.transform(Array.isArray(value) ? value : [value], metadata);
  }
}
