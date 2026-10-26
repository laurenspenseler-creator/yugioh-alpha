<script setup lang="ts">
import type { RulebookImport } from '~~/shared/format-rulebook'
import type { HandtrapRules } from '~/components/formats/RulebookImport.vue'
import type { Rule } from '~~/shared/rule-formats'

usePageTitle('formats.new.title')

const { t } = useI18n()
const toast = useToast()
const { cardLocale, cardName } = useCardText()

// A rulebook that was read fills the editor below. The editor copies its
// initial values once, so a new result (or a change of the card language,
// which the rule summaries name cards in) re-mounts it.
const imported = ref<RulebookImport | null>(null)
const importCount = ref(0)

const editor = useTemplateRef<{ replaceRulesFrom: (origin: string, rules: Rule[], names: Record<string, string>) => void }>('editor')

/** The hand-trap definition the user picked: its rules replace the ones of the earlier pick, edits stay. */
function onHandtraps(payload: HandtrapRules | null) {
  const names = Object.fromEntries(Object.entries(payload?.cardNames ?? {}).map(([id, name]) =>
    [id, cardName({ name, nameDe: payload?.cardNamesDe[Number(id)] })]))
  editor.value?.replaceRulesFrom('handtraps', payload?.rules ?? [], names)
}

const initialValues = computed(() => {
  const current = imported.value
  if (!current) {
    return null
  }
  return {
    name: current.name,
    description: current.description || null,
    rules: current.rules,
    cardNames: Object.fromEntries(Object.entries(current.cardNames).map(([id, name]) =>
      [id, cardName({ name, nameDe: current.cardNamesDe[Number(id)] })])),
  }
})
const editorKey = computed(() => `${importCount.value}-${cardLocale.value}`)

function onImported(result: RulebookImport) {
  imported.value = result
  importCount.value += 1
}

async function onSaved(format: { id: string, name: string }) {
  toast.add({ title: t('formats.toast.saved', { name: format.name }), color: 'success' })
  await navigateTo('/formats')
}
</script>

<template>
  <div class="space-y-6">
    <div class="space-y-2">
      <LayoutBackLink
        to="/formats"
        :label="t('formats.back')"
      />
      <LayoutPageHeader
        :title="t('formats.new.title')"
        :description="t('formats.new.description')"
      />
    </div>

    <FormatsRulebookImport
      @imported="onImported"
      @handtraps="onHandtraps"
    />

    <FormatsRuleFormatEditor
      ref="editor"
      :key="editorKey"
      :initial-values="initialValues"
      @saved="onSaved"
    />
  </div>
</template>
