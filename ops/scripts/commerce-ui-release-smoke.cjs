// Read-only frontend asset verification from the platform container's compose network.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const expected = {
  admin: '282be38fab1866472c18b0cb8034979f424b27d227bcc751441b68279834eb94',
  portal: 'b7e089f8826c00609737abc089d756dd43b1e80c5f64aacc7691ca2912521676',
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
