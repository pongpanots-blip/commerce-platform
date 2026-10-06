import { PartialType } from '@nestjs/mapped-types';
import { CreateContactDto } from './create-contact.dto';

/**
 * Body of PATCH /winback/contacts/:contactId — any subset of CreateContactDto;
 * absent fields are left untouched. Clients send only what the user edited:
 * `mobile` / `email` come back masked from every read, and echoing a mask is a 400.
 */
export class UpdateContactDto extends PartialType(CreateContactDto) {}
