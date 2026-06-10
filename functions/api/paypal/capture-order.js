const PAYPAL_API = {
  live: "https://api-m.paypal.com",
  sandbox: "https://api-m.sandbox.paypal.com"
};

function paypalBase(env) {
  return PAYPAL_API[(env.PAYPAL_ENVIRONMENT || "live").toLowerCase()] || PAYPAL_API.live;
}

async function accessToken(env) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new Error("PayPal environment variables ontbreken");
  }
  const credentials = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const response = await fetch(`${paypalBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  if (!response.ok) throw new Error("PayPal access token kon niet worden opgehaald");
  const data = await response.json();
  return data.access_token;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const orderId = String(body.orderId || "").trim();
    if (!/^[A-Z0-9-]+$/i.test(orderId)) return json({ error: "Ongeldig order ID" }, 400);
    const token = await accessToken(env);
    const response = await fetch(`${paypalBase(env)}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": crypto.randomUUID()
      }
    });
    const data = await response.json();
    return json(data, response.ok ? 200 : response.status);
  } catch (error) {
    return json({ error: error.message || "PayPal order capturen mislukt" }, 500);
  }
}
