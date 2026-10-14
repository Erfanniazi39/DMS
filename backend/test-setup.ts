// Sales specs exercise the stock-moving code paths, which v1 hides behind this
// flag (default off in production). feature-flags.spec clears it for its default test.
process.env.DMS_FEATURE_SALES_STOCK = 'true';
