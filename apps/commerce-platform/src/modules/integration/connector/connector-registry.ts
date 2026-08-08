import { Injectable, NotFoundException } from '@nestjs/common';
import { CommerceAdapter } from '../adapter/domain/commerce-adapter.interface';

/**
 * Runtime registry mapping an integration `type` to its {@link CommerceAdapter}.
 * Connectors register themselves at bootstrap; callers resolve an adapter by
 * the integration's `type`. This is the seam that lets new ERPs plug in without
 * touching business logic.
 */
@Injectable()
export class ConnectorRegistry {
  private readonly adapters = new Map<string, CommerceAdapter>();

  register(type: string, adapter: CommerceAdapter): void {
    this.adapters.set(type, adapter);
  }

  resolve(type: string): CommerceAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) {
      throw new NotFoundException(`No connector registered for integration type "${type}"`);
    }
    return adapter;
  }

  has(type: string): boolean {
    return this.adapters.has(type);
  }
}
