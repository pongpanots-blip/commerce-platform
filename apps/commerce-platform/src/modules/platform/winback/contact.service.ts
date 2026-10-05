import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WinbackContact } from './entities/winback-contact.entity';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { maskEmail, maskPhone } from './shared/pii.helper';
import { maskContactFullName, rejectMaskedPiiValues } from './winback-pii.helpers';

/** Win-back sales are internal staff, never the data subject — always
 *  masked; full values go through the audited POST /api/pii/reveal. */
function maskContactPii(contact: WinbackContact): WinbackContact {
  return {
    ...contact,
    name: maskContactFullName(contact.name) ?? contact.name,
    mobile: maskPhone(contact.mobile),
    email: maskEmail(contact.email),
  } as WinbackContact;
}

@Injectable()
export class ContactService {
  constructor(
    @InjectRepository(WinbackContact) private readonly contacts: Repository<WinbackContact>,
  ) {}

  async list(accountId: string) {
    const rows = await this.contacts.find({
      where: { account_id: accountId },
      order: { create_date: 'ASC' },
    });
    return rows.map(maskContactPii);
  }

  async add(accountId: string, dto: CreateContactDto) {
    const saved = await this.contacts.save(
      this.contacts.create({
        account_id: accountId,
        team: dto.team,
        name: dto.name,
        role_label: dto.role_label ?? null,
        mobile: dto.mobile ?? null,
        email: dto.email ?? null,
        line_id: dto.line_id ?? null,
        whatsapp: dto.whatsapp ?? null,
      }),
    );
    return maskContactPii(saved);
  }

  async update(contactId: string, dto: UpdateContactDto) {
    const contact = await this.contacts.findOne({ where: { id: contactId } });
    if (!contact) throw new NotFoundException('contact not found');
    rejectMaskedPiiValues(dto as Record<string, unknown>);
    if (dto.team !== undefined) contact.team = dto.team;
    if (dto.name !== undefined) contact.name = dto.name;
    if (dto.role_label !== undefined) contact.role_label = dto.role_label ?? null;
    if (dto.mobile !== undefined) contact.mobile = dto.mobile ?? null;
    if (dto.email !== undefined) contact.email = dto.email ?? null;
    if (dto.line_id !== undefined) contact.line_id = dto.line_id ?? null;
    if (dto.whatsapp !== undefined) contact.whatsapp = dto.whatsapp ?? null;
    const saved = await this.contacts.save(contact);
    return maskContactPii(saved);
  }

  async remove(contactId: string) {
    await this.contacts.delete({ id: contactId });
    return { deleted: true };
  }
}
