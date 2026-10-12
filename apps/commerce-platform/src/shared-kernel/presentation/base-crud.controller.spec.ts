import { BaseCrudService } from '../application/base-crud.service';
import { BaseCrudController } from './base-crud.controller';

interface Widget {
  id: string;
  name: string;
}

class WidgetController extends BaseCrudController<Widget>() {
  constructor(service: BaseCrudService<Widget>) {
    super();
    this.service = service;
  }
}

function mockService(): jest.Mocked<BaseCrudService<Widget>> {
  return {
    create: jest.fn(),
    findMany: jest.fn(),
    list: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  } as unknown as jest.Mocked<BaseCrudService<Widget>>;
}

describe('BaseCrudController', () => {
  it('list forwards pagination and search to the service', () => {
    const svc = mockService();
    new WidgetController(svc).list({ page: 2, pageSize: 5, search: 'abc' });
    expect(svc.list).toHaveBeenCalledWith({ page: 2, pageSize: 5, search: 'abc' });
  });

  it('get / create / update / remove delegate to the service', () => {
    const svc = mockService();
    const ctrl = new WidgetController(svc);
    ctrl.get('id-1');
    ctrl.create({ name: 'a' });
    ctrl.update('id-1', { name: 'b' });
    ctrl.remove('id-1');
    expect(svc.findOne).toHaveBeenCalledWith('id-1');
    expect(svc.create).toHaveBeenCalledWith({ name: 'a' });
    expect(svc.update).toHaveBeenCalledWith('id-1', { name: 'b' });
    expect(svc.remove).toHaveBeenCalledWith('id-1');
  });
});
