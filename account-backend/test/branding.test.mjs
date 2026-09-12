import test from 'node:test';
import assert from 'node:assert/strict';
import { brandText, brandedContent } from '../branding.js';
import { fixture } from './fixture.mjs';

test('saved bot branding updates display copy while retaining links, handles and history', async () => {
  const raw = 'CharmIPTV / CHARM IPTV: https://charmiptv.example/CharmIPTV @CharmIPTV_help';
  assert.equal(brandText(raw), 'Charming MediaLab / Charming MediaLab: https://charmiptv.example/CharmIPTV @CharmIPTV_help');
  const row = { body: raw, revision: 8, enabled: 1 };
  assert.equal(brandedContent(row).revision, 8);
  assert.equal(row.body, raw);
  assert.equal(brandText('Your custom support message'), 'Your custom support message');
  const f = fixture();
  await f.request('/admin/bot/content/whats_new', { method: 'PUT', token: f.ownerToken,
    body: { body: raw, enabled: true, revision: 0 } });
  const displayed = await f.request('/admin/bot/content', { token: f.ownerToken });
  assert.equal(displayed.body.content.find(c => c.key === 'whats_new').body, brandText(raw));
  assert.equal(f.db.prepare("SELECT body FROM bot_content WHERE key='whats_new'").get().body, raw);
});
