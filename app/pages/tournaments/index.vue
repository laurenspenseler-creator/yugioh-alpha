<script setup lang="ts">
import { TOURNAMENT_NAME_MAX_LENGTH } from '~~/shared/tournaments'
import type { TournamentListItem, TournamentListResponse, TournamentStatus } from '~~/shared/tournaments'

const PAGE_SIZE = 20

usePageTitle('tournaments.list.title')

const { t, n } = useI18n()
const count = useCount()
const { formatName } = useFormatLabel()
const apiError = useApiError()
const { confirm } = useConfirm()

type RoleTab = 'organizer' | 'participant'
type StatusFilter = 'active' | 'finished'

// Two independent axes instead of three tabs that used to mix role and
// status (#32 in the UX review): a role tab picks "Meine Turniere" vs.
// "Teilnahmen", a separate toggle picks "Aktiv" vs. "Abgeschlossen". Neither
// hardcodes `status: active` behind the role tabs anymore, so an organizer's
// own finished tournament stays reachable under "Meine Turniere" +
// "Abgeschlossen" instead of vanishing.
const role = ref<RoleTab>('organizer')
const statusFilter = ref<StatusFilter>('active')
const page = ref(1)

watch([role, statusFilter], () => {
  page.value = 1
})

const listQuery = computed(() => ({
  role: role.value,
  status: statusFilter.value,
  page: page.value,
  pageSize: PAGE_SIZE,
}))

const { data, pending, refresh } = await useFetch<TournamentListResponse>('/api/tournaments', {
  query: listQuery,
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE }),
  watch: [listQuery],
})

// Cheap, count-only fetch for the tab the user isn't currently looking at,
// purely to label it ("Teilnahmen (1)") and to detect the "my tournaments is
// empty but I do have participations" case for the hint below.
const otherRole = computed<RoleTab>(() => (role.value === 'organizer' ? 'participant' : 'organizer'))
const otherRoleQuery = computed(() => ({
  role: otherRole.value,
  status: statusFilter.value,
  page: 1,
  pageSize: 1,
}))

const { data: otherRoleData, refresh: refreshOtherRole } = await useFetch<TournamentListResponse>('/api/tournaments', {
  query: otherRoleQuery,
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ items: [], total: 0, page: 1, pageSize: 1 }),
  watch: [otherRoleQuery],
})

const tournaments = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)
const otherRoleTotal = computed(() => otherRoleData.value?.total ?? 0)

function countFor(tabRole: RoleTab): number {
  return tabRole === role.value ? total.value : otherRoleTotal.value
}

function tabLabel(tabRole: RoleTab): string {
  return t(`tournaments.list.tabs.${tabRole}`, { count: n(countFor(tabRole), 'integer') })
}

function selectRole(next: RoleTab) {
  role.value = next
}

function selectStatus(next: StatusFilter) {
  statusFilter.value = next
}

const STATUS_COLORS: Record<TournamentStatus, 'info' | 'warning' | 'neutral'> = {
  registration: 'info',
  running: 'warning',
  finished: 'neutral',
}

function statusColor(status: TournamentStatus) {
  return STATUS_COLORS[status]
}

function roundLabel(item: TournamentListItem) {
  return t('tournaments.list.roundProgress', {
    current: n(item.roundCount, 'integer'),
    planned: item.plannedRounds === null ? '–' : n(item.plannedRounds, 'integer'),
  })
}

// The organizer tab is empty, but the user does have participations — the
// most common reason someone lands here confused (#31): they were invited
// and never noticed. Offer a direct switch instead of a dead end.
const showParticipantHint = computed(() =>
  role.value === 'organizer' && tournaments.value.length === 0 && otherRoleTotal.value > 0)

type EmptyStateKey = 'organizerActive' | 'organizerFinished' | 'participantActive' | 'participantFinished'

const emptyState = computed(() => {
  const key: EmptyStateKey = `${role.value}${statusFilter.value === 'active' ? 'Active' : 'Finished'}`
  return {
    heading: t(`tournaments.list.empty.${key}.title`),
    text: t(`tournaments.list.empty.${key}.text`),
    showButton: key === 'organizerActive',
  }
})

// --- The three dots of a card: rename and delete (organizer only, tester feedback round 9) ---------------------

