# ORIVÈA commerce-integratie

De Cloudflare Pages Functions vormen het beveiligde transactielogboek. Content Studio haalt niet-bevestigde events periodiek op en schrijft ze idempotent naar de operationele SQLite-database. Daardoor blijft checkout werken wanneer de lokale Content Studio tijdelijk offline is.

## Cloudflare-configuratie

- D1-binding `SCENT_CLUB_DB` (bestaand), met aanvullend `data/commerce-schema.sql`.
- Secret `CONTENT_STUDIO_SYNC_SECRET`: een lange willekeurige waarde.
- Optioneel `CONTENT_STUDIO_URL`: publiek bereikbare Content Studio URL voor directe aflevering.
- Secret `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` en `PAYPAL_ENVIRONMENT` blijven uitsluitend server-side.

Voer na iedere wijziging aan `products.js` ook `npm run generate:commerce-catalog` uit. Dit maakt de servercatalogus waarmee prijzen en varianten worden gevalideerd.

## Content Studio-configuratie

- `WEBSHOP_SYNC_URL=https://orivea.nl`
- `WEBSHOP_SYNC_SECRET`: exact gelijk aan `CONTENT_STUDIO_SYNC_SECRET`.
- `WORKSPACE_WEBHOOK_SECRET`: mag dezelfde waarde zijn wanneer directe webhooklevering wordt gebruikt.

De webshop bewaart `order_created`, `payment_completed`, annuleringen, nieuwsbriefvoorkeuren en Scent Club-aanvragen in `commerce_outbox`. Content Studio bevestigt verwerking via `/api/sync/ack`.
