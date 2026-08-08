import { Injectable } from '@nestjs/common';
import { BaseCrudService } from '../../../../shared-kernel/application/base-crud.service';
import { User } from '../infrastructure/user.entity';
import { UserRepository } from '../infrastructure/user.repository';

/** Minimal User CRUD. Portal auth uses the raw repo directly for tight control. */
@Injectable()
export class UserService extends BaseCrudService<User> {
  constructor(repo: UserRepository) {
    super(repo);
  }

  protected get entityName(): string {
    return 'User';
  }
}