const actionError = ref('')

function menuItems(item: TournamentListItem) {
  return [
    [{ label: t('tournaments.list.menu.rename'), icon: 'i-lucide-pencil', onSelect: () => openRename(item) }],
    [{ label: t('tournaments.list.menu.delete'), icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => deleteItem(item) }],
  ]
}

const renaming = ref<TournamentListItem | null>(null)
const renameValue = ref('')
const renameError = ref('')
const isRenaming = ref(false)
const isRenameOpen = computed({
  get: () => renaming.value !== null,
  set: (open: boolean) => {
    if (!open) {
      renaming.value = null
    }
  },
})

function openRename(item: TournamentListItem) {
  actionError.value = ''
  renameError.value = ''
  renameValue.value = item.name
  renaming.value = item
}

async function saveRename() {
  const item = renaming.value
  if (!item || isRenaming.value) {
    return
  }
  if (renameValue.value.trim() === item.name) {
    renaming.value = null
    return
  }

  isRenaming.value = true
  renameError.value = ''
  try {
    await $fetch(`/api/tournaments/${item.id}`, { method: 'PATCH', body: { name: renameValue.value } })
    renaming.value = null
    await refresh()
  }
  catch (error) {
    renameError.value = apiError(error, 'tournaments.list.errors.renameFailed')
  }
  finally {
    isRenaming.value = false
  }
}

async function deleteItem(item: TournamentListItem) {
  actionError.value = ''
  const confirmed = await confirm({
    title: t('tournaments.detail.confirm.delete.title'),
    description: t('tournaments.detail.confirm.delete.description', { name: item.name }),
  })
  if (!confirmed) {
    return
  }

  try {
    await $fetch(`/api/tournaments/${item.id}`, { method: 'DELETE' })
  }
  catch (error) {
    actionError.value = apiError(error, 'tournaments.list.errors.deleteFailed')
    return
  }
  // The last card of a later page is gone: go back one page instead of showing an empty one.
  if (tournaments.value.length === 1 && page.value > 1) {
    page.value -= 1
  }
  await Promise.all([refresh(), refreshOtherRole()])
}
</script>

