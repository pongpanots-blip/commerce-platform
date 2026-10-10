import { AssignmentWorkspaceController } from "./assignment-workspace.controller";
import { AssignmentWorkspaceService } from "./assignment-workspace.service";
import { JoshModule } from "../connector/josh/josh.module";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CustomerMetrics } from "./customer-metrics.entity";
import { CustomerMetricsService } from "./customer-metrics.service";
import { JoshStaffAccessController } from "./josh-staff-access.controller";
import { JoshStaffAccessService } from "./josh-staff-access.service";
import { SalesRepsController } from "./sales-reps.controller";
import { SalesRepsService } from "./sales-reps.service";

/** Customer marketing data commerce owns: metrics computed from the josh copies (2a), company sales reps (2b), josh staff
 * access (6). */
@Module({
  imports: [JoshModule, TypeOrmModule.forFeature([CustomerMetrics])],
  controllers: [
    AssignmentWorkspaceController,
    SalesRepsController,
    JoshStaffAccessController,
  ],
  providers: [
    AssignmentWorkspaceService,
    CustomerMetricsService,
    SalesRepsService,
    JoshStaffAccessService,
  ],
  exports: [CustomerMetricsService, SalesRepsService],
})
export class CustomersModule {}
