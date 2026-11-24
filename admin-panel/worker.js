import banner from "./assets/medialab-banner.png";
import wordmark from "./assets/medialab-wordmark.png";
import html from "./index.html";
import css from "./styles.css";
import script from "./panel.client.js";
import botScript from './bot.client.js';
import appScript from './app-settings.client.js';

export default {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const asset = { "/medialab-banner.png": [banner,"image/png"], "/medialab-wordmark.png": [wordmark,"image/png"], "/": [html, "text/html"], "/styles.css": [css, "text/css"], "/panel.js": [script, "text/javascript"], '/bot.js':[botScript,'text/javascript'], '/app-settings.js':[appScript,'text/javascript'] }[path];
    if (!asset || !["GET", "HEAD"].includes(request.method)) return new Response("Not found", { status: 404 });
    return new Response(request.method === "HEAD" ? null : asset[0], { headers: {
      "Content-Type": asset[1] + (asset[1].startsWith("text/") ? "; charset=utf-8" : ""),
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' https://charmiptv-account-api.agentleakage.workers.dev; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
    } });
  },
};
