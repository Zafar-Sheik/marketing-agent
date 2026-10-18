// Every unit test runs offline: no real provider can be called, no money spent.
process.env.MOCK_PROVIDERS = 'true';
process.env.DISPATCH_MODE = 'inline';
process.env.DATABASE_URL = 'pglite:memory';
process.env.N8N_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.AUTH_SECRET = 'test-auth-secret';
