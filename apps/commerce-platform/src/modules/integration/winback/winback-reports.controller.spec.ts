import { ServiceUnavailableException } from '@nestjs/common';
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { JoshModule } from '../connector/josh/josh.module';
import { WinbackModule } from './winback.module';
import { WinbackReports } from './winback-reports';
import { WinbackReportsController } from './winback-reports.controller';

const env = process.env.WINBACK_REPORTS_SOURCE;
afterEach(() => { if (env === undefined) delete process.env.WINBACK_REPORTS_SOURCE; else process.env.WINBACK_REPORTS_SOURCE = env; });

function make(replicaConfigured: boolean) {
  const josh = { available: replicaConfigured, overview: jest.fn().mockResolvedValue({ counts: { total: 9 } }) };
  const winback = {
    getCounts: jest.fn().mockResolvedValue({ total: 3 }),
    listProvinces: jest.fn().mockResolvedValue([]),
  };
  const qb = { select: jest.fn().mockReturnThis(), getRawMany: jest.fn().mockResolvedValue([]) };
  const accounts = { createQueryBuilder: jest.fn(() => qb) };
  const reports = new WinbackReports(josh as never, winback as never, {} as never, {} as never, accounts as never);
  return { c: new WinbackReportsController(reports), josh, winback };
}

describe('/reports/winback wiring', () => {
  // josh's old JoshWinbackController had the same prefix and paths; registered alongside, it won the routes
  // and ignored WINBACK_REPORTS_SOURCE. WinbackReportsController is the only owner now.
  it('only WinbackReportsController serves reports/winback', () => {
    const controllers = [JoshModule, WinbackModule].flatMap((m) => Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, m) as unknown[]);
    expect(controllers.every(Boolean)).toBe(true);
    const owners = controllers.filter((c) => Reflect.getMetadata(PATH_METADATA, c as object) === 'reports/winback');
    expect(owners).toEqual([WinbackReportsController]);
  });
});

describe('WinbackReportsController', () => {
  it('copies: overview answers without JOSH_DATABASE_URL', async () => {
    process.env.WINBACK_REPORTS_SOURCE = 'copies';
    const { c, josh, winback } = make(false);
    const res = await c.overview() as { data: { counts: unknown } };
    expect(res.data.counts).toEqual({ total: 3 });
    expect(winback.getCounts).toHaveBeenCalled();
    expect(josh.overview).not.toHaveBeenCalled();
  });

  it('replica (default): overview goes to josh', async () => {
    delete process.env.WINBACK_REPORTS_SOURCE;
    const { c, josh, winback } = make(true);
    const res = await c.overview() as { data: { counts: unknown } };
    expect(res.data.counts).toEqual({ total: 9 });
    expect(josh.overview).toHaveBeenCalled();
    expect(winback.getCounts).not.toHaveBeenCalled();
  });

  it('replica without JOSH_DATABASE_URL: 503', async () => {
    delete process.env.WINBACK_REPORTS_SOURCE;
    await expect(make(false).c.overview()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
