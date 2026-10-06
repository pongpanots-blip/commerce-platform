import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WinbackNotifyService } from './winback-notify.service';
import { cronConfig } from './shared/winback.config';

/**
 * Neither reminder has an event to hang off — time passing is the trigger.
 * Appointments: every 10 minutes against a 60-minute window, so a rep hears
 * 50–60 minutes ahead. Aging: once a day at 08:00 Bangkok, at the start of the
 * rep's day, not in the middle of a visit. Digest: 18:00 Bangkok, end of day.
 */
@Injectable()
export class WinbackNotifyCron {
  private readonly logger = new Logger(WinbackNotifyCron.name);

  constructor(private readonly notify: WinbackNotifyService) {}

  @Cron(cronConfig.winbackAppointmentsDue.expression, {
    timeZone: cronConfig.winbackAppointmentsDue.timeZone,
    disabled: !cronConfig.winbackAppointmentsDue.enabled,
  })
  async appointmentsDueTick(): Promise<void> {
    try {
      const sent = await this.notify.notifyAppointmentsDue();
      if (sent > 0) this.logger.log(`winback_appointment_due: reminded ${sent} rep(s)`);
    } catch (error) {
      this.logger.warn(`winback_appointment_due tick failed: ${String(error)}`);
    }
  }

  @Cron(cronConfig.winbackDailyDigest.expression, {
    timeZone: cronConfig.winbackDailyDigest.timeZone,
    disabled: !cronConfig.winbackDailyDigest.enabled,
  })
  async dailyDigestTick(): Promise<void> {
    try {
      const sent = await this.notify.notifyDailyDigest();
      if (sent > 0) this.logger.log(`winback_daily_digest: sent to ${sent} rep(s)`);
    } catch (error) {
      this.logger.warn(`winback_daily_digest tick failed: ${String(error)}`);
    }
  }

  @Cron(cronConfig.winbackAgingLeads.expression, {
    timeZone: cronConfig.winbackAgingLeads.timeZone,
    disabled: !cronConfig.winbackAgingLeads.enabled,
  })
  async agingLeadsTick(): Promise<void> {
    try {
      const sent = await this.notify.notifyAgingLeads();
      if (sent > 0) this.logger.log(`winback_lead_aging: notified ${sent} lead owner(s)`);
    } catch (error) {
      this.logger.warn(`winback_lead_aging tick failed: ${String(error)}`);
    }
  }
}
