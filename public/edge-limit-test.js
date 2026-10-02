const button = document.getElementById('start');
const output = document.getElementById('result');
const previewHost = /^openscienceplatform-(?!vercel\.app)[a-z0-9-]+-apumas-projects\.vercel\.app$/;
function assert(condition, message) { if (!condition) throw new Error(message); }
button.addEventListener('click', async () => {
  button.disabled = true;
  const statuses = {};
  let sent = 0;
  let throttled = false;
  let failure;
  const regions = new Set();
  try {
    assert(previewHost.test(location.hostname), 'This check is restricted to the isolated preview deployment.');
    const second = new Date().getUTCSeconds();
    if (second > 15) {
      const waitMs = (60 - second) * 1000 + 250;
      output.textContent = 'Waiting ' + Math.ceil(waitMs / 1000) + ' seconds for a fresh rate-limit window…';
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    const started = Date.now();
    async function read(path) {
      const res = await fetch(path, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      const body = await res.text();
      const region = res.headers.get('x-vercel-id')?.split('::')[0];
      if (region) regions.add(region);
      return { res, body };
    }
    const first = await read('/api/health');
    sent++;
    statuses[first.res.status] = 1;
    assert(first.res.status === 503 && JSON.parse(first.body).error === 'service_unavailable', 'The preview must refuse database startup before this check can run. Sign-in redirects cannot test the project firewall.');
    output.textContent = 'Preview storage is absent. Checking the API budget…';
    await Promise.all(Array.from({length: 8}, async () => {
      while (!throttled && !failure && sent < 144 && Date.now() - started < 35000) {
        sent++;
        try {
          const {res, body} = await read('/api/health');
          statuses[res.status] = (statuses[res.status] ?? 0) + 1;
          if (res.status === 429) throttled = true;
          else assert(res.status === 503 && JSON.parse(body).error === 'service_unavailable', 'Unexpected response during preview health check: HTTP ' + res.status);
        } catch (error) { failure = error; }
      }
    }));
    if (failure) throw failure;
    assert(throttled, 'No edge HTTP 429 observed in the bounded preview run. Do not treat this as a pass.');
    assert(Date.now() - started < 35000, 'The check exceeded its timing bound.');
    const documentResponse = await read('/edge-limit-test.html');
    assert(documentResponse.res.status === 200, 'The non-API test page must remain readable after API throttling.');
    output.textContent = JSON.stringify({state: 'preview edge limit observed', origin: location.origin, sent, statuses, regions: [...regions], elapsedMs: Date.now() - started, staticDocumentStatus: documentResponse.res.status, note: 'GET requests only. API startup refused absent preview storage; no database operations, claims or submissions occurred. The result does not establish a global traffic cap.'}, null, 2);
  } catch (error) {
    output.textContent = JSON.stringify({state: 'failed', sent, statuses, regions: [...regions], error: error.message}, null, 2);
  }
});
