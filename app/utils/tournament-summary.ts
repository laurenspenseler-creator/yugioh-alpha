import type { QueueSetupDto } from '~~/shared/tournaments'

type Translate = (key: string, named?: Record<string, unknown>) => string

/**
 * The settings of a duel-queue tournament in one line: "Schweizer System · 4 Tische · 30 Min. pro Match"; played in
 * Spieltage it says so instead of the tables (nobody waits for one), and a best-of-3 tournament ends with "Best of 3".
 */
export function queueSummary(t: Translate, setup: QueueSetupDto): string {
  const text = t(setup.flow === 'rounds' ? 'tournaments.queue.setup.summaryRounds' : 'tournaments.queue.setup.summary', {
    mode: t(`tournaments.queue.mode.${setup.mode}.label`),
    tables: setup.tables,
    minutes: setup.duelMinutes,
  })
  return setup.bestOf === 3 ? `${text} · ${t('tournaments.queue.bestOf.3.short')}` : text
}
