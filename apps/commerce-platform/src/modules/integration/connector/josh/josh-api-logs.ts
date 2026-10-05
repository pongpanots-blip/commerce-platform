import { Injectable, NotFoundException } from '@nestjs/common';
import { Collection, Document, ObjectId } from 'mongodb';
import { ApiLogQueryService } from './api-log/api-log-query.service';
import { ApiLogQueryDto } from './api-log/dto/api-log-query.dto';
import { JoshErpLogs } from './josh-erp-logs';

const MAX_TIME_MS = 15_000;

/** The slice of a mongoose Model josh's ApiLogQueryService calls, over a plain driver collection. */
export function mongooseLike(c: Collection) {
  return {
    countDocuments: (filter: Document) => c.countDocuments(filter, { maxTimeMS: MAX_TIME_MS }),
    aggregate: (pipeline: Document[]) => {
      let allowDisk = false;
      const q = { allowDiskUse: (on: boolean) => { allowDisk = on; return q; }, exec: () => c.aggregate(pipeline, { maxTimeMS: MAX_TIME_MS, allowDiskUse: allowDisk }).toArray() };
      return q;
    },
    find: (filter: Document, projection?: Document) => {
      let cursor = c.find(filter, { projection, maxTimeMS: MAX_TIME_MS });
      const q = {
        sort: (s: Document) => { cursor = cursor.sort(s); return q; },
        skip: (n: number) => { cursor = cursor.skip(n); return q; },
        limit: (n: number) => { cursor = cursor.limit(n); return q; },
        lean: () => cursor.toArray(),
      };
      return q;
    },
    findById: (id: string) => ({ lean: () => c.findOne({ _id: new ObjectId(id) }, { maxTimeMS: MAX_TIME_MS }) }),
  };
}
export type MongooseLikeModel = ReturnType<typeof mongooseLike>;

/**
 * josh's general API log (web-admin › API logs), READ-ONLY from josh's Mongo `api_logs` with josh's
 * own query code: every HTTP call josh served and every call it made to Jagota / KBank, minus
 * ERP inbound (that is the ERP log page). Logged responses may hold customer data — admin only.
 */
@Injectable()
export class JoshApiLogs {
  constructor(private readonly logs: JoshErpLogs) {}

  get available() { return this.logs.configured; }

  private async service() { return new ApiLogQueryService(mongooseLike(await this.logs.logsCollection('api_logs'))); }

  async list(query: ApiLogQueryDto) { return (await this.service()).list(query); }
  async stats(query: ApiLogQueryDto) { return (await this.service()).stats(query); }
  async detail(id: string) {
    const doc = await (await this.service()).findOne(id);
    if (!doc) throw new NotFoundException('ไม่พบ log รายการนี้ (อาจหมดไปจาก capped collection แล้ว)');
    return doc;
  }
}
