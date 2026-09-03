# PRD — Continental Content: Non-Functional Requirements & System Design

**Status:** Draft v2
**Scope:** Engineering/architecture requirements only.

---

## 1. Stack (Decided)
- **Frontend:** Next.js (App Router). 3D scenes render as client-only components (`ssr: false`).
- **Backend:** Node.js + Express, REST API, organized one module per domain (`auth/`, `rooms/`, `subscriptions/`, `merch/`).
- **Database:** PostgreSQL (users, subscriptions, orders, service requests).

---

## 2. System Design
```
CDN / Edge (static assets, models, textures, video, cache)
        │
Frontend (Next.js)  ◄──►  Auth Provider
        │ REST (HTTPS)
API Layer (Node.js + Express)
 - Auth/session verification
 - Subscription/entitlement checks
 - Service-request submissions
 - Merch/catalog + checkout
 - Signed URL issuance for video
        │
   ┌────┼────────┬─────────────┐
Postgres        Redis        Payments (Stripe)
(users, orders, (cache,      (subscriptions + merch)
 requests)       sessions,
                 rate-limit)
        │
Object storage (models/videos: S3/R2/Cloudinary)
```
- Stateless API layer — any instance can serve any request → horizontal autoscaling.
- Media/static assets served via CDN, never through the app server.
- Video/premium assets delivered only via short-lived signed URLs, never public paths.

---

## 3. Scalability
- Stateless API tier behind a load balancer; scale by adding replicas, not redesigning.
- Read-heavy endpoints (catalog, entitlement checks) cached so DB load doesn't scale linearly with traffic.
- Media delivery scales via CDN, decoupled from API capacity.
- Target: support growth from hundreds to 100k+ monthly visitors by adding cache/CDN/API capacity only.

---

## 4. Handling Multiple Concurrent Users
- No shared mutable state between users — each visitor has an independent client session.
- Concurrency risk concentrated in: checkout/payment races, entitlement checks, form submissions.
  - Checkout: idempotency keys on payment requests; order/entitlement state driven by webhooks, never trusted from the client.
  - Entitlement checks: cached per-user with short TTL, invalidated on webhook events, to avoid hammering the DB per request.
  - Form submissions: rate-limited per IP/user to prevent spam/abuse.
- Load-test bursts of concurrent first-time loads; degrade gracefully (lower-res fallback) rather than fail.

---

## 5. Caching Strategy
| Layer | What's cached | TTL/Invalidation |
|---|---|---|
| CDN | Static assets, models, textures, images, compiled JS/CSS | Immutable, content-hashed filenames |
| CDN | Video segments | Long TTL; access gated by short-lived signed URLs |
| Redis | User subscription/entitlement status | Short TTL, invalidated on payment webhook |
| Redis | Catalog/listing responses | Minutes-scale TTL, invalidated on admin update |
| Browser | Downloaded static assets | Cached client-side so repeat visits skip re-download |
| API | Rate-limit counters | Redis, sliding window |

---

## 6. Security
- Authentication/session: delegate to managed auth provider; never store raw passwords; short-lived access tokens + refresh tokens over HTTPS-only, `HttpOnly`, `Secure`, `SameSite` cookies.
- Authorization re-checked server-side on every gated route — client-side UI gating is never treated as a security boundary.
- Signed URLs with short expiry for all premium content delivery.
- Payments: card data handled entirely by the payment processor (PCI scope); webhook signatures verified; webhook handling idempotent.
- Input validation: all form submissions validated/sanitized server-side and rate-limited.
- Transport: HTTPS everywhere, HSTS enabled.
- Secrets: environment-based secret management, never shipped in the client bundle.
- Dependency hygiene: lockfile + periodic vulnerability scanning.

---

## 7. Reliability
- Health checks + autoscaling on the API tier; multi-AZ DB where budget allows.
- Payment webhook processing idempotent and retried on failure (webhooks can arrive more than once or out of order).
- Graceful degradation on asset load failure rather than a blank/broken page.
- Automated backups for the database (orders, subscriptions, requests are business-critical).
- Monitoring/alerting on: API error rate, checkout failure rate, access-check failures, asset load failures/timeouts.

---

## 8. Performance
- Aggressive asset budget for 3D/media content: compression, texture optimization, level-of-detail for mobile.
- Progressive loading: lightest scene loads first and is interactive before heavier content streams in.
- Target frame budget: 60fps on modern desktop/mobile GPUs, with an automatic quality tier based on detected device capability.
- Core Web Vitals still matter for the initial shell (HTML/JS before heavy content boots).

---

*Living document — update as architecture decisions are finalized.*
