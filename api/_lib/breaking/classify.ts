// Gives one headline a family (conflict, attack, disaster, accident, politics) and a tier.
//
// Tier 3 is critical-class (a coup, a head of state killed or removed, an invasion, 50 or more dead),
// tier 2 is major-class (a deadly strike, a mass shooting, a deadly earthquake or crash),
// tier 1 only supports a story. The rules prefer a miss to a false alarm.
import { matchCountries, type CountryMatch } from './match.js';
import type { Classification, Family } from './types.js';

// ---------------------------------------------------------------- death count

const NUM_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, dozen: 12, dozens: 24,
  scores: 40, hundred: 100, hundreds: 200, thousand: 1000, thousands: 2000,
};
const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+|${Object.keys(NUM_WORDS).join('|')})`;
const ABOUT = String.raw`(?:(?:at least|more than|over|nearly|almost|some|about|around|up to|as many as)\s+)?`;
const DEATH_PATTERNS = [
  // "68 killed", "more than 2,000 dead", "12 people feared dead"
  new RegExp(String.raw`(?<![$£€¥\d.,])\b${ABOUT}${NUM}\+?\s+(?:[\p{L}-]+\s+){0,2}(?:killed|dead|die[ds]?|deaths|feared dead|bodies|lives lost|perish(?:ed)?|drowned)\b`, 'iu'),
  // "kills 12", "killing at least 40", "claims 30 lives"
  new RegExp(String.raw`\b(?:kill(?:s|ed|ing)?|claim(?:s|ed|ing)?)\s+${ABOUT}${NUM}\b(?!\s*(?:%|per ?cent|years?|km|miles?|metres?|meters?))`, 'iu'),
  // "death toll passes 3,000"
  new RegExp(String.raw`\bdeath toll\s+(?:[\p{L}]+\s+){0,3}?${ABOUT}${NUM}\b`, 'iu'),
];
const YEAR_BEFORE = /\b(?:in|since|of|by|from|until|before|after|year|summer|winter|spring|autumn|fall)\s+$/i;
// "Children aged 5, 8 and 11 killed": the numbers are ages.
const AGES_BEFORE = /\baged?\s+(?:\d+\s*(?:,|and)\s*)*$/i;
// A total over weeks or more is not one event: "killed 306 people in three weeks", "1,000 dead since 2023".
// "The worst floods since 1950" compares one event with the past; that "since" is no total.
const CUMULATIVE_AFTER = /^[^,;:]{0,40}?\b(?:(?<!\b(?:worst|deadliest|biggest|largest|strongest|heaviest|most)\b[^,;:]{0,30})since|(?:in|over|during|within) (?:the )?(?:(?:past|last|first) )?(?:\d+|two|three|four|five|six|seven|eight|nine|ten|several|few|recent)?\s*(?:weeks|months|years))\b/i;

/**
 * The highest death count in a title, or 0. "2,000 dead" counts; "in 2026" is a year.
 * With `tolls` false, "death toll passes N" does not count (in a war it is the total of the war).
 */
export function deathCount(title: string, tolls = true): number {
  let best = 0;
  for (const [i, re] of DEATH_PATTERNS.entries()) {
    if (!tolls && i === 2) continue;
    const m = re.exec(title);
    if (!m) continue;
    const raw = m[1].toLowerCase();
    const n = NUM_WORDS[raw] ?? parseInt(raw.replace(/,/g, ''), 10);
    if (!Number.isFinite(n) || n >= 1e6) continue;
    // A four-digit number with no comma after "in", "since" and so on is a year.
    const at = (m.index ?? 0) + m[0].indexOf(m[1]);
    if (/^(?:19|20)\d\d$/.test(raw) && YEAR_BEFORE.test(title.slice(0, at))) continue;
    if (AGES_BEFORE.test(title.slice(0, at))) continue;
    if (CUMULATIVE_AFTER.test(title.slice((m.index ?? 0) + m[0].length))) continue;
    best = Math.max(best, n);
  }
  return best;
}

// ---------------------------------------------------------------- rules

interface Rule {
  family: Family;
  tier: 1 | 2 | 3;
  re: RegExp;
  interstate?: boolean;
}

const RULES: Rule[] = [
  // A coup needs a coup verb, or a takeover, or "<country> coup". The word "coup" alone is not enough.
  { family: 'politics', tier: 3, re: /\bseiz(?:es|ed|ing|e) power\b|\bmilitary takeover\b|\bjunta (?:seizes|takes over)\b|\b(?:stage[sd]?|staging|launch(?:es|ed)?|declare[sd]?|announce[sd]?|mount(?:s|ed)?) (?:a )?(?:military )?coup\b|\b(?:ousted|overthrown|toppled|deposed) in (?:a )?(?:military )?coup\b|\bcoup (?:ousts|topples|overthrows)\b/i },
  // "overthrow the president", "the government is toppled". A statue or a tree is not a leader.
  { family: 'politics', tier: 3, re: /\b(?:overthrow|overthrew|overthrown|topple[sd]?|toppling|depose[sd]?)\s+(?:the\s+)?(?:\p{Lu}[\p{L}'-]+\s+){0,2}(?:president|government|prime minister|PM|leader|king|regime|junta|ruler)\b|\b(?:president|government|prime minister|leader|king|regime|junta|ruler)\s+(?:is\s+|was\s+|has been\s+)?(?:overthrown|toppled|deposed)\b/iu },
  { family: 'politics', tier: 2, re: /\bassassinat(?:ed|es|ion)\b|\bmartial law\b|\bnational state of emergency\b|\bnationwide (?:state of emergency|curfew|blackout|shutdown)\b|\bmass protests?\b.*\b(?:killed|dead)\b/i },
  // "Russia's full-scale invasion" names a war that goes on; only a launch is new. A price war is no war.
  { family: 'conflict', tier: 3, re: /(?<!\b(?:price|trade|tariff|bidding|turf|culture|gang|talent|streaming|console|word|words|currency|chip|cola|tech|ratings|media|legal|fare|subsidy|war of)\s)\bwar (?:breaks out|erupts)\b|\b(?:launch(?:es|ed)?|begins?|began|starts?|started|orders?|ordered) (?:a )?(?:full-scale|ground) (?:invasion|offensive)\b|\bnuclear (?:strike|attack|detonation|blast|explosion)\b|\bnuclear (?:weapons? )?test\b(?! ban| site)/i },
  { family: 'conflict', tier: 2, re: /\b(?:air ?strikes?|strikes|missiles?|drones?|rockets?|shelling|bombard\w*|ballistic|artillery)\b.*\b(?:kill\w*|dead|hits?|struck|pound\w*|attack\w*)\b|\bkill\w*\b.*\b(?:air ?strikes?|strikes?|shelling|bombardment|missile|drone)\b|\b(?:strikes?|attacks?) on (?:the )?capital\b/i },
  { family: 'conflict', tier: 2, interstate: true, re: /\b\p{Lu}[\p{L}.]+ (?:strikes|bombs|attacks|shells|launches strikes on) (?:the )?\p{Lu}|\b(?:launch(?:es|ed)?|carr(?:y|ies|ied) out) (?:new |fresh |retaliatory |wave of )?(?:air ?|missile |drone )?strikes? (?:on|against|in) (?:the )?\p{Lu}|\bstrikes? (?:on|against) (?:the )?\p{Lu}/u },
  { family: 'conflict', tier: 1, re: /\braids?\b|\bclashes\b|\bambush\w*|\bmilitants?\b|\binsurgents?\b|\bjihadists?\b|\bbandits\b|\boffensive\b|\brebels?\b.*\b(?:kill\w*|seize\w*|capture\w*)/i },
  { family: 'attack', tier: 2, re: /\bterror(?:ist)? attack\b|\bmass shooting\b|\bschool shooting\b|\bsuicide (?:bomb\w*|attack)\b|\bcar bomb\b|\bbombing\b|\bmassacre\b|\bgunmen\b|\bhostages? (?:taken|seized|held)\b|\btakes? hostages?\b|\bshooting (?:kills|leaves)\b|\bstabbing attack\b/i },
  { family: 'attack', tier: 1, re: /\bshooting\b|\bgunman\b|\bopens? fire\b|\bstabbing\b|\bknife attack\b|\battack\b.*\bkill\w*|\bkill\w*\b.*\battack\b/i },
  { family: 'disaster', tier: 2, re: /\bearthquake\b|\bquake\b|\btsunami\b|\bhurricane\b|\btyphoon\b|\bcyclone\b|\bvolcan\w+ erupt\w*|\beruption\b|\bfloods?\b|\bflooding\b|\bflooded\b|\bflash floods?\b|\blandslides?\b|\bmudslides?\b|\bavalanche\b|\btornado(?:es)?\b|\bheat ?wave\b.*\b(?:kill\w*|dead|deaths)\b|\bwildfires?\b.*\b(?:kill\w*|dead|evacuat\w*)\b|\bstorm\b.*\b(?:kill\w*|dead)\b/i },
  { family: 'accident', tier: 2, re: /\b(?:plane|jet|airliner|helicopter|air) crash\b|\bcrash(?:es)?\b.*\b(?:plane|jet|airliner|flight)\b|\btrains? (?:crash|collision|collide|derail\w*)\b|\bcollision (?:of|between) (?:two )?(?:[\p{L}-]+ )*trains?\b|\b(?:ferry|boat|ship|vessel) (?:sinks|sank|sinking|capsiz\w*|crash|collision|disaster)\b|\bcapsiz\w*|\bshipwreck\w*|\bboat\b.*\b(?:dead|killed|drown\w*|missing)\b|\b(?:dead|killed|drown\w*)\b.*\b(?:boat|ship|vessel)\b|\bstampede\b|\b(?:building|bridge|dam|mine|tower) collapse\b|\bcollapse\b.*\bkill\w*|\bexplosion\b|\bblast\b|(?<!\bopen(?:s|ed|ing)? )\b(?:fire|blaze) (?:kills|killed|at|in|engulfs|rips through|sweeps|guts)\b|\bkill\w* in (?:a )?(?:fire|blaze)\b|\b(?:building|house|factory|hospital|hotel|market|tower|apartment) fire\b|\bpile-?ups?\b|\bbus (?:crash|plunge\w*)\b/iu },
];

// Head-of-state titles. "PM" must be upper case, so it is outside the case-insensitive part.
const HEAD_RE = /\b(?:(?:[Pp]resident|[Pp]rime [Mm]inister|[Pp]remier|[Kk]ing|[Qq]ueen|[Ee]mperor|[Ee]mpress|[Cc]hancellor|[Ss]upreme [Ll]eader|[Hh]ead of [Ss]tate|[Mm]onarch|[Ss]ultan|[Ee]mir|[Cc]rown [Pp]rince|[Jj]unta [Ll]eader|[Mm]ilitary [Rr]uler|[Ll]eader)|PM)\b/g;
// Between the country and the title: "Japan's PM", "Paraguay president", "Peru's interim president".
const HEAD_GAP = /^(?:['’]s)?\s+(?:(?:new|acting|interim|caretaker|embattled|outgoing|incumbent|elected)\s+)?$/i;
// Words that make the title someone else's: a former leader, a company, a club, a deputy.
const NOT_HEAD = /\b(?:former|ex|late|then|deputy|vice|university|college|school|student|company|club|bank|Fed|FIFA|UEFA|IOC|league|union|federation|association|party|chamber|foundation|corp|inc|group|team|board|council|senate|parliament(?:ary)?|regional|provincial|opposition|rebel|militia|Islamic State|Hamas|Hezbollah|Houthi|Taliban|cartel|gang)\b|\bex-$/i;
const ROLE_VERB = /\b(?:dies|died|has died|is dead|dead|killed|assassinated|shot dead|shot|resigns|resigned|quits|steps down|stepped down|ousted|impeached|arrested|detained|removed from office|flees|fled|toppled|deposed|overthrown|captured)\b/i;
// A speaker verb between the title and the event verb: "president says 12 killed".
const SPEAKER = /\b(?:says?|said|tells?|told|warns?|claims?|announces?|confirms?|calls?|urges?|vows?|denies|orders?|meets?|visits?|condemns?|accuses?|blames?|mourns?|pays|praises?|hails?|names?|appoints?|reacts?|responds?)\b|[:;]/i;
// A current leader named by the alias table, then a death or removal verb: "Putin dies", "Peña resigns".
const LEADER_EVENT = /^\s*(?:,[^,]{1,40},\s*)?(?:has\s+|is\s+|was\s+|has been\s+)?(dies|died|dead|killed|assassinated|shot dead|shot|resigns|resigned|quits|steps down|ousted|impeached|arrested|detained|captured|deposed|toppled|overthrown)\b/i;
const LEADER_EVENT_BEFORE = /\b(?:assassination of|death of|killing of)\s+(?:\p{L}+\s+){0,2}$/iu;
// Verbs that can also be active with an object: "Trump toppled statue", "Trump quits Paris deal",
// "President Bukele arrested gang leaders", "Trump shot down claims". "Dead" is here for "dead set on".
const TRANSITIVE = /^(?:dead|killed|shot|resigns|resigned|quits|steps down|stepped down|ousted|arrested|detained|captured|toppled|deposed|overthrown)$/i;
// After such a verb, the event reading needs the end of the title, a punctuation mark, or one of these words.
const EVENT_TAIL = /^(?:\s*$|\s*[,.;:!?|()"'‘’“”—–-]|\s+(?:after|amid|as|at|in|by|following|over|from (?:office|power|post)|under|while|during|on|near|outside|inside|with|alongside|and|aged|hours|days|minutes|today|tonight|yesterday|reports?|says?|said)\b)/i;

/** True when the role verb, followed by `tail`, reads as an event and not as an active verb with an object. */
function eventReading(verb: string, tail: string): boolean {
  return !TRANSITIVE.test(verb) || EVENT_TAIL.test(tail);
}

/** Tier 3 politics: a current head of state or government is killed, dies or is removed. */
function headOfStateEvent(title: string, matches: CountryMatch[]): boolean {
  for (const h of title.matchAll(HEAD_RE)) {
    const hi = h.index ?? 0;
    const headEnd = hi + h[0].length;
    let subjectStart = -1;
    let subjectEnd = -1;
    // "Paraguay president", "Paraguayan President", "Japan's PM"
    const before = matches.filter((m) => (m.kind === 'name' || m.kind === 'demonym') && m.end <= hi && HEAD_GAP.test(title.slice(m.end, hi)));
    if (before.length) {
      subjectStart = before[before.length - 1].index;
      subjectEnd = headEnd;
    }
    // "President of Paraguay", "President Trump"
    const of = /^\s+of\s+(?:the\s+)?/i.exec(title.slice(headEnd));
    const afterStart = headEnd + (of ? of[0].length : (/^\s+/.exec(title.slice(headEnd))?.[0].length ?? 0));
    const after = matches.find((m) => m.index === afterStart && (of ? m.kind === 'name' : m.kind === 'leader' || m.kind === 'surname'));
    if (subjectStart < 0 && after) {
      subjectStart = hi;
      subjectEnd = after.end;
    }
    if (subjectStart < 0) continue;
    if (NOT_HEAD.test(title.slice(Math.max(0, subjectStart - 30), subjectStart))) continue;
    if (NOT_HEAD.test(title.slice(subjectStart, subjectEnd))) continue;
    // The event verb must follow within 60 characters, with no speaker verb between.
    const rest = title.slice(subjectEnd, subjectEnd + 60);
    const v = ROLE_VERB.exec(rest);
    if (!v) continue;
    if (SPEAKER.test(rest.slice(0, v.index))) continue;
    // "Kenya president Ruto's son arrested": the verb belongs to someone else.
    if (/['’]s\s/.test(rest.slice(0, v.index))) continue;
    if (!eventReading(v[0], title.slice(subjectEnd + v.index + v[0].length))) continue;
    return true;
  }
  return false;
}

/** Tier 3 politics: "Putin dies", "Netanyahu assassinated", "Pope Francis dies", "Peña resigns". */
function leaderDeath(title: string, matches: CountryMatch[]): boolean {
  for (const m of matches) {
    if (m.kind !== 'leader' && m.kind !== 'surname') continue;
    const before = title.slice(Math.max(0, m.index - 30), m.index);
    if (NOT_HEAD.test(before)) continue;
    let rest = title.slice(m.end);
    // "Pope Francis dies": a name can follow the title word.
    if (m.text === 'Pope') rest = rest.replace(/^\s+\p{Lu}\p{Ll}+(?:\s+[IVXL]+)?(?=\s|,)/u, '');
    const e = LEADER_EVENT.exec(rest);
    if (e && eventReading(e[1], rest.slice(e[0].length))) return true;
    if (LEADER_EVENT_BEFORE.test(title.slice(0, m.index))) return true;
  }
  return false;
}

const COUP_AFTER = /^(?:['’]s)?\s+(?:military\s+)?coup\b(?!\s+(?:leaders?|government|regime|plot|attempt|anniversary|trial|bid|era|survivors?|accused|plotters?|makers?))/i;

const COUP_BEFORE = /\b(?:military\s+)?coup(?: d['’]état)? in\s+(?:the\s+)?$/i;

/** Tier 3 politics: "Gabon coup: officers announce takeover", "Military coup in Niger". The country names the coup. */
function countryCoup(title: string, matches: CountryMatch[]): boolean {
  return matches.some(
    (m) => (m.kind === 'name' || m.kind === 'demonym') && m.weight > 0 && (COUP_AFTER.test(title.slice(m.end)) || (m.kind === 'name' && COUP_BEFORE.test(title.slice(0, m.index)))),
  );
}

// "Chinese jets invade Taiwan's airspace" is an incursion, not an invasion.
const NOT_INVASION_TARGET = /^(?:['’]s)?\s+(?:air\s*space|air defen[cs]e|ADIZ|waters|territorial|maritime|exclusive economic zone|EEZ|privacy|space)\b/i;

/**
 * "declares war on Georgia", "invades Estonia", "launches invasion of Estonia": the target must be a
 * country, not seaweed or a pitch. "Russia's invasion of Ukraine" names a war that goes on, so a bare
 * "invasion of" needs a launch verb before it.
 */
function warOnCountry(title: string, matches: CountryMatch[]): boolean {
  const re = /\b(?:declares? war on|declared war on|invad(?:es|ed|e|ing)|(?:launch(?:es|ed)?|begins?|began|starts?|started|orders?|ordered) (?:an? |the )?(?:full-scale |ground |military )?invasion of)\s+(?:the\s+)?(?:(?:southern|northern|eastern|western)\s+)?/gi;
  for (const m of title.matchAll(re)) {
    const at = (m.index ?? 0) + m[0].length;
    const target = matches.find((c) => c.index === at && (c.kind === 'name' || c.kind === 'place') && c.weight > 0);
    if (target && !NOT_INVASION_TARGET.test(title.slice(target.end))) return true;
  }
  return false;
}

// ---------------------------------------------------------------- demotions

// Not news of a new event: anniversaries, trials, culture, sport, opinion, forecasts, hypotheticals.
const NOT_EVENT = /\b(?:shooting stars?|(?:blue|red|pink|silver|green) (?:tsunami|wave|hurricane|tide)|flood (?:the )?streets|flood of|accus\w+|alleg\w+|plot|plotted|foiled|thwarted|fact[- ]check\w*|disinformation|misinformation|conspiracy|fake|hoax|GoFundMe|anniversary|years? (?:after|since|ago|on)|remember\w*|memorial|commemorat\w*|trial|sentenced|convicted|jailed|guilty|acquitted|inquest|inquiry|lawsuit|sues|film|movie|documentary|series|season|finale|episode|book|novel|review|podcast|museum|exhibition|game|match|cup|league|olympic|tournament|F1|grand prix|NFL|NBA|cricket|football|soccer|tennis|golf|rugby|opinion|analysis|commentary|explainer|explained|what to know|quiz|in pictures|photos?|video game|simulat\w*|drill|exercise|rehears\w*|threat\w*|warns?|warnings?|could|would|might|fears?|risks?|brink|plans?|plann\w*|vows?|considers?|mulls?|prepar\w*|heads? for|heading for|forms|formed|forming|watch|alerts? (?:cancel+ed|lifted)|no (?:damage|injuries|casualties|deaths|tsunami)|scare|hits? the (?:market|shelves|road|stage|screen)|today in history|on this day|this day in history|marks|marking|days (?:of|since)|root causes?|lessons|legacy|poetry|poems?|art|music|songs?|theat(?:re|er)|prosecutors? (?:seeks?|sought|demands?|asks?|calls? for|charges?)|prosecution|court|verdict|appeal|hearing|indict\w*|death (?:penalty|sentence)|not|never|no longer|doesn['’]t|does not|don['’]t|didn['’]t|won['’]t|will not|wouldn['’]t|isn['’]t|aren['’]t|rules? out|needs? to|(?:to|will) (?:restart|resume|launch|strike|attack|invade|bomb|begin|start|send|deploy|hit))\b|\?/i;
// Explainers and features start with a question word or a label: "How a bank collapse toppled ...".
const FEATURE_START = /^(?:how|why|what|who|when|where|inside|explainer|analysis|opinion|comment|editorial|letters?|watch|listen|review)\b/i;
// "may" in lower case only: "May" is also the month.
const MODAL_MAY = /\bmay\b/;
// De-escalation: a story about the end of an event supports it but never starts an alert.
const DEESCALATE = /\b(?:halts?|halted|ceasefire|truce|peace|talks|negotiat\w*|ends?|ended|suspend\w*|pauses?|paused|lifts?|lifted|aid (?:arrives|convoy|package|pledge)|rebuild\w*|recover\w*|return\w*|reopen\w*|compensation|probe|investigat\w*|damage (?:to )?crops|study|climate change|freed|released|release of|swap|breakthrough)\b/i;
// An attack report that names only injuries, or one or two deaths: "mass shooting leaves 4 injured".
const INJURED = /\b(?:injur\w*|wounded|hurt)\b/i;
const DEATH_WORD = /\b(?:kill\w*|dead|dies|died|death\w*|fatal\w*)\b/i;
// Follow-up stories about an earlier event.
export const AFTERMATH = /\b(?:mourn\w*|vigils?|funerals?|silent march|marches|tributes?|suspect|what we know|aftermath|resign\w*|days after|weeks after|charged|identified|named as|survivors? (?:recall|describe|tell)|how it happened|timeline|dies in hospital|dies of (?:his|her|their) (?:wounds|injuries)|victims? (?:named|remembered|laid to rest)|black box|voice recorder|flight recorder|investigators)\b/i;
const COUP_CLAIM = /\b(?:accus\w+|alleg\w+|plot\w*|attempt\w*|foil\w*|fail\w*|thwart\w*|calls? it a coup|branded|so-called|rumou?rs?)\b|["'‘“]coup["'’”]/i;
const LIVE = /^(?:live|breaking)\b|\blive(?: updates)?\s*[:|–-]|[:|–-]\s*live\b|\bas it happened\b/i;

/** True for a live page or a "breaking" title. */
export function isLive(title: string, url: string): boolean {
  return LIVE.test(title) || /\/live\//.test(url);
}

/** Returns the family, tier and death count of a headline, or null when it reports no severe event. */
export function classify(title: string): Classification | null {
  const matches = matchCountries(title);
  const hits: Rule[] = RULES.filter((r) => r.re.test(title));
  if (headOfStateEvent(title, matches) || leaderDeath(title, matches) || countryCoup(title, matches)) hits.push({ family: 'politics', tier: 3, re: /./ });
  if (warOnCountry(title, matches)) hits.push({ family: 'conflict', tier: 3, re: /./ });
  if (!hits.length) return null;

  const countries = new Set(matches.filter((m) => m.weight > 0).map((m) => m.id));
  const interstate = hits.some((h) => h.interstate) && countries.size >= 2;
  // On a tie, a disaster word wins: "Earthquake strikes Tibet, killing 16" is no military strike.
  hits.sort((a, b) => b.tier - a.tier || Number(b.family === 'disaster') - Number(a.family === 'disaster'));
  const family = hits[0].family;
  let tier: number = hits[0].tier;
  // In a war, "death toll passes 70,000" is the total of the war, not of this event.
  const deaths = deathCount(title, family !== 'conflict');

  // Deaths set the tier of disasters, accidents and attacks. 50 or more dead is critical-class.
  if (family !== 'politics' && (family !== 'conflict' || tier < 3)) {
    if (deaths >= 50) tier = 3;
    else if (deaths >= 5) tier = Math.max(tier, 2);
    else if (family === 'accident' || family === 'disaster' || (family === 'conflict' && !interstate)) tier = 1;
    else if (family === 'attack' && (deaths > 0 && deaths < 3)) tier = Math.min(tier, 1);
    else if (family === 'attack' && deaths === 0 && INJURED.test(title) && !DEATH_WORD.test(title)) tier = Math.min(tier, 1);
  }
  if (family === 'disaster') {
    // A strong quake or a landfall is major-class with no death count, but never critical-class alone.
    const mag = title.match(/\b(?:magnitude|M)\s?-?(\d(?:\.\d)?)\b|\b(\d\.\d)[- ]magnitude\b/i);
    if (mag && parseFloat(mag[1] ?? mag[2]) >= 7) tier = Math.max(tier, 2);
    if (/\btsunami (?:hits|strikes|waves? (?:hit|strike))\b|\b(?:category [45]|super typhoon)\b.*\b(?:hits|slams|lashes|batters|pounds|makes landfall|strikes)\b/i.test(title)) tier = Math.max(tier, 2);
  }
  // Claims and plots about a coup are politics, not a coup.
  if (family === 'politics' && /\bcoup\b/i.test(title) && COUP_CLAIM.test(title)) tier = Math.min(tier, 1);
  // A forecast, a question, a trial or a film supports a story but never starts an alert.
  if (NOT_EVENT.test(title) || MODAL_MAY.test(title) || FEATURE_START.test(title)) tier = Math.min(tier, 1);
  if (DEESCALATE.test(title)) tier = Math.min(tier, 1);
  if (family !== 'politics' && AFTERMATH.test(title)) tier = Math.min(tier, 1);
  return tier >= 1 ? { family, tier: tier as 1 | 2 | 3, deaths } : null;
}
