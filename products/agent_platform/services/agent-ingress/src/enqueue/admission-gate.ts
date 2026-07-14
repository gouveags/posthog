/**
 * Edge admission wiring. Builds an `AdmissionService` for a revision from the
 * ingress's identity stores + the revision's declared providers/env. Returns
 * null only when the agent declares no authoritative provider (passthrough).
 * The stores are required — the ingress always wires them — so a null return is
 * unambiguously "passthrough", never "misconfigured" (which previously fell
 * open). Shared by the Slack trigger, the chat trigger (resolve), and the
 * `/link/:provider/callback` route (complete).
 */

import {
    AdmissionService,
    buildIdentityRegistry,
    type AgentRevision,
    type EncryptedFields,
    type HttpFetcher,
    type IdentityCredentialStore,
    type IdentityLinkStateStore,
    type IdentityStore,
    type SessionPrincipal,
    type TransportBindingStore,
    type TransportClaim,
} from '@posthog/agent-shared'

export interface AdmissionDepsBundle {
    identities: IdentityStore
    identityLinks: IdentityLinkStateStore
    identityCredentials: IdentityCredentialStore
    transportBindings: TransportBindingStore
    envEncryption: EncryptedFields
    http: HttpFetcher
    posthogApiBaseUrl?: string
    publicBaseUrl?: string
}

/** The ingress's own OAuth callback URL for a provider. */
export function admissionRedirectUri(publicBaseUrl: string | undefined, providerId: string): string {
    const base = (publicBaseUrl ?? 'https://agents.posthog.com').replace(/\/+$/, '')
    return `${base}/link/${providerId}/callback`
}

/**
 * Build the transport claim for an authenticated HTTP (chat) principal.
 *
 * Only user-shaped principals (posthog, jwt) carry a stable per-sender subject
 * admission can bind a canonical identity to. Machine principals
 * (shared_secret, posthog_internal, service) and the public opt-in anonymous
 * principal have no human behind the transport to resolve — returning null
 * makes the chat trigger FAIL CLOSED (403, nothing enqueued): an authoritative
 * provider means "verified human identity required", and a coexisting
 * public/shared-secret/internal auth mode must not silently void that gate.
 * (Minting a claim instead would be worse — a claim keyed on a shared
 * principal would let one secret holder bind an identity every other holder
 * is then admitted as.)
 *
 * `transport` deliberately equals the principal kind (`posthog` / `jwt`), so
 * the transport AgentUser admission creates is the SAME row
 * `agentUserIdForPrincipal` maps the principal to — bindings and per-asker
 * secondary credentials hang off one AgentUser, not two parallel ones.
 *
 * The request bearer rides on the claim ONLY when it is a credential FOR the
 * authoritative provider (a PostHog bearer on a `kind: posthog` provider).
 * Attaching an unrelated token (a JWT, or a PostHog bearer under an oauth2
 * authoritative provider) would trip admission's freshness rule — a
 * present-but-invalid bearer forces re-auth without ever consulting the
 * durable binding, locking out users who already linked.
 */
export function httpTransportClaim(
    principal: SessionPrincipal,
    bearer: string | null,
    revision: AgentRevision
): TransportClaim | null {
    switch (principal.kind) {
        case 'posthog': {
            const authoritative = revision.spec.identity_providers.find(
                (p) => p.id === revision.spec.authoritative_provider
            )
            const bearerIsProviderCredential = authoritative?.kind === 'posthog'
            return {
                transport: 'posthog',
                subjectId: principal.user_id,
                ...(bearer && bearerIsProviderCredential ? { bearer: { token: bearer } } : {}),
                ...(principal.email ? { attributes: { email: principal.email } } : {}),
            }
        }
        case 'jwt':
            // The JWT proves the transport claim, not the authoritative identity —
            // it is never attached as a bearer.
            return { transport: 'jwt', subjectId: principal.sub }
        default:
            return null
    }
}

/** Build an `AdmissionService` for a revision, or null when the agent declares
 *  no authoritative provider (passthrough). */
export function buildAdmission(deps: AdmissionDepsBundle, revision: AgentRevision): AdmissionService | null {
    if (!revision.spec.authoritative_provider) {
        return null
    }
    const env = deps.envEncryption.decryptJsonEnv(revision.encrypted_env)
    const registry = buildIdentityRegistry(revision.spec.identity_providers, {
        links: deps.identityLinks,
        credentials: deps.identityCredentials,
        http: deps.http,
        secret: (name) => env[name],
        posthogBaseUrl: deps.posthogApiBaseUrl,
    })
    return new AdmissionService({
        registry,
        identities: deps.identities,
        bindings: deps.transportBindings,
        credentials: deps.identityCredentials,
        redirectUriFor: (p) => admissionRedirectUri(deps.publicBaseUrl, p),
    })
}
