import { router } from 'kea-router'

import { urls } from 'scenes/urls'

import { initKeaTests } from '~/test/init'

import { composerSeedLogic } from 'products/posthog_ai/frontend/api/logics'

import { phaiAiComposerSeedLogic } from './phaiAiComposerSeedLogic'

describe('phaiAiComposerSeedLogic', () => {
    let logic: ReturnType<typeof phaiAiComposerSeedLogic.build>
    let seedLogic: ReturnType<typeof composerSeedLogic.build>

    beforeEach(() => {
        initKeaTests()
        seedLogic = composerSeedLogic()
        seedLogic.mount()
    })

    afterEach(() => {
        logic?.unmount()
        seedLogic.unmount()
    })

    it('forwards the /ai ask query to the new composer as an auto-submit seed', () => {
        router.actions.push(urls.ai(undefined, 'Explain this dashboard'))

        logic = phaiAiComposerSeedLogic()
        logic.mount()

        expect(seedLogic.values.seed).toEqual({
            prompt: 'Explain this dashboard',
            autoSubmit: true,
        })
    })
})
