import { DateTime } from 'luxon';
import { z } from 'zod';
import { venueSchema } from '@euroedge/shared';

/** Trading phases in session order (ADR-0004). Halts come from feed health, not calendars. */
export const PHASES = [
  'preOpen',
  'openingAuction',
  'continuous',
  'closingAuction',
  'postTrading',
] as const;
export type Phase = (typeof PHASES)[number];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:mm');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const phaseRuleSchema = z
  .object({
    /** Local wall-clock times in the calendar's time zone. */
    open: hhmm,
    close: hhmm,
    /** Days after the open date on which the phase closes; default 0 if close > open, else 1. */
    spanDays: z.number().int().min(0).max(6).optional(),
    /** Auctions with a random end: uncrossing at close + U(0, randomEndSec) seconds. */
    randomEndSec: z.number().int().min(1).max(300).optional(),
  })
  .strict();
export type PhaseRule = z.infer<typeof phaseRuleSchema>;

const phasesSchema = z
  .object({
    preOpen: phaseRuleSchema.optional(),
    openingAuction: phaseRuleSchema.optional(),
    continuous: phaseRuleSchema,
    closingAuction: phaseRuleSchema.optional(),
    postTrading: phaseRuleSchema.optional(),
  })
  .strict();
export type Phases = z.infer<typeof phasesSchema>;

const sourceSchema = z
  .object({
    years: z.array(z.number().int().min(2020).max(2100)).min(1),
    url: z.url(),
    /** Date the source was checked; null while it has not been checked against the venue. */
    retrieved: isoDate.nullable(),
    verified: z.boolean(),
    note: z.string().optional(),
  })
  .strict();

const ISO_WEEKDAY = z.number().int().min(1).max(7);

export const calendarFileSchema = z
  .object({
    venue: venueSchema,
    name: z.string().min(1),
    tz: z.string().refine((tz) => DateTime.now().setZone(tz).isValid, 'unknown IANA time zone'),
    /** Inclusive range of trade dates this file describes. */
    coverage: z.object({ from: isoDate, to: isoDate }).strict(),
    /** Trade date = local open date + offset (1 for overnight sessions that belong to the next day). */
    tradeDateOffsetDays: z.number().int().min(0).max(1).default(0),
    /** Informational calendars are not used to resolve windows. */
    informational: z.boolean().default(false),
    sources: z.array(sourceSchema).min(1),
    regular: z
      .object({
        /** ISO weekdays (local) on which sessions open. */
        days: z.array(ISO_WEEKDAY).min(1),
        phases: phasesSchema,
      })
      .strict(),
    /** Full-day closures on otherwise regular trade dates. */
    holidays: z.array(z.object({ date: isoDate, name: z.string().min(1) }).strict()),
    /** Trade dates with a non-regular timetable (half-days, early closes). */
    specialSessions: z
      .array(z.object({ date: isoDate, name: z.string().min(1), phases: phasesSchema }).strict())
      .default([]),
  })
  .strict()
  .superRefine((cal, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    const inCoverage = (d: string) => d >= cal.coverage.from && d <= cal.coverage.to;
    const regularDay = (d: string) =>
      cal.regular.days.includes(
        DateTime.fromISO(d, { zone: cal.tz }).minus({ days: cal.tradeDateOffsetDays }).weekday,
      );
    const seen = new Set<string>();
    for (const [kind, list] of [
      ['holiday', cal.holidays],
      ['special session', cal.specialSessions],
    ] as const) {
      let prev = '';
      for (const { date } of list) {
        if (!DateTime.fromISO(date).isValid) issue(`${kind} ${date} is not a valid date`);
        if (!inCoverage(date)) issue(`${kind} ${date} is outside coverage`);
        if (!regularDay(date)) issue(`${kind} ${date} is not a regular trading day`);
        if (seen.has(date)) issue(`${date} is listed twice`);
        if (date <= prev) issue(`${kind} dates must be sorted (${date} after ${prev})`);
        seen.add(date);
        prev = date;
      }
    }
    const years = new Set(cal.sources.flatMap((s) => s.years));
    for (
      let y = Number(cal.coverage.from.slice(0, 4));
      y <= Number(cal.coverage.to.slice(0, 4));
      y++
    )
      if (!years.has(y)) issue(`no source for ${y}`);
  });
export type CalendarFile = z.output<typeof calendarFileSchema>;
