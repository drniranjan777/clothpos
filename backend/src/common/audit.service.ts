import { Global, Injectable, Module } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog } from '../database/entities';
import type { AuthUser } from './auth';

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private repo: Repository<AuditLog>) {}

  /** Records a critical action (BRD §27). Pass the transaction manager to keep it atomic with the change. */
  log(
    user: AuthUser | null,
    action: string,
    entity: string,
    entityId?: string,
    meta?: Record<string, unknown>,
    em?: EntityManager,
    tenantId?: string | null,
  ) {
    const row = (em ? em.getRepository(AuditLog) : this.repo).create({
      tenantId: tenantId !== undefined ? tenantId : (user?.tenantId ?? null),
      userId: user?.sub ?? null,
      userName: user?.name,
      action,
      entity,
      entityId,
      meta,
    });
    return (em ? em.getRepository(AuditLog) : this.repo).save(row);
  }
}

@Global()
@Module({ imports: [TypeOrmModule.forFeature([AuditLog])], providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
