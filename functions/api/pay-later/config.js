import { json } from "../paypal/_commerce.js";
import { payLaterConfig, publicPayLaterConfig } from "./_shared.js";

export async function onRequestGet({ env }) {
  return json(publicPayLaterConfig(payLaterConfig(env)));
}
