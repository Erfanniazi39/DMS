import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

function generatePassword(length = 16): string {
  const alphabet =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = randomBytes(length);
  let password = '';
  for (let i = 0; i < length; i++) {
    password += alphabet[bytes[i] % alphabet.length];
  }
  return password;
}

async function main() {
  const username = process.argv[2] ?? 'admin';

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    console.error(`No user found with username "${username}".`);
    process.exitCode = 1;
    return;
  }

  const plainPassword = generatePassword();
  const passwordHash = await argon2.hash(plainPassword, { type: argon2.argon2id });

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  console.log('\n==============================================');
  console.log(` Password reset for user: ${username}`);
  console.log(` New password: ${plainPassword}`);
  console.log(' Save this password now — it will not be shown again.');
  console.log('==============================================\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
