import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeOrmBaseRepository } from '../../../../shared-kernel/infrastructure/typeorm-base.repository';
import { User } from './user.entity';

@Injectable()
export class UserRepository extends TypeOrmBaseRepository<User> {
  constructor(@InjectRepository(User) repo: Repository<User>) {
    super(repo);
  }
}
