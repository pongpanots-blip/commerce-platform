import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

@Entity('files')
export class FileObject extends BaseEntity {
  @Column({ type: 'varchar', length: 128 })
  bucket: string;

  @Column({ type: 'varchar', length: 512 })
  key: string;

  @Column({ type: 'varchar', length: 128, name: 'mime_type', nullable: true })
  mimeType: string | null;

  @Column({ type: 'bigint', name: 'size_bytes', default: 0 })
  sizeBytes: string;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  url: string | null;
}
