function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const config = {
  port: Number(process.env['PORT'] || 3000),
  databaseUrl: required('DATABASE_URL'),
  // Only true behind HTTPS; over plain http the browser would drop the cookie.
  cookieSecure: process.env['COOKIE_SECURE'] !== 'false',
  sessionDays: 30,
  // Public sign-up. Off by default: the first account signs up and becomes admin, then admins create users.
  allowSignup: process.env['ALLOW_SIGNUP'] === 'true',
};
