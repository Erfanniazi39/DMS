import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdirSync } from 'fs';
import { join } from 'path';
import session = require('express-session');
import connectPgSimple = require('connect-pg-simple');
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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
  app.useStaticAssets(join(process.cwd(), 'uploads', 'employees'), { prefix: '/uploads/employees' });

  const PgSession = connectPgSimple(session);

  app.use(
    session({
      store: new PgSession({
        conString: process.env.DATABASE_URL,
        tableName: 'user_sessions',
        createTableIfMissing: true,
      }),
      secret: process.env.SESSION_SECRET ?? 'dev-secret-change-me',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 8,
      },
    }),
  );

  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
