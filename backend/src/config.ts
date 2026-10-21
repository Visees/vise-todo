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
};
