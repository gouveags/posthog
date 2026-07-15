import { connect, kea, path } from 'kea'
import { urlToAction } from 'kea-router'

import { urls } from 'scenes/urls'

import { composerSeedLogic } from 'products/posthog_ai/frontend/api/logics'

import type { phaiAiComposerSeedLogicType } from './phaiAiComposerSeedLogicType'

/**
 * Forwards the existing `/ai?ask=...` deep link into the new task composer. This logic is mounted only while
 * the new PostHog AI view is rendered, leaving the legacy `maxLogic` query handling unchanged.
 */
export const phaiAiComposerSeedLogic = kea<phaiAiComposerSeedLogicType>([
    path(['scenes', 'max', 'phaiAiComposerSeedLogic']),

    connect({
        actions: [composerSeedLogic, ['setSeed']],
    }),

    urlToAction(({ actions }) => ({
        [urls.ai()]: (_, search) => {
            if (search.ask && !search.chat) {
                actions.setSeed({ prompt: String(search.ask), autoSubmit: true })
            }
        },
    })),
])
