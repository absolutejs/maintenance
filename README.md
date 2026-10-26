# @absolutejs/maintenance

Explicit service availability for planned maintenance and developer-authorized holds. Framework-independent Web Request/Response functions plus self-contained light/dark HTML for a reverse proxy, so visitors still see a useful page when the app is stopped.

- `open`: normal routing.
- `maintenance`: HTTP 503 with Retry-After and an optional estimated return time. An estimate **never** reopens traffic automatically.
- `developer_hold`: HTTP 503 with a neutral contact-the-developer message. Only an explicitly authorized transition can activate or lift it. No billing, contract interpretation, telemetry, or error rule activates a hold.

`transitionAvailability` requires host authorization and an audit callback. It validates revisions and returns an immutable next state only after both succeed. The host must serialize and persist with compare-and-swap; this function alone is not a database transaction or authentication system. Do not expose it as an unauthenticated endpoint. Private reasons and actor IDs never enter public responses.

```ts
import { availabilityResponse } from '@absolutejs/maintenance';
const blocked = availabilityResponse(request, persistedState, {
  serviceName: 'Your service',
  contactUrl: 'https://example.com/support',
});
if (blocked) return blocked;
return application.fetch(request);
```

Validate persisted input using `parseAvailabilityState`; invalid state throws instead of opening traffic. Hosts should retain the last valid state and alert an operator on storage failure. There are no header, query, admin-path or health-path bypasses. Keep operational probes on a separate authenticated or loopback listener and explicitly preserve provider webhook delivery according to the application's retry contract.

`renderAvailabilityPage(state, publicConfig)` creates standalone HTML with no external fonts, scripts or image dependency. At a reverse proxy, return **503**, no-store, and Retry-After for maintenance; simply serving this file with 200 is incorrect. Never use the public page as the queue-draining mechanism: first block new work, fence claims, let active jobs finish, verify health, then explicitly reopen traffic. Keep rollback and an operator-controlled recovery path available.

This package does not terminate jobs, release credit holds, send messages, or decide whether a contract was breached. Deployments must not automatically lift a developer hold.
