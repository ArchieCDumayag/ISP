# Messenger Auto-Reply Bot

This app includes a simple Facebook Messenger webhook that replies with the customer portal login link. It does not send bill amounts, account balances, or passwords through Messenger.

## Server Settings

Add these to `.env`, then restart the server:

```env
MESSENGER_VERIFY_TOKEN=generate-a-random-secret-token
MESSENGER_PAGE_ACCESS_TOKEN=paste-your-page-access-token
MESSENGER_APP_SECRET=paste-your-meta-app-secret
MESSENGER_GRAPH_API_VERSION=v25.0
MESSENGER_PORTAL_URL=https://your-domain.com/customer-login.html
```

Optional custom reply:

```env
MESSENGER_AUTO_REPLY_TEXT=Hi! View your bill here: {portalUrl}
```

Use a public HTTPS domain for the app. Meta will not verify a `localhost` callback URL.

## Meta Setup

1. Open Meta for Developers and create or open your app.
2. Add the Messenger product.
3. In Messenger settings, configure Webhooks:
   - Callback URL: `https://your-domain.com/webhooks/messenger`
   - Verify Token: the exact value from `MESSENGER_VERIFY_TOKEN`
4. Subscribe the webhook to the Page events for `messages` and `messaging_postbacks`.
5. Generate or add a Page access token, then save it as `MESSENGER_PAGE_ACCESS_TOKEN`.
6. Restart the billing server.
7. Message the Facebook Page with `bill` and confirm the bot replies with the customer portal link.

While the Meta app is still in development mode, test with accounts that are admins, developers, or testers of the app/Page. For real customer messages, set the app live and make sure the app has the required Messenger permissions, especially `pages_messaging`.

## Customer Message

Default bot reply:

```text
Hi! Para makita ang bill, balance, due date, payments, at e-statement mo, mag-login dito:
https://your-domain.com/customer-login.html

Gamitin ang Client ID/Username o Account Number at password na ibinigay sa iyo.

Reminder: Huwag isend dito ang password mo. Kung kailangan ng tulong, maghintay lang sa admin reply.
```

## Webhook Endpoint

- `GET /webhooks/messenger` handles Meta webhook verification.
- `POST /webhooks/messenger` receives Messenger events and sends the auto-reply.

If `MESSENGER_APP_SECRET` is set, the webhook verifies Meta's `x-hub-signature-256` header before accepting POST requests.
