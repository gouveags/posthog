import { actions, afterMount, kea, path, reducers } from 'kea'
import { loaders } from 'kea-loaders'

import { lemonToast } from '@posthog/lemon-ui'

import api, { CountedPaginatedResponse } from 'lib/api'

import type { suppressionListLogicType } from './suppressionListLogicType'
import type { SuppressionEntry } from './types'

export type { SuppressionEntry }

export type PaginatedSuppressions = CountedPaginatedResponse<SuppressionEntry>

const EMPTY_SUPPRESSIONS: PaginatedSuppressions = { count: 0, next: null, previous: null, results: [] }

export const suppressionListLogic = kea<suppressionListLogicType>([
    path(['products', 'workflows', 'frontend', 'Suppression', 'suppressionListLogic']),
    actions({
        setCurrentPage: (page: number) => ({ page }),
        loadNextPage: true,
        loadPreviousPage: true,
        setShowAddModal: (show: boolean) => ({ show }),
        setNewIdentifier: (identifier: string) => ({ identifier }),
    }),
    reducers({
        currentPage: [
            1,
            {
                setCurrentPage: (_, { page }) => page,
                loadSuppressionsSuccess: () => 1,
                loadNextPageSuccess: (state) => state + 1,
                loadPreviousPageSuccess: (state) => Math.max(1, state - 1),
            },
        ],
        showAddModal: [
            false,
            {
                setShowAddModal: (_, { show }) => show,
                addSuppressionSuccess: () => false,
            },
        ],
        newIdentifier: [
            '',
            {
                setNewIdentifier: (_, { identifier }) => identifier,
                addSuppressionSuccess: () => '',
                setShowAddModal: (state, { show }) => (show ? state : ''),
            },
        ],
    }),
    loaders(({ values, actions }) => ({
        suppressions: {
            __default: EMPTY_SUPPRESSIONS,
            loadSuppressions: async (): Promise<PaginatedSuppressions> => {
                try {
                    return await api.messaging.getSuppressions(1)
                } catch {
                    lemonToast.error('Failed to load suppression list')
                    return EMPTY_SUPPRESSIONS
                }
            },
            loadNextPage: async (): Promise<PaginatedSuppressions> => {
                try {
                    return await api.messaging.getSuppressions(values.currentPage + 1)
                } catch {
                    lemonToast.error('Failed to load next page')
                    return values.suppressions
                }
            },
            loadPreviousPage: async (): Promise<PaginatedSuppressions> => {
                try {
                    return await api.messaging.getSuppressions(Math.max(1, values.currentPage - 1))
                } catch {
                    lemonToast.error('Failed to load previous page')
                    return values.suppressions
                }
            },
        },
        addSuppression: {
            __default: null as SuppressionEntry | null,
            addSuppression: async (identifier: string): Promise<SuppressionEntry> => {
                try {
                    const result = await api.messaging.addSuppression(identifier)
                    lemonToast.success(`${identifier} added to suppression list`)
                    actions.loadSuppressions()
                    return result
                } catch (e) {
                    lemonToast.error('Failed to add to suppression list')
                    throw e
                }
            },
        },
        removeSuppression: {
            __default: null as string | null,
            removeSuppression: async (identifier: string): Promise<string> => {
                try {
                    await api.messaging.removeSuppression(identifier)
                    lemonToast.success(`${identifier} removed from suppression list`)
                    actions.loadSuppressions()
                    return identifier
                } catch (e) {
                    lemonToast.error('Failed to remove from suppression list')
                    throw e
                }
            },
        },
    })),
    afterMount(({ actions }) => {
        actions.loadSuppressions()
    }),
])
