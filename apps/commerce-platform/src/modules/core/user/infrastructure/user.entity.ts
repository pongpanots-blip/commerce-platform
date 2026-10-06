import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

@Entity('users')
@Index(['email'], { unique: true })
export class User extends BaseEntity {
  @Column({ type: 'varchar', length: 191 })
  email: string;

  @Column({ type: 'varchar', length: 255, name: 'password_hash', nullable: true })
  passwordHash: string | null;

  @Column({ type: 'varchar', length: 191, nullable: true })
  name: string | null;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: string;

  /** 'developer' for portal signups; admins/staff come later. */
  @Column({ type: 'varchar', length: 24, default: 'developer' })
  role: string;

  /** Someone else set this password (new staff account, reset): the owner must change it before anything else. */
  @Column({ type: 'boolean', name: 'must_change_password', default: false })
  mustChangePassword: boolean;
}
