import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Field-visit GPS: the check-out position and the reported accuracy of both fixes. Check-in
 * lat/lng stay in the existing `lat`/`lng`. Distance to the customer is judged at read time
 * (visit-gps.helpers), so nothing derived is stored. Commerce-only columns: WinbackMirror
 * compares the columns both sides have, so josh's copy is unaffected.
 */
export class WinbackVisitGps1795900000000 implements MigrationInterface {
  name = 'WinbackVisitGps1795900000000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE winback_activity
      ADD COLUMN checkin_accuracy_m numeric(8,1) NULL,
      ADD COLUMN checkout_lat numeric(10,7) NULL,
      ADD COLUMN checkout_lng numeric(10,7) NULL,
      ADD COLUMN checkout_accuracy_m numeric(8,1) NULL`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE winback_activity
      DROP COLUMN checkout_accuracy_m,
      DROP COLUMN checkout_lng,
      DROP COLUMN checkout_lat,
      DROP COLUMN checkin_accuracy_m`);
  }
}
