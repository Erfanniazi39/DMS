import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdirSync } from 'fs';
import { join } from 'path';
import session = require('express-session');
import connectPgSimple = require('connect-pg-simple');
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Employee photos (and any future uploaded files) are stored as plain
  // files on disk and served statically, not as bytes in the database.
  // The folder is created here so a fresh checkout/deploy doesn't need an
  // empty directory committed to git just to exist.
  mkdirSync(join(process.cwd(), 'uploads', 'employees'), { recursive: true });
  mkdirSync(join(process.cwd(), 'uploads', 'purchases'), { recursive: true });
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

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
