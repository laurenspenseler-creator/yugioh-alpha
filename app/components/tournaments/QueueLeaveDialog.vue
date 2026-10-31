<script setup lang="ts">
import type { DropOption } from '~~/shared/tournament-duels'
import type { TournamentDetail } from '~~/shared/tournaments'

// A player leaves a duel-queue tournament (ADR 0042), or the organizer decides later for one who left undecided.
// Option A strikes every duel of the player (as if they had never been there), option B keeps the played ones. Only
// the options after which everybody can still end with the same number of duels are offered.

const props = defineProps<{
  tournament: TournamentDetail
  participantId: string | null
  /** 'leave' = a player is leaving now; 'decide' = they left earlier and the organizer decides now. */
  mode: 'leave' | 'decide'
}>()

const emit = defineEmits<{
  updated: [detail: TournamentDetail]
}>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const apiError = useApiError()

const participant = computed(() => props.tournament.participants.find(candidate => candidate.id === props.participantId) ?? null)
const choices = computed(() => (props.participantId ? props.tournament.queue?.dropOptions[props.participantId] : undefined) ?? { A: false, B: false })
const inDuel = computed(() => props.participantId !== null
  && (props.tournament.queue?.duels ?? []).some(duel => duel.status === 'running'
    && (duel.participantAId === props.participantId || duel.participantBId === props.participantId)))

// 'later' = decide afterwards; only for a player who leaves now.
const selected = ref<DropOption | 'later'>('A')
const saving = ref(false)
const errorMessage = ref('')

watch(open, (isOpen) => {
  if (isOpen) {
    errorMessage.value = ''
    selected.value = choices.value.A ? 'A' : choices.value.B ? 'B' : props.mode === 'leave' ? 'later' : 'A'
  }
})

const canSubmit = computed(() => {
  if (inDuel.value && props.mode === 'leave') {
    return false
  }
  return selected.value === 'later' ? props.mode === 'leave' : choices.value[selected.value]
})

async function submit() {
  if (!participant.value) {
    return
  }
  saving.value = true
  errorMessage.value = ''
  try {
    const base = `/api/tournaments/${props.tournament.id}/participants/${participant.value.id}`
    const detail = props.mode === 'leave'
      ? await $fetch<TournamentDetail>(`${base}/leave`, {
          method: 'POST',
          body: { kind: 'dropped', option: selected.value === 'later' ? null : selected.value },
        })
      : await $fetch<TournamentDetail>(`${base}/decide`, { method: 'POST', body: { option: selected.value } })
    emit('updated', detail)
    open.value = false
  }
  catch (error) {
    errorMessage.value = apiError(error, 'tournaments.queue.leave.failed')
  }
  finally {
    saving.value = false
  }
}

const OPTIONS: DropOption[] = ['A', 'B']
</script>

<template>
  <UModal
    v-model:open="open"
    :title="mode === 'leave' ? t('tournaments.queue.leave.title', { name: participant?.name ?? '' }) : t('tournaments.queue.leave.decideTitle', { name: participant?.name ?? '' })"
  >
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-toned">
          {{ t('tournaments.queue.leave.intro', { name: participant?.name ?? '' }) }}
        </p>

        <p
          v-if="inDuel && mode === 'leave'"
          role="alert"
          class="text-sm text-error"
        >
          {{ t('tournaments.queue.leave.inDuel') }}
        </p>

        <div class="space-y-2">
          <label
            v-for="option in OPTIONS"
            :key="option"
            class="flex cursor-pointer items-start gap-3 rounded-lg border border-default p-3"
            :class="[choices[option] ? '' : 'cursor-not-allowed opacity-60', selected === option ? 'border-primary bg-primary/5' : '']"
          >
            <input
              v-model="selected"
              type="radio"
              name="queue-leave-option"
              class="mt-1"
              :value="option"
              :disabled="!choices[option]"
            >
            <span class="space-y-0.5">
              <span class="block text-sm font-medium text-highlighted">{{ t(`tournaments.queue.leave.option${option}.label`) }}</span>
              <span class="block text-xs text-muted">{{ t(`tournaments.queue.leave.option${option}.description`) }}</span>
              <span
                v-if="!choices[option]"
                class="block text-xs text-warning"
              >{{ t('tournaments.queue.leave.unavailable') }}</span>
            </span>
          </label>

          <label
            v-if="mode === 'leave'"
            class="flex cursor-pointer items-start gap-3 rounded-lg border border-default p-3"
            :class="selected === 'later' ? 'border-primary bg-primary/5' : ''"
          >
            <input
              v-model="selected"
              type="radio"
              name="queue-leave-option"
              class="mt-1"
              value="later"
            >
            <span class="space-y-0.5">
              <span class="block text-sm font-medium text-highlighted">{{ t('tournaments.queue.leave.later') }}</span>
              <span class="block text-xs text-muted">{{ t('tournaments.queue.leave.laterHint') }}</span>
            </span>
          </label>
        </div>

        <p
          v-if="errorMessage"
          role="alert"
          class="text-sm text-error"
        >
          {{ errorMessage }}
        </p>

        <div class="flex justify-end gap-2">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            :label="t('tournaments.queue.leave.cancel')"
            @click="open = false"
          />
          <UButton
            :label="mode === 'leave' ? t('tournaments.queue.leave.submit') : t('tournaments.queue.leave.submitDecide')"
            :loading="saving"
            :disabled="!canSubmit"
            @click="submit"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
