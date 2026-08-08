import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Integration } from '../infrastructure/integration.entity';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** Admin-side management of integrations (the configured external systems). */
@Injectable()
export class IntegrationService {
  constructor(
    @InjectRepository(Integration)
    private readonly repo: Repository<Integration>,
  ) {}

  list(): Promise<Integration[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<Integration> {
    const found = await this.repo.findOne({ where: { id } });
    if (!found) throw new NotFoundException(`Integration ${id} not found`);
    return found;
  }

  /** Resolve by UUID or by webhook slug — used by the webhook receiver. */
  async resolve(ref: string): Promise<Integration | null> {
    if (UUID_RE.test(ref)) {
      return this.repo.findOne({ where: { id: ref } });
    }
    return this.repo.findOne({ where: { slug: ref } });
  }

  async create(dto: Partial<Integration>): Promise<Integration> {
    const slug = await this.ensureUniqueSlug(
      dto.slug ? slugify(dto.slug) : slugify(dto.type ?? dto.name ?? 'integration'),
    );
    return this.repo.save(this.repo.create({ ...dto, slug }));
  }

  /** Appends -2, -3, ... until the slug is free. */
  private async ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
    const root = base || 'integration';
    let candidate = root;
    let n = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const clash = await this.repo.findOne({
        where: excludeId
          ? { slug: candidate, id: Not(excludeId) }
          : { slug: candidate },
      });
      if (!clash) return candidate;
      n += 1;
      candidate = `${root}-${n}`.slice(0, 64);
    }
  }
}
