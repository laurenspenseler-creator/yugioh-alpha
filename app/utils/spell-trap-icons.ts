// The symbol in the upper right corner of a Spell or Trap card tells what kind it is; the filters show the same symbol next
// to the name (tester feedback, round 9). A Normal Spell or Trap has no symbol, so it has no icon either.
const SPELL_TRAP_ICONS: Readonly<Record<string, string>> = {
  'Continuous': 'i-lucide-infinity',
  'Equip': 'i-lucide-plus',
  'Field': 'i-lucide-compass',
  'Quick-Play': 'i-lucide-zap',
  'Ritual': 'i-lucide-flame',
  'Counter': 'i-lucide-corner-down-left',
}

/** The icon of a Spell or Trap subtype (a `race` value such as "Continuous"); undefined for Normal and for monster races. */
export function spellTrapIcon(race: string): string | undefined {
  return SPELL_TRAP_ICONS[race]
}
