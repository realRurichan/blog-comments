export type Bindings = {
  DB: D1Database; ASSETS: Fetcher;
  ENVIRONMENT: string; SERVICE_ORIGIN: string; ALLOWED_ORIGINS: string;
  ADMIN_GITHUB_ID: string; GITHUB_CLIENT_ID: string; GITHUB_CLIENT_SECRET: string;
  TURNSTILE_SITE_KEY: string; TURNSTILE_SECRET_KEY: string; RATE_LIMIT_SECRET: string;
};
export type AppEnv = { Bindings: Bindings };