<template>
  <div class="space-y-6">
    <LayoutPageHeader
      :title="t('tournaments.list.title')"
      :description="count('tournaments.list.count', total)"
    >
      <template #actions>
        <UButton
          icon="i-lucide-plus"
          :label="t('tournaments.list.newTournament')"
          to="/tournaments/new"
        />
      </template>
    </LayoutPageHeader>

    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex flex-wrap gap-2">
        <UButton
          :color="role === 'organizer' ? 'primary' : 'neutral'"
          :variant="role === 'organizer' ? 'subtle' : 'outline'"
          :aria-pressed="role === 'organizer'"
          :label="tabLabel('organizer')"
          @click="selectRole('organizer')"
        />
        <UButton
          :color="role === 'participant' ? 'primary' : 'neutral'"
          :variant="role === 'participant' ? 'subtle' : 'outline'"
          :aria-pressed="role === 'participant'"
          :label="tabLabel('participant')"
          @click="selectRole('participant')"
        />
      </div>

      <div class="flex flex-wrap gap-2">
        <UButton
          size="sm"
          :color="statusFilter === 'active' ? 'primary' : 'neutral'"
          :variant="statusFilter === 'active' ? 'subtle' : 'outline'"
          :aria-pressed="statusFilter === 'active'"
          :label="t('tournaments.list.filter.active')"
          @click="selectStatus('active')"
        />
        <UButton
          size="sm"
          :color="statusFilter === 'finished' ? 'primary' : 'neutral'"
          :variant="statusFilter === 'finished' ? 'subtle' : 'outline'"
          :aria-pressed="statusFilter === 'finished'"
          :label="t('tournaments.list.filter.finished')"
          @click="selectStatus('finished')"
        />
      </div>
    </div>

    <p
      v-if="actionError"
      class="text-sm text-error"
      role="alert"
    >
      {{ actionError }}
    </p>

    <div
      v-if="pending"
      class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      <USkeleton
        v-for="index in 3"
        :key="index"
        class="h-36 w-full"
      />
    </div>

    <LayoutEmptyState
      v-else-if="tournaments.length === 0"
      icon="i-lucide-trophy"
      :title="emptyState.heading"
      :description="emptyState.text"
    >
      <p
        v-if="showParticipantHint"
        class="mt-1 max-w-sm text-sm text-muted"
      >
        {{ count('tournaments.list.participationHint', otherRoleTotal) }}
      </p>
      <template
        v-if="showParticipantHint || emptyState.showButton"
        #actions
      >
        <UButton
          v-if="showParticipantHint"
          color="primary"
          variant="outline"
          :label="t('tournaments.list.showInvited')"
          @click="selectRole('participant')"
        />
        <UButton
          v-if="emptyState.showButton"
          icon="i-lucide-plus"
          :label="t('tournaments.list.newTournament')"
          to="/tournaments/new"
        />
      </template>
    </LayoutEmptyState>

    <ul
      v-else
      class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      <li
        v-for="item in tournaments"
        :key="item.id"
        class="panel relative flex flex-col p-4 transition-[box-shadow,border-color] duration-200 hover:border-primary/40 hover:shadow-lift"
        data-testid="tournament-card"
      >
        <!-- The options sit in the upper right corner of the card, where the name leaves room for them. -->
        <UDropdownMenu
          v-if="item.role === 'organizer'"
          :items="menuItems(item)"
          :content="{ align: 'end' }"
        >
          <UButton
            icon="i-lucide-ellipsis-vertical"
            color="neutral"
            variant="ghost"
            size="sm"
            class="absolute right-2 top-2"
            :aria-label="t('tournaments.list.menu.label')"
            data-testid="tournament-menu"
          />
        </UDropdownMenu>
        <NuxtLink
          :to="`/tournaments/${item.id}`"
          :class="item.role === 'organizer' ? 'block pr-8' : ''"
        >
          <h2 class="truncate text-base font-semibold text-highlighted hover:text-primary">
            {{ item.name }}
          </h2>
        </NuxtLink>
        <p
          v-if="item.description"
          class="mt-0.5 line-clamp-2 text-sm text-muted"
        >
          {{ item.description }}
        </p>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <UBadge
            :color="statusColor(item.status)"
            variant="subtle"
            :label="t(`tournaments.status.${item.status}`)"
          />
          <UBadge
            v-if="item.format"
            color="neutral"
            variant="subtle"
            icon="i-lucide-scroll-text"
            :label="formatName(item.format)"
          />
        </div>

        <dl class="mt-3 space-y-0.5 text-sm text-muted">
          <div>{{ count('tournaments.list.participantCount', item.participantCount) }}</div>
          <!-- A duel queue has no rounds of its own; its mode (Champions League is no pairing system of the classic kind) is what it is called. -->
          <div v-if="item.engine === 'classic'">
            {{ roundLabel(item) }}
          </div>
          <div>{{ item.engine === 'queue' && item.queueMode ? t(`tournaments.queue.mode.${item.queueMode}.label`) : t(`tournaments.pairingSystem.${item.pairingSystem}.label`) }}</div>
          <div v-if="role === 'participant'">
            {{ t('tournaments.list.organizedBy', { name: item.organizerName }) }}
          </div>
        </dl>
      </li>
    </ul>

    <div
      v-if="total > PAGE_SIZE"
      class="flex justify-end"
    >
      <UPagination
        v-model:page="page"
        :total="total"
        :items-per-page="PAGE_SIZE"
      />
    </div>

    <UModal
      v-model:open="isRenameOpen"
      :title="t('tournaments.list.rename.title')"
    >
      <template #body>
        <form
          class="space-y-4"
          @submit.prevent="saveRename"
        >
          <UFormField :label="t('tournaments.list.rename.name')">
            <UInput
              v-model="renameValue"
              class="w-full"
              :maxlength="TOURNAMENT_NAME_MAX_LENGTH"
              :aria-label="t('tournaments.list.rename.nameAriaLabel')"
              autofocus
            />
          </UFormField>
          <p
            v-if="renameError"
            class="text-sm text-error"
          >
            {{ renameError }}
          </p>
          <div class="flex justify-end gap-2">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              :label="t('common.cancel')"
              @click="() => { renaming = null }"
            />
            <UButton
              type="submit"
              :label="t('common.save')"
              :loading="isRenaming"
            />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
