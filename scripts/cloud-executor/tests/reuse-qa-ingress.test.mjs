import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverIngress } from '../../reuse-qa-ingress.mjs';

const page = 'https://example.test/game/';
const origin = 'https://alpha-123.trycloudflare.com';
function mock(files) {
  return async url => new Response(files[url] ?? '', { status: url in files ? 200 : 404 });
}
const files = body => ({ [page]: '<script src="/game/assets/app.js"></script>', 'https://example.test/game/assets/app.js': body });

test('discovers the single live origin from a same-origin asset', async () => {
  assert.equal(await discoverIngress(mock(files(`const endpoint="${origin}"`)), page), origin);
});
test('fails closed on missing or ambiguous origins', async () => {
  await assert.rejects(discoverIngress(mock(files('no endpoint')), page), /found 0/);
  await assert.rejects(discoverIngress(mock(files(`${origin} https://other.trycloudflare.com`)), page), /found 2/);
});
test('fails closed on missing, oversized, or off-origin assets', async () => {
  await assert.rejects(discoverIngress(mock({[page]: '<script src="https://other.test/app.js"></script>'}), page), /No deployed/);
  await assert.rejects(discoverIngress(mock({[page]: '<script src="/other/app.js"></script>'}), page), /No deployed/);
  await assert.rejects(discoverIngress(mock({[page]: '<script src="/game/app.js"></script>'}), page), /Cannot fetch/);
  await assert.rejects(discoverIngress(mock(files('x'.repeat(8 * 1024 * 1024 + 1))), page), /size limit/);
});
