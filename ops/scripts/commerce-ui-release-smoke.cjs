// Read-only frontend asset verification from the platform container's compose network.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const expected = {
  admin: 'cca7d536f05b142a86b7270ad64405be014f5d2e63152f42c686d3fa2774ff1d',
  portal: '5fd7ee0414c0df462fbf192242dea6da4b2eab4ec0f85e7cfa2aa2d1d7a4552c',
};
(async () => {
  for (const [service, expectedCss] of Object.entries(expected)) {
    const base = `http://${service}`;
    const page = await fetch(base, { signal: AbortSignal.timeout(30000) });
    assert.equal(page.status, 200, `${service} HTML unavailable`);
    const html = await page.text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:css|js))"/g)].map(m => m[1]);
    assert.ok(assets.length > 1, `${service} missing production assets`);
    let cssChecked = false;
    for (const asset of assets) {
      const response = await fetch(new URL(asset, base), { signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, 200, `${service} asset ${asset} unavailable`);
      if (asset.endsWith('.css')) {
        const sha256 = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
        assert.equal(sha256, expectedCss, `${service} CSS differs from validated build`);
        console.log('validated CSS:', JSON.stringify({ service, asset, sha256 }));
        cssChecked = true;
      } else {
        assert.match(response.headers.get('content-type') || '', /javascript/, `${service} JS asset is not JavaScript`);
        await response.body?.cancel();
      }
    }
    assert.ok(cssChecked, `${service} has no CSS`);
    console.log('frontend assets:', JSON.stringify({ service, htmlStatus: page.status, assets: assets.length }));
  }
  console.log('PASS: admin and portal HTML/assets; both CSS files match validated builds');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
