// Error reporting — Sentry, errors only. Loaded synchronously in <head> right after
// sentry.min.js on index.html, toolkit.html and success.html (not checkout.html).
//
// Everything an event carries is scrubbed before it leaves the browser. Two secrets
// travel in URLs on this site, and Sentry records URLs in several places (the page URL,
// stack frames, fetch breadcrumbs, navigation breadcrumbs):
//   · ?access= / ?lock= — the toolkit's access codes
//   · &key=             — Google's AI API takes the user's own key as a query param
// So scrubbing is not per-field: the whole event is serialised, cleaned and parsed back.
// privacy.html section 5 describes exactly this; keep the two in step.
(function () {
  if (!window.Sentry || !Sentry.init) return;

  var DSN = 'https://819abee3a015ce2356cc5307556148f5@o4512083551911936.ingest.us.sentry.io/4512145041522688';

  var URL_SECRET = /([?&#](?:key|access|lock|code|token|api[_-]?key|password|pass)=)[^&#\s"'\\]*/gi;
  // Provider key shapes, in case one turns up in an error message rather than a URL.
  var KEY_SHAPES = /\b(?:sk-(?:ant-|or-|proj-)?[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,})/g;
  // Requests to these hosts are the AI layer calling a provider with the user's key.
  var AI_HOSTS = /anthropic\.com|openai\.com|googleapis\.com|openrouter\.ai/i;

  function scrub(s) {
    return typeof s === 'string'
      ? s.replace(URL_SECRET, '$1[redacted]').replace(KEY_SHAPES, '[redacted-key]')
      : s;
  }

  function scrubDeep(obj) {
    try {
      return JSON.parse(JSON.stringify(obj, function (k, v) { return scrub(v); }));
    } catch (e) {
      return null; // unserialisable → drop rather than risk sending it raw
    }
  }

  function beforeBreadcrumb(crumb) {
    if (!crumb) return crumb;
    var cat = crumb.category || '';
    // Never record a call to an AI provider, not even a scrubbed one.
    if ((cat === 'fetch' || cat === 'xhr') && crumb.data && AI_HOSTS.test(String(crumb.data.url || ''))) return null;
    return scrubDeep(crumb);
  }

  function beforeSend(event) {
    return scrubDeep(event);
  }

  var host = location.hostname;
  var local = location.protocol === 'file:' || host === 'localhost' || host === '' ||
              /^(127\.|0\.0\.0\.0$|\[?::1\]?$)/.test(host);

  try {
    Sentry.init({
      dsn: DSN,
      // Nothing is sent from a local server — development and tests/check.mjs stay silent.
      enabled: !local,
      environment: local ? 'development' : 'production',
      sendDefaultPii: false,
      // Only errors from this site's own pages and files; browser extensions are noise.
      allowUrls: [location.origin],
      defaultIntegrations: false,
      integrations: [
        Sentry.eventFiltersIntegration(),
        Sentry.functionToStringIntegration(),
        Sentry.browserApiErrorsIntegration(),
        // console:false — console output can hold item data; dom records selectors, not text.
        Sentry.breadcrumbsIntegration({ console: false, dom: true, fetch: true, xhr: true, history: true }),
        Sentry.globalHandlersIntegration(),
        Sentry.linkedErrorsIntegration(),
        Sentry.dedupeIntegration(),
        Sentry.httpContextIntegration()
      ],
      beforeBreadcrumb: beforeBreadcrumb,
      beforeSend: beforeSend
    });
  } catch (e) { /* reporting must never break the page */ }

  // Exposed for tests/check.mjs, which asserts the scrubbing on real event shapes.
  window.skSentry = { scrub: scrub, beforeSend: beforeSend, beforeBreadcrumb: beforeBreadcrumb, local: local };
})();
