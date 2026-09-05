import html from "./index.html";
import css from "./styles.css";
import script from "./panel.client.js";

export default {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const asset = { "/": [html, "text/html"], "/styles.css": [css, "text/css"], "/panel.js": [script, "text/javascript"] }[path];
    if (!asset || !["GET", "HEAD"].includes(request.method)) return new Response("Not found", { status: 404 });
    return new Response(request.method === "HEAD" ? null : asset[0], { headers: {
      "Content-Type": asset[1] + "; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' https://charmiptv-account-api.agentleakage.workers.dev; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
    } });
  },
};
