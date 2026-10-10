import 'dotenv/config';
import { createPrismaClient } from '../src/lib/db';
import { mediaRoot } from '../src/lib/media';
import { importSimRun } from '../src/lib/sim/importRun';

// Usage: npm run sim:import -- --run ../../artifacts/public/A-swarm-demo-907 --pair B
const args = Object.fromEntries(process.argv.slice(2).reduce<[string, string][]>((pairs, value, index, all) =>
{
    if (value.startsWith('--'))
    {
        pairs.push([value.slice(2), all[index + 1]]);
    }
    return pairs;
}, []));

const pair = String(args.pair ?? '').toUpperCase();
if (!args.run || !['A', 'B', 'C', 'D'].includes(pair))
{
    console.error('Usage: npm run sim:import -- --run <artifacts/public/RUN> --pair <A|B|C|D>');
    process.exit(2);
}

const prisma = createPrismaClient();
try
{
    const result = await importSimRun({ runDir: args.run, pair: pair as 'A' | 'B' | 'C' | 'D', mediaRoot: mediaRoot(), prisma });
    console.log(`Imported ${result.runId} onto ${pair}1/${pair}2 with ${result.alertCount} site(s), ${result.trackCount} trail(s) and ${result.dangerCount} danger alert(s).`);
}
finally
{
    await prisma.$disconnect();
}
