// Source for the vendored sentry.min.js. Rebuild with `npm run vendor:sentry`.
// Only what sentry-init.js uses is exported, so esbuild tree-shakes the rest
// (no tracing, no replay, no session tracking, no feedback widget).
export {
  init,
  getClient,
  captureException,
  breadcrumbsIntegration,
  globalHandlersIntegration,
  browserApiErrorsIntegration,
  linkedErrorsIntegration,
  dedupeIntegration,
  functionToStringIntegration,
  eventFiltersIntegration,
  httpContextIntegration,
} from '@sentry/browser';
