import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import { createPrismaClient } from '../src/lib/db';
import { DEMO_VIEWER } from './seed-data';
import { assertNotPlaceholder } from './seed';

// Sets the demo viewer's password on the database named by DATABASE_URL (the dev database).
const password = process.env.SEED_VIEWER_PASSWORD;
if (!password)
{
    console.error('SEED_VIEWER_PASSWORD must be set to reset the viewer password.');
    process.exit(1);
}
assertNotPlaceholder('SEED_VIEWER_PASSWORD', password);

const prisma = createPrismaClient();
const result = await prisma.user.updateMany({ where: { email: DEMO_VIEWER.email }, data: { passwordHash: await hash(password) } });
await prisma.$disconnect();
if (result.count === 0)
{
    console.error(`No ${DEMO_VIEWER.email} user exists; run npm run db:seed first.`);
    process.exit(1);
}
console.log(`Reset password for ${DEMO_VIEWER.email}`);
