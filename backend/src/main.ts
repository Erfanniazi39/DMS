import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdirSync } from 'fs';
import { join } from 'path';
import session = require('express-session');
import connectPgSimple = require('connect-pg-simple');
import { AppModule } from './app.module';

// Security review H3. Behind a TLS reverse proxy (deploy/README.md) set:
//   NODE_ENV=production            -> SESSION_SECRET is mandatory (>= 32 chars)
//   SESSION_COOKIE_SECURE=true     -> the session cookie is only ever sent over HTTPS
//   HOST=127.0.0.1                 -> the API is reachable only through the proxy / the Next.js app
// Plain-HTTP development keeps working with none of them set.
const DEV_SECRET = 'dev-secret-change-me';

function sessionSecret(): string {
  const configured = process.env.SESSION_SECRET;
  const weak = !configured || configured.length < 32 || configured === DEV_SECRET || configured.startsWith('change-me');
  if (weak && process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters in production (generate one with: openssl rand -hex 32).');
  }
  if (weak) console.warn('[security] SESSION_SECRET is missing or weak — acceptable for local development only.');
  return configured || DEV_SECRET;
}

async function bootstrap() {
  const secret = sessionSecret();
  const secureCookie = process.env.SESSION_COOKIE_SECURE === 'true';
  if (process.env.NODE_ENV === 'production' && !secureCookie) {
    console.warn('[security] Running in production without SESSION_COOKIE_SECURE=true — logins and sessions travel unencrypted. Put the app behind HTTPS (see deploy/README.md).');
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Only a proxy on this machine is trusted, so req.ip / req.secure come from the
  // X-Forwarded-* headers of the Next.js proxy or Caddy — a remote client cannot spoof them.
  app.set('trust proxy', 'loopback');

  // Uploaded files are stored as plain files on disk, not as bytes in the
  // database. The folders are created here so a fresh checkout/deploy
  // doesn't need an empty directory committed to git just to exist.
  //
  // Purchase documents are NOT served statically — they go through the
  // session- and permission-guarded PurchaseFilesController
  // (GET /uploads/purchases/:filename, purchases.view). Customer documents
  // likewise go through CustomerFilesController (GET
  // /uploads/customers/:filename, customers.view). Only the employees
  // folder is still mounted statically.
  // KNOWN GAP (QA 2026-10-05, not fixed here — out of the Purchases scope):
  // employee photos/contract documents are therefore still reachable with
  // no session by anyone who knows the UUID filename; they need the same
  // guarded-route treatment (employees.view).
  mkdirSync(join(process.cwd(), 'uploads', 'employees'), { recursive: true });
  mkdirSync(join(process.cwd(), 'uploads', 'purchases'), { recursive: true });
  mkdirSync(join(process.cwd(), 'uploads', 'customers'), { recursive: true });
  mkdirSync(join(process.cwd(), 'uploads', 'customer-payments'), { recursive: true });
  mkdirSync(join(process.cwd(), 'uploads', 'letters'), { recursive: true });
  mkdirSync(join(process.cwd(), 'uploads', 'company'), { recursive: true });
  app.useStaticAssets(join(process.cwd(), 'uploads', 'employees'), { prefix: '/uploads/employees' });

  const PgSession = connectPgSimple(session);

  app.use(
    session({
      store: new PgSession({
        conString: process.env.DATABASE_URL,
        tableName: 'user_sessions',
        createTableIfMissing: true,
      }),
      secret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: secureCookie,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 8,
      },
    }),
  );

  await app.listen(process.env.PORT ?? 3001, process.env.HOST ?? '0.0.0.0');
}
void bootstrap();
