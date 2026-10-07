import { Controller, Get } from '@nestjs/common';
import { ownsSegments } from './segments.service';

/**
 * Which josh features commerce owns right now (any signed-in staff). commerce-admin's hosted josh pages read it
 * to send writes to commerce or to josh — so switching ownership is an env change, not a UI deploy.
 */
@Controller('ownership')
export class OwnershipController {
  @Get() get() { return { segments: ownsSegments() }; }
}
