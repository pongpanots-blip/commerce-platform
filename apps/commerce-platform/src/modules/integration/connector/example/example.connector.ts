import { Injectable } from '@nestjs/common';
import { BaseCommerceAdapter } from '../../adapter/application/base-commerce-adapter';
import {
  AdapterContext,
  AdapterResult,
  SyncResult,
} from '../../adapter/domain/commerce-adapter.interface';

/**
 * Reference connector proving the {@link CommerceAdapter} contract. It performs
 * NO external calls and contains NO ERP-specific logic — it is the template
 * future SAP/Shopify/Jagota connectors follow.
 */
@Injectable()
export class ExampleConnector extends BaseCommerceAdapter {
  readonly type = 'example';

  async syncCustomers(_ctx: AdapterContext): Promise<SyncResult> {
    return { processed: 0, failed: 0 };
  }

  async syncProducts(_ctx: AdapterContext): Promise<SyncResult> {
    return { processed: 0, failed: 0 };
  }

  async syncInventory(_ctx: AdapterContext): Promise<SyncResult> {
    return { processed: 0, failed: 0 };
  }

  async syncPrices(_ctx: AdapterContext): Promise<SyncResult> {
    return { processed: 0, failed: 0 };
  }

  async createOrder(_order: unknown): Promise<AdapterResult> {
    return { ok: true };
  }

  async cancelOrder(_ref: string): Promise<AdapterResult> {
    return { ok: true };
  }

  async updateOrder(_order: unknown): Promise<AdapterResult> {
    return { ok: true };
  }
}
