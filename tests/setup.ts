process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://omega:omega@localhost:5432/omega_test";
process.env.APP_SECRET ??= "test-secret-test-secret-test-secret-123";
process.env.DEMO_MODE = "false";
process.env.PAYFAST_MERCHANT_ID = "10000100";
process.env.PAYFAST_MERCHANT_KEY = "46f0cd694581a";
process.env.PAYFAST_PASSPHRASE = "jt7NOE43FZPn";
