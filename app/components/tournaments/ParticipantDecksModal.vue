<script setup lang="ts">
// The decks of one participant (ADR 0039): list them, take one off, add one of
// the app's decks (copied, and checked against the tournament's format) or just
// a name. The organizer does this for everyone; a player for their own row
// while the tournament is open. Whose decks the list offers comes from the
// server: the caller's own, or for another player with an account only the ones
// that player shared with the organizer.
import { DECK_NAME_MAX_LENGTH, MAX_DECKS_PER_PARTICIPANT } from '~~/shared/tournaments'
import type { TournamentDeckOptions, TournamentDetail, TournamentParticipantDeckDto, TournamentParticipantDto } from '~~/shared/tournaments'

const props = defineProps<{
  open: boolean
  tournamentId: string
  participant: TournamentParticipantDto | null
  /** Whether the caller may add and remove decks here (the page decides from role and status). */
  canManage: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'updated': [detail: TournamentDetail]
  /** The user wants to make a new deck from photos, speech or a list; the page opens the deck import. */
  'importDeck': []
}>()

const { t } = useI18n()
const count = useCount()
const apiError = useApiError()

const openProxy = computed({
  get: () => props.open,
  set: value => emit('update:open', value),
})

const decks = computed(() => props.participant?.decks ?? [])
const isFull = computed(() => decks.value.length >= MAX_DECKS_PER_PARTICIPANT)

const options = ref<TournamentDeckOptions>({ source: 'own', items: [] })
const optionsLoaded = ref(false)
const selectedDeckId = ref('')
const typedName = ref('')
const busy = ref(false)
const errorMessage = ref('')

// Decks that are not on the participant yet.
const deckItems = computed(() => options.value.items
  .filter(item => !decks.value.some(entry => entry.deckId === item.id))
  .map(item => ({ label: item.name, value: item.id })))

async function loadOptions() {
  optionsLoaded.value = false
  options.value = { source: 'own', items: [] }
  if (!props.participant || !props.canManage) {
    return
  }
  try {
    options.value = await $fetch<TournamentDeckOptions>(`/api/tournaments/${props.tournamentId}/participants/${props.participant.id}/deck-options`)
  }
  catch (error) {
    errorMessage.value = apiError(error, 'tournaments.decksDialog.loadFailed')
  }
  finally {
    optionsLoaded.value = true
  }
}

watch(
  () => [props.open, props.participant?.id] as const,
  ([open]) => {
    if (!open) {
      return
    }
    errorMessage.value = ''
    selectedDeckId.value = ''
    typedName.value = ''
    loadOptions()
  },
  { immediate: true },
)

async function add(body: { deckId: string } | { name: string }) {
  if (!props.participant || busy.value) {
    return
  }
  busy.value = true
  errorMessage.value = ''
  try {
    const detail = await $fetch<TournamentDetail>(`/api/tournaments/${props.tournamentId}/participants/${props.participant.id}/decks`, { method: 'POST', body })
    emit('updated', detail)
    selectedDeckId.value = ''
    typedName.value = ''
  }
  catch (error) {
    errorMessage.value = apiError(error, 'tournaments.decksDialog.addFailed')
  }
  finally {
    busy.value = false
  }
}

async function remove(entry: TournamentParticipantDeckDto) {
  if (!props.participant || busy.value) {
    return
  }
  busy.value = true
  errorMessage.value = ''
  try {
    const detail = await $fetch<TournamentDetail>(`/api/tournaments/${props.tournamentId}/participants/${props.participant.id}/decks/${entry.id}`, { method: 'DELETE' })
    emit('updated', detail)
  }
  catch (error) {
    errorMessage.value = apiError(error, 'tournaments.decksDialog.removeFailed')
  }
  finally {
    busy.value = false
  }
}

function legality(entry: TournamentParticipantDeckDto): { label: string, color: 'success' | 'error' | 'neutral' } | null {
  if (!entry.hasList) {
    return null
  }
  if (entry.legal === null) {
    return { label: t('tournaments.noFormat'), color: 'neutral' }
  }
  return entry.legal
    ? { label: t('validation.badge.legal'), color: 'success' }
    : { label: t('validation.badge.notLegal'), color: 'error' }
}
</script>

