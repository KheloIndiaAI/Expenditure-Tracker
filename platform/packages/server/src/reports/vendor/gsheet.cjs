'use strict';
/*
 * Live Google Sheets fetching.
 *
 * SAI Expenditure SYNC is shared "anyone with the link can view", which is
 * enough to download its Excel export with a plain HTTPS GET — no service
 * account, no OAuth, no API key. This is the same mechanism as File > Download
 * in the Sheets UI, just automated.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const exportUrl = sheetId => `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;

/** Follow redirects (the export URL always issues one) up to a small limit. */
function fetchBuffer(url, { timeoutMs = 20000, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const go = (u, redirectsLeft) => {
      const req = https.get(u, { timeout: timeoutMs }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error('Too many redirects fetching the Google Sheet.'));
          return go(res.headers.location, redirectsLeft - 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(
            `Google Sheets export returned HTTP ${res.statusCode}. ` +
            `The sheet may no longer be shared "anyone with the link can view", or the link has changed.`
          ));
        }
        const type = res.headers['content-type'] || '';
        if (!/spreadsheet|application\/binary|octet-stream/i.test(type)) {
          res.resume();
          return reject(new Error(`Google Sheets export returned unexpected content type "${type}" — likely a sign-in page, not the file.`));
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      req.on('timeout', () => { req.destroy(new Error(`Timed out after ${timeoutMs}ms fetching the Google Sheet.`)); });
      req.on('error', reject);
    };
    go(url, maxRedirects);
  });
}

/**
 * Download the live sheet to `cachePath`. On failure, leaves any existing
 * cached copy untouched and rethrows — the caller decides whether to fall
 * back to it.
 */
async function refreshLiveSheet({ sheetId, cachePath, timeoutMs }) {
  const buf = await fetchBuffer(exportUrl(sheetId), { timeoutMs });
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const tmp = `${cachePath}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, cachePath);   // atomic swap — a run reading mid-download never sees a half-written file
  return { path: cachePath, bytes: buf.length, fetchedAt: new Date() };
}

module.exports = { refreshLiveSheet, exportUrl };
