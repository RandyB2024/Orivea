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

## ORIVÈA Achteraf Betalen

Deze methode wordt alleen zichtbaar als D1 beschikbaar is en `PAY_LATER_ENABLED=true`. Configureer server-side:

- `PAY_LATER_ENABLED=true`
- `PAY_LATER_DAYS=14`
- `PAY_LATER_MAX_ORDER_AMOUNT=100`
- `PAY_LATER_COUNTRY=NL`
- `PAY_LATER_MIN_AGE=18`
- `PAY_LATER_MANUAL_APPROVAL=true`
- `PAY_LATER_ACCOUNT_NAME` en `PAY_LATER_IBAN` voor betaalinstructies na verzending
- `PAY_LATER_REMINDER_1_DAYS=1` en `PAY_LATER_REMINDER_2_DAYS=7`

Content Studio gebruikt voor verzend- en herinneringsmails `PAY_LATER_EMAILJS_SERVICE_ID`, `PAY_LATER_EMAILJS_TEMPLATE_ID` en `PAY_LATER_EMAILJS_PUBLIC_KEY`. Bankgegevens blijven uitsluitend in de serveromgeving van Content Studio.

De betaaltermijn begint bij `Markeer als verzonden`; de vervaldatum is dat moment plus `PAY_LATER_DAYS`. Automatische incassokosten, rente en termijnbetalingen zijn niet geïmplementeerd. E-mailherinneringen blijven handmatig totdat een gecontroleerde servermailprovider is geconfigureerd.

TODO: controleer vóór structurele inzet welke Nederlandse/Wft-regels vanaf 20 november 2026 van toepassing zijn op merchant-provided deferred payment.
