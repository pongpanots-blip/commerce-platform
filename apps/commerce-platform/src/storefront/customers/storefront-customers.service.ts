import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerService } from '../../modules/commerce/customer/application/customer.service';
import { Customer } from '../../modules/commerce/customer/infrastructure/customer.entity';
import { Integration } from '../../modules/integration/integration/infrastructure/integration.entity';
import { ErpHttpClient, ErpClientConfig } from '../../modules/integration/connector/erp/erp-http.client';
import { MappingService } from '../../modules/integration/mapping/application/mapping.service';

export interface StorefrontUpsertInput { name: string; email?: string; phone?: string; taxId?: string; }

/**
 * Customer intake from josh (brief §3.6): deterministic identity resolution on
 * normalized email/phone (no probabilistic auto-merge), then the ERP
 * customer-code round-trip through the mock-gated ErpHttpClient seam.
 */
@Injectable()
export class StorefrontCustomersService {
  private readonly logger = new Logger(StorefrontCustomersService.name);

  constructor(
    private readonly customers: CustomerService,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Integration) private readonly integrations: Repository<Integration>,
    private readonly erpClient: ErpHttpClient,
    private readonly mapping: MappingService,
  ) {}

  async upsert(input: StorefrontUpsertInput): Promise<{ customerId: string; customerCode: string | null }> {
    const email = input.email?.trim().toLowerCase() || null;
    const phone = input.phone?.replace(/\D/g, '') || null;
    if (!email && !phone) throw new BadRequestException('customer needs email or phone');

    const existing = await this.customerRepo.findOne({
      where: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
    });

    const customer = existing
      ? await this.customers.update(existing.id, { name: input.name, email: email ?? existing.email, phone: phone ?? existing.phone })
      : await this.customers.create({ name: input.name, email, phone });

    const customerCode = await this.syncToErp(customer, input.taxId ?? null);
    return { customerId: customer.id, customerCode: customerCode ?? customer.code ?? null };
  }

  private async syncToErp(customer: Customer, taxId: string | null): Promise<string | null> {
    // Field ownership (same principle as the ERP ingest appliers): once a
    // customer carries a code — whether assigned here previously or, more
    // importantly, by an inbound ERP ingest (ACCOUNT_NUMBER, the REAL ERP
    // account code) — this storefront-triggered mock round trip must never
    // clobber it with a freshly generated synthetic code. Without this guard
    // a customer created via ERP ingest (code JGT-00871) who then places an
    // order through the storefront would silently lose their real ERP code.
    if (customer.code) return customer.code;

    const erp = await this.integrations.findOne({ where: { type: 'erp', status: 'active' } });
    if (!erp) return null;

    // In liveMode the client throws on network/HTTP failure — the local
    // customer row is already committed, so degrade to customerCode null
    // (same outcome as the ok:false branch) instead of 500ing the request.
    let res: Awaited<ReturnType<ErpHttpClient['upsertCustomer']>>;
    try {
      res = await this.erpClient.upsertCustomer(
        { platformCustomerId: customer.id, name: customer.name, email: customer.email, phone: customer.phone, taxId },
        (erp.config ?? {}) as ErpClientConfig,
      );
    } catch (err) {
      this.logger.warn(`ERP upsertCustomer threw for ${customer.id}: ${(err as Error).message}`);
      return null;
    }
    if (!res.ok || !res.customerCode) {
      this.logger.warn(`ERP upsertCustomer failed for ${customer.id}: ${res.error}`);
      return null;
    }
    await this.customers.update(customer.id, { code: res.customerCode });
    // MappingService.link signature confirmed against
    // modules/integration/mapping/application/mapping.service.ts:
    // link(integrationId, entityType, platformId, externalId, externalRef?)
    // — matches the call below as-is.
    await this.mapping.link(erp.id, 'customer', customer.id, res.customerCode);
    return res.customerCode;
  }
}
