import { JoshCustomers } from "../connector/josh/josh-customers";
import { JoshOrders } from "../connector/josh/josh-orders";
import { repScopeSql } from "../connector/josh/sales-rep-scope";
import { paidOrderSql } from "../connector/josh/josh-insights";
import { companyId, repId } from "./plan-fixtures";
describe("compatible native planning projections", () => {
  const query = jest.fn();
  afterEach(() => {
    jest.resetAllMocks();
    delete process.env.ORDERS_SOURCE;
  });
  it("customer list binds escaped search and the original assignment predicate without PII/credit/KYC fields", async () => {
    query.mockResolvedValue([{ id: companyId, name: "Synthetic" }]);
    const c = new JoshCustomers({ configured: true, query } as never);
    await c.planningSubjects("50%_", [repId]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(repScopeSql("c", "$2")),
      ["%50\\%\\_%", [repId]],
    );
    const sql = query.mock.calls[0][0];
    expect(sql).toContain("LIMIT 21");
    expect(sql).not.toMatch(/credit|kyc|phone|email|register_number/);
  });
  it("customer detail refuses absent scoped identities and never turns [] into team scope", async () => {
    query.mockResolvedValue([]);
    const c = new JoshCustomers({ configured: true, query } as never);
    await expect(c.planningSubject(companyId, [])).rejects.toThrow(
      "authorized scope",
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(repScopeSql("c", "$2")),
      [companyId, []],
    );
  });
  it.each(["replica", "copies"])(
    "%s keeps the original paid and company-assignment SQL",
    async (source) => {
      process.env.ORDERS_SOURCE = source;
      query.mockResolvedValue(
        Array.from({ length: 21 }, (_, n) => ({ orders_id: n })),
      );
      const o = new JoshOrders(
        { configured: true, query } as never,
        { query } as never,
      );
      const page = await o.planningOrders(companyId, [repId]);
      expect(page.items).toHaveLength(20);
      expect(page.hasMore).toBe(true);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain(source === "copies" ? "o.paid" : paidOrderSql("o"));
      expect(sql).toContain(repScopeSql("c", "$2", source === "copies"));
      expect(params).toEqual([companyId, [repId]]);
      expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/);
    },
  );
  it("malformed company IDs fail before any query", async () => {
    const c = new JoshCustomers({ query } as never),
      o = new JoshOrders({ query } as never, { query } as never);
    await expect(c.planningSubject("bad")).rejects.toThrow("uuid");
    await expect(o.planningOrders("bad")).rejects.toThrow("uuid");
    expect(query).not.toHaveBeenCalled();
  });
});
