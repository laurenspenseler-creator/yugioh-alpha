// The attribute filters show a symbol next to each attribute (tester feedback, round 11), like the symbols of the Spell
// and Trap subtypes. The cards print the attribute as a round emblem; these are the closest symbols of the icon set.
const ATTRIBUTE_ICONS: Readonly<Record<string, string>> = {
  DARK: 'i-lucide-moon',
  DIVINE: 'i-lucide-sparkles',
  EARTH: 'i-lucide-mountain',
  FIRE: 'i-lucide-flame',
  LIGHT: 'i-lucide-sun',
  WATER: 'i-lucide-droplet',
  WIND: 'i-lucide-wind',
}

/** The icon of a monster attribute (a `catalog_card.attribute` value such as "FIRE"); undefined for anything else. */
export function attributeIcon(attribute: string): string | undefined {
  return ATTRIBUTE_ICONS[attribute]
}
