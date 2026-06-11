// ===== Musical instrument & brand auto-correct (local, no AI) =====
// Fixes capitalization + common spelling typos for KNOWN music terms only.
// Other words are left exactly as typed. Add terms below as needed.

// lowercase key -> canonical (correctly spelled & capitalised) value
const TERMS = {
  // ── Brands ──
  yamaha:'Yamaha', fender:'Fender', gibson:'Gibson', ibanez:'Ibanez', casio:'Casio',
  roland:'Roland', korg:'Korg', boss:'Boss', shure:'Shure', pearl:'Pearl', tama:'Tama',
  mapex:'Mapex', zildjian:'Zildjian', sabian:'Sabian', meinl:'Meinl', stagg:'Stagg',
  hohner:'Hohner', suzuki:'Suzuki', behringer:'Behringer', akg:'AKG', sennheiser:'Sennheiser',
  marshall:'Marshall', orange:'Orange', taylor:'Taylor', martin:'Martin', epiphone:'Epiphone',
  squier:'Squier', esp:'ESP', jackson:'Jackson', schecter:'Schecter', prs:'PRS', cort:'Cort',
  takamine:'Takamine', kawai:'Kawai', steinway:'Steinway', nord:'Nord', moog:'Moog', akai:'Akai',
  numark:'Numark', pioneer:'Pioneer', focusrite:'Focusrite', mackie:'Mackie', tascam:'Tascam',
  presonus:'PreSonus', novation:'Novation', alesis:'Alesis', gretsch:'Gretsch', washburn:'Washburn',
  ludwig:'Ludwig', remo:'Remo', evans:'Evans', ernie:'Ernie', seagull:'Seagull', kala:'Kala',
  // ── Instrument & accessory terms ──
  guitar:'Guitar', guitars:'Guitars', bass:'Bass', piano:'Piano', keyboard:'Keyboard',
  drum:'Drum', drums:'Drums', violin:'Violin', viola:'Viola', cello:'Cello', flute:'Flute',
  clarinet:'Clarinet', saxophone:'Saxophone', trumpet:'Trumpet', trombone:'Trombone',
  ukulele:'Ukulele', banjo:'Banjo', mandolin:'Mandolin', harmonica:'Harmonica',
  accordion:'Accordion', cajon:'Cajon', djembe:'Djembe', tabla:'Tabla', harmonium:'Harmonium',
  oud:'Oud', synthesizer:'Synthesizer', synth:'Synth', amplifier:'Amplifier', amp:'Amp',
  microphone:'Microphone', mic:'Mic', cymbal:'Cymbal', cymbals:'Cymbals', acoustic:'Acoustic',
  electric:'Electric', classical:'Classical', digital:'Digital', headphone:'Headphone',
  headphones:'Headphones', speaker:'Speaker', mixer:'Mixer', pedal:'Pedal', strings:'Strings',
  string:'String', capo:'Capo', tuner:'Tuner', metronome:'Metronome', stand:'Stand',
  case:'Case', strap:'Strap', pick:'Pick', plectrum:'Plectrum', kit:'Kit',
};

// Levenshtein edit distance (small strings)
function lev(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 3;       // early-out, beyond our threshold
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/**
 * Capitalise/spell-correct ONLY recognised music brands & instrument words.
 * Everything else (model numbers, unknown words) is left untouched.
 */
export function correctMusicalText(text) {
  if (!text) return text;
  return text.replace(/[A-Za-z][A-Za-z'’]*/g, (word) => {
    const lc = word.toLowerCase();
    if (TERMS[lc]) return TERMS[lc];                 // exact match
    if (lc.length < 4) return word;                  // too short to fuzzy-match safely
    let best = null, bestD = 99;
    for (const key in TERMS) {
      if (Math.abs(key.length - lc.length) > 2) continue;
      const d = lev(lc, key);
      if (d < bestD) { bestD = d; best = key; }
    }
    const threshold = lc.length <= 5 ? 1 : 2;        // stricter for short words
    return (best && bestD <= threshold) ? TERMS[best] : word;
  });
}