<template>
  <UModal
    v-model:open="openProxy"
    :title="t('tournaments.decksDialog.title', { name: participant?.name ?? '' })"
  >
    <template #body>
      <div class="space-y-5">
        <section class="space-y-2">
          <h3 class="text-sm font-semibold text-highlighted">
            {{ t('tournaments.decksDialog.current') }}
          </h3>
          <p
            v-if="decks.length === 0"
            class="text-sm text-muted"
          >
            {{ t('tournaments.decksDialog.none') }}
          </p>
          <ul
            v-else
            class="space-y-1.5"
          >
            <li
              v-for="entry in decks"
              :key="entry.id"
              class="flex items-center justify-between gap-2 rounded-lg border border-default px-3 py-2"
              data-testid="participant-deck"
            >
              <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span class="font-medium text-highlighted">{{ entry.name }}</span>
                <UBadge
                  v-if="legality(entry)"
                  size="sm"
                  variant="subtle"
                  :color="legality(entry)!.color"
                  :label="legality(entry)!.label"
                />
                <span
                  v-if="entry.issueCount"
                  class="text-xs text-muted"
                >{{ count('tournaments.participants.issueCount', entry.issueCount) }}</span>
                <span
                  v-if="!entry.hasList"
                  class="text-xs text-muted"
                >{{ t('tournaments.decksDialog.nameOnly') }}</span>
              </div>
              <UButton
                v-if="canManage"
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="xs"
                class="tap-target shrink-0"
                :disabled="busy"
                :aria-label="t('tournaments.decksDialog.remove', { name: entry.name })"
                @click="remove(entry)"
              />
            </li>
          </ul>
        </section>

        <template v-if="canManage">
          <p
            v-if="isFull"
            class="text-sm text-muted"
          >
            {{ t('tournaments.decksDialog.limit', { max: MAX_DECKS_PER_PARTICIPANT }) }}
          </p>

          <template v-else>
            <section class="space-y-2">
              <UFormField :label="t('tournaments.decksDialog.pick.label')">
                <div class="flex items-center gap-2">
                  <USelect
                    v-model="selectedDeckId"
                    :items="deckItems"
                    :disabled="busy || deckItems.length === 0"
                    :placeholder="t('tournaments.decksDialog.pick.placeholder')"
                    :aria-label="t('tournaments.decksDialog.pick.label')"
                    class="min-w-0 flex-1"
                  />
                  <UButton
                    :label="t('tournaments.decksDialog.pick.add')"
                    :loading="busy"
                    :disabled="!selectedDeckId"
                    @click="add({ deckId: selectedDeckId })"
                  />
                </div>
              </UFormField>
              <p
                v-if="optionsLoaded && deckItems.length === 0"
                class="text-xs text-muted"
              >
                {{ options.source === 'shared' ? t('tournaments.decksDialog.pick.noneShared', { name: participant?.name ?? '' }) : t('tournaments.decksDialog.pick.none') }}
              </p>
              <p
                v-else
                class="text-xs text-muted"
              >
                {{ options.source === 'shared' ? t('tournaments.decksDialog.pick.sharedHint', { name: participant?.name ?? '' }) : t('tournaments.decksDialog.pick.ownHint') }}
              </p>
            </section>

            <!-- A deck that is not in the app yet (a guest's, on paper): photos, speech or a list make one. -->
            <section class="space-y-2">
              <UButton
                icon="i-lucide-camera"
                color="neutral"
                variant="outline"
                :label="t('tournaments.decksDialog.import.button')"
                :disabled="busy"
                @click="emit('importDeck')"
              />
              <p class="text-xs text-muted">
                {{ t('tournaments.decksDialog.import.hint') }}
              </p>
            </section>

            <section>
              <UFormField :label="t('tournaments.decksDialog.name.label')">
                <div class="flex items-center gap-2">
                  <UInput
                    v-model="typedName"
                    :maxlength="DECK_NAME_MAX_LENGTH"
                    :disabled="busy"
                    :placeholder="t('tournaments.decksDialog.name.placeholder')"
                    :aria-label="t('tournaments.decksDialog.name.label')"
                    class="min-w-0 flex-1"
                    @keydown.enter.prevent="typedName.trim() && add({ name: typedName })"
                  />
                  <UButton
                    :label="t('tournaments.decksDialog.name.add')"
                    :loading="busy"
                    :disabled="typedName.trim() === ''"
                    @click="add({ name: typedName })"
                  />
                </div>
              </UFormField>
            </section>
          </template>
        </template>

        <p
          v-if="errorMessage"
          role="alert"
          class="text-sm text-error"
        >
          {{ errorMessage }}
        </p>

        <div class="flex justify-end">
          <UButton
            color="neutral"
            variant="outline"
            :label="t('tournaments.decksDialog.done')"
            @click="() => { openProxy = false }"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
