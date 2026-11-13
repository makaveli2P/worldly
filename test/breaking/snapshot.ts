// Live run and snapshot tool for the breaking-news detector.
//
//   npx tsx test/breaking/snapshot.ts                    live run: print the sources, the flagged headlines and the alerts
//   npx tsx test/breaking/snapshot.ts --save <name>      live run, and save the inputs to test/breaking/fixtures/<name>.json
//   npx tsx test/breaking/snapshot.ts --save <name> --wide   also save every headline that names a country
//   npx tsx test/breaking/snapshot.ts --replay <file>    run the detector on a saved fixture
//   npx tsx test/breaking/snapshot.ts --state <file>     also give a saved detector state (JSON) to the run, for the life rules
//
// The tool sends a generic User-Agent. Set BREAKING_USER_AGENT to send another one.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { companyById } from '../../api/_lib/breaking/business.js';
import { classify } from '../../api/_lib/breaking/classify.js';
import { detect } from '../../api/_lib/breaking/detect.js';
import { primaryCountries } from '../../api/_lib/breaking/match.js';
import { fetchInputs } from '../../api/_lib/breaking/sources.js';
import { parseState } from '../../api/_lib/breaking/state.js';
import type { BreakingInputs } from '../../api/_lib/breaking/types.js';
import { fromFixture, toFixture, type Fixture } from './fixture.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  let inputs: BreakingInputs;
  const replay = flag('--replay');
  if (replay) {
    inputs = fromFixture(JSON.parse(readFileSync(replay, 'utf8')) as Fixture);
  } else {
    const t0 = Date.now();
    const live = await fetchInputs(Date.now(), { userAgent: process.env.BREAKING_USER_AGENT || 'Mozilla/5.0 (compatible; FeedProbe/1.0)' });
    inputs = live.inputs;
    console.log(`fetch ${Date.now() - t0} ms, ${inputs.headlines.length} headlines, sources ${inputs.sources?.ok}/${inputs.sources?.total}`);
    console.log(live.status.map((s) => `${s.id}:${s.ok ? s.items : s.status}/${s.ms}ms`).join(' '));
    const save = flag('--save');
    if (save) {
      const path = join(HERE, 'fixtures', `${save}.json`);
      writeFileSync(path, `${JSON.stringify(toFixture(inputs, flag('--note') ?? '', args.includes('--wide')), null, 0)}\n`);
      console.log(`saved ${path}`);
    }
  }
  const t1 = performance.now();
  const statePath = flag('--state');
  const previous = statePath ? parseState(JSON.parse(readFileSync(statePath, 'utf8'))) : null;
  if (statePath && !previous) throw new Error('--state: not a valid detector state');
  const out = detect(inputs, previous);
  console.log(`detect ${Math.round(performance.now() - t1)} ms; ITN ongoing=${JSON.stringify(inputs.itn?.ongoing ?? null)} blurbs=${inputs.itn?.blurbs.length ?? 'n/a'} hazards=${inputs.hazards.length}`);

  console.log('\n== flagged headlines (tier family deaths countries | outlet feed#pos age)');
  const rows = inputs.headlines
    .map((h) => ({ h, c: classify(h.title) }))
    .filter((r) => r.c && (!r.h.publishedAt || inputs.now - Date.parse(r.h.publishedAt) <= 12 * 3.6e6))
    .sort((a, b) => b.c!.tier - a.c!.tier);
  // A business row shows its event and company (or market) and the country of the company.
  const subjectName = (id: string) => companyById(id)?.name ?? id;
  for (const { h, c } of rows) {
    const age = h.publishedAt ? ((inputs.now - Date.parse(h.publishedAt)) / 3.6e6).toFixed(1) : '-';
    const where = c!.subject && (c!.family === 'business' || !primaryCountries(h.title).length) ? c!.subject.country : primaryCountries(h.title).join('+') || '-';
    const biz = c!.subject ? ` [${c!.event ?? 'leader'}: ${subjectName(c!.subject.id)}]` : '';
    console.log(`  T${c!.tier} ${c!.family.padEnd(8)} d=${String(c!.deaths).padStart(4)} ${where.padEnd(8)} | ${h.publisher.slice(0, 18).padEnd(18)} ${h.feed}#${h.position} ${age}h | ${h.title.slice(0, 110)}${biz}`);
  }
  console.log('\n== candidates (top 12)');
  const hours = (t: number | null) => (t === null ? '-' : `${((inputs.now - t) / 3.6e6).toFixed(1)}h`);
  for (const c of out.candidates.slice(0, 12)) {
    console.log(`  ${c.id.padEnd(8)} ${String(c.level).padEnd(8)} ${c.family.padEnd(8)}${c.subject ? ` (${subjectName(c.subject)})` : ''} ${c.reason.padEnd(34)} voices=${c.voices} ed=${c.editions} lead=${c.lead} tierEff=${c.tierEff} deaths=${c.deaths} score=${c.score.toFixed(1)}`);
    console.log(`      full=${c.fullLevel} freshLeads=${c.freshLeads} freshVoices=${c.freshVoices} windowVoices=${c.windowVoices} pulse=${c.pulse} wave=${c.wave} since=${hours(c.since)}`);
    console.log(`      pick: ${c.pick.h.publisher} ${c.pick.h.feed}#${c.pick.h.position} ${hours(c.pick.time)} | ${c.pick.h.title.slice(0, 100)}`);
    for (const i of c.items.filter((x) => x.recent).slice(0, 4)) console.log(`      ${i.h.publisher}: ${i.h.title.slice(0, 110)}`);
  }
  console.log('\n== response');
  console.log(JSON.stringify(out.response, null, 2));
  console.log('\n== next state');
  console.log(JSON.stringify(out.state));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
