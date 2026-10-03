import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './shared-kernel/presentation/auth.decorators';

// Own auth (or health) — skip the global staff guard.
@Public()
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getData() {
    return this.appService.getData();
  }
}
