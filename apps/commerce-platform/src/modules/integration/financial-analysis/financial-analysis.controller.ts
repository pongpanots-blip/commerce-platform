import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import {
  StaffRoles,
  StaffRequest,
} from "../../../shared-kernel/presentation/auth.decorators";
import { FinancialAnalysisService } from "./financial-analysis.service";
import { FinancialReaderService } from "./financial-reader.service";
import { month, monthWindow } from "./financial-analysis";
/** Existing team report readers only. No writes or read-only-role exceptions. */
@Controller("reports/financial-analysis")
@StaffRoles("sales_manager", "business_analyst")
export class FinancialAnalysisController {
  constructor(
    private readonly analysisService: FinancialAnalysisService,
    private readonly reader: FinancialReaderService,
  ) {}
  private async valid<T>(run: () => Promise<T>) {
    try {
      return await run();
    } catch (e) {
      if (e instanceof z.ZodError)
        throw new BadRequestException(
          "Choose valid, distinct calendar months and one timezone. Scope and source overrides are unavailable.",
        );
      throw e;
    }
  }
  @Get() @Header("Cache-Control", "private, no-store") analysis(
    @Query() q: unknown,
    @Req() req: StaffRequest,
  ) {
    return this.valid(() => this.analysisService.analysis(q, req.staff.userId));
  }
  @Get("orders/:id") @Header("Cache-Control", "private, no-store") order(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() raw: unknown,
  ) {
    return this.valid(() => {
      const q = z
        .object({ month, timezone: z.enum(["UTC", "Asia/Bangkok"]) })
        .strict()
        .parse(raw);
      if (Date.parse(monthWindow(q.month, q.timezone).from) > Date.now())
        throw new BadRequestException("Choose a month that has started.");
      return this.reader.detail("orders", q.month, q.timezone, id);
    });
  }
  @Get("refunds/:orderId/:id")
  @Header("Cache-Control", "private, no-store")
  refund(
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() raw: unknown,
  ) {
    return this.valid(() => {
      const q = z
        .object({ month, timezone: z.enum(["UTC", "Asia/Bangkok"]) })
        .strict()
        .parse(raw);
      if (Date.parse(monthWindow(q.month, q.timezone).from) > Date.now())
        throw new BadRequestException("Choose a month that has started.");
      return this.reader.detail("refunds", q.month, q.timezone, id, orderId);
    });
  }
}
