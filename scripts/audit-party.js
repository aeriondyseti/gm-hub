// audit-party.js — deterministic sheet audit for the KtP party.
// Run via: node scripts/ktp-eval.mjs -f scripts/audit-party.js
// Checks HP, skill ranks (Unchained background pool aware), feat count,
// trait count, and class-feature presence (per class associations).
// Output is a per-character report with a `flags` list of anything off.
return (async () => {
  const party = game.actors.filter(a =>
    a.type === "character" && a.folder?.name === "The Party" &&
    a.name !== "The Party" && !/ARCHIVE/i.test(a.name));

  // tiny arithmetic evaluator for change formulas (@attributes.hd.total, "5", "+5")
  const ev = (f, hd) => {
    if (typeof f === "number") return f;
    let s = String(f).replace(/@attributes\.hd\.total/g, hd).replace(/[^0-9+\-*/.() ]/g, "");
    try { return Function(`"use strict";return (${s || 0})`)(); } catch { return 0; }
  };
  const norm = n => n.toLowerCase().replace(/\(.*?\)|\[.*?\]|[^a-z ]/g, "").trim();

  // Fast uuid->name via cached pack indices (avoids slow per-item fromUuid loads)
  const packCache = {};
  const nameFromCompendium = async (uuid) => {
    const m = String(uuid).match(/^Compendium\.(.+)\.Item\.([^.]+)$/);
    if (!m) return null;
    const [, coll, id] = m;
    if (!(coll in packCache)) {
      const pack = game.packs.get(coll);
      packCache[coll] = pack ? new Map((await pack.getIndex()).map(e => [e._id, e.name])) : new Map();
    }
    return packCache[coll].get(id) ?? null;
  };

  const report = [];
  for (const a of party) {
    const sys = a.system, flags = [];
    const HD = sys.attributes?.hd?.total ?? 0;
    const conMod = sys.abilities.con.mod, intMod = sys.abilities.int.mod;
    const classes = a.items.filter(i => i.type === "class");
    const isHuman = a.items.some(i => i.type === "race" && /human/i.test(i.name));
    const level = classes.reduce((s, c) => s + (c.system.level || 0), 0);

    // ---- HP ----
    let classHpSum = 0, fcbHp = 0, maxPossible = 0;
    for (const c of classes) {
      classHpSum += (c.system.hp || 0);
      fcbHp += (c.system.fc?.hp?.value || 0);
      maxPossible += (c.system.hd || 0) * (c.system.level || 0);
    }
    let mhp = 0;
    for (const i of a.items) for (const ch of (i.system.changes || [])) if (ch.target === "mhp") mhp += ev(ch.formula, HD);
    const expHp = classHpSum + fcbHp + conMod * HD + mhp;
    const actHp = sys.attributes.hp.max;
    if (expHp !== actHp) flags.push(`HP: formula ${expHp} != sheet ${actHp} (Δ${actHp - expHp}; unexplained source?)`);
    if (classHpSum < HD) flags.push(`HP: class HP ${classHpSum} looks stuck-low for ${HD} HD`);
    const hp = { HD, conMod, classHpSum, fcbHp, mhp, expected: expHp, sheet: actHp, maxPossible: maxPossible + conMod * HD + fcbHp };

    // ---- SKILLS (adventuring + Unchained background) ----
    let advPool = 0;
    for (const c of classes) {
      advPool += Math.max(1, (c.system.skillsPerLevel || 0) + intMod) * (c.system.level || 0);
      advPool += (c.system.fc?.skill?.value || 0);
    }
    let bonusSkill = 0;
    for (const i of a.items) for (const ch of (i.system.changes || [])) if (ch.target === "bonusSkillRanks") bonusSkill += ev(ch.formula, HD);
    advPool += bonusSkill;
    const bgPool = 2 * HD;
    let advPlaced = 0, bgPlaced = 0;
    for (const sk of Object.values(sys.skills || {})) {
      const acc = s => { if (s.background) bgPlaced += (s.rank || 0); else advPlaced += (s.rank || 0); };
      acc(sk); if (sk.subSkills) for (const ss of Object.values(sk.subSkills)) acc(ss);
    }
    // Unchained: background ranks go only to background skills, but normal ranks
    // MAY be spent on background skills. So the only real violations are adventuring
    // skills exceeding the adventuring pool, or total ranks exceeding total pool.
    const totalPool = advPool + bgPool, totalPlaced = advPlaced + bgPlaced;
    if (advPlaced > advPool) flags.push(`Skills: adventuring ${advPlaced}/${advPool} OVER (bg ranks can't cover)`);
    else if (totalPlaced > totalPool) flags.push(`Skills: total ${totalPlaced}/${totalPool} ranks OVER`);
    const skills = { advPool, advPlaced, bgPool, bgPlaced, totalPool, totalPlaced, bonusSkillRanks: bonusSkill };

    // ---- FEATS ----
    const featItems = a.items.filter(i => i.type === "feat" && i.system.subType === "feat");
    const bonusRe = /dana|artwork|salem|bday|birthday|boaster|archetype|free feat|bonus feat|\(fgt\)/i;
    const bonus = featItems.filter(i => bonusRe.test(i.name)).map(i => i.name);
    const regular = featItems.filter(i => !bonusRe.test(i.name)).map(i => i.name);
    // Expected TOTAL feats: general (1,3,5...) + human + class bonus feats + 2 universal
    // event free feats (artwork + salem). Archetype bonus feats (e.g. Boaster Endurance)
    // add noise, so treat deltas of ±1 as "review", not hard errors.
    let classBonus = 0;
    for (const c of classes) {
      const lv = c.system.level || 0;
      if (/fighter/i.test(c.name)) classBonus += 1 + Math.floor(lv / 2);       // 1st + every even
      if (/ranger/i.test(c.name)) classBonus += (lv >= 2 ? 1 : 0) + (lv >= 3 ? 1 : 0); // combat style + Endurance
    }
    const expectedTotal = Math.ceil(level / 2) + (isHuman ? 1 : 0) + classBonus + 2;
    const delta = featItems.length - expectedTotal;
    if (delta !== 0) flags.push(`Feats: ${featItems.length} total vs ~${expectedTotal} expected (Δ${delta>0?"+":""}${delta}; lvl ${Math.ceil(level/2)}${isHuman?" +1 human":""}${classBonus?` +${classBonus} class`:""} +2 event — archetype feats may explain)`);
    const feats = { total: featItems.length, expectedTotal, names: featItems.map(i => i.name) };

    // ---- TRAITS ----
    const traits = a.items.filter(i => i.type === "feat" && i.system.subType === "trait").map(i => i.name);
    const drawbacks = a.items.filter(i => i.type === "feat" && i.system.subType === "drawback").map(i => i.name);
    const tb = a.items.find(i => i.system.tag === "tripleBirthdays2026");
    let bdayTraitPicks = 0;
    if (tb) for (const ch of (tb.system.links?.children || [])) {
      const id = String(ch.uuid).split(".Item.").pop();
      const d = a.items.get(id);
      if (d?.system?.subType === "trait") bdayTraitPicks++;
    }
    const expectedTraits = 2 + drawbacks.length + bdayTraitPicks;
    if (traits.length !== expectedTraits) flags.push(`Traits: ${traits.length} vs expected ${expectedTraits} (2 base${drawbacks.length?` +${drawbacks.length} drawback`:""}${bdayTraitPicks?` +${bdayTraitPicks} bday`:""})`);
    const traitInfo = { count: traits.length, expected: expectedTraits, traits, drawbacks, bdayTraitPicks };

    // ---- CLASS FEATURES (presence vs class associations) ----
    // Match on prefix so variant names ("Favored Terrain: Desert +4") satisfy the
    // bare association ("Favored Terrain").
    const presentNames = a.items.filter(i => i.type === "feat").map(i => norm(i.name));
    const has = nm => { const n = norm(nm); return presentNames.some(p => p === n || p.startsWith(n + " ")); };
    const classFeatures = [];
    for (const c of classes) {
      const assoc = (c.system.links?.classAssociations || []).filter(x => (x.level || 0) <= (c.system.level || 0));
      const missing = [];
      for (const x of assoc) {
        let nm = x.name || (x.uuid ? await nameFromCompendium(x.uuid) : null);
        if (nm && !has(nm)) missing.push(nm);
      }
      classFeatures.push({ class: c.name, subType: c.system.subType, level: c.system.level, expected: assoc.length, missing });
      if (missing.length) flags.push(`${c.name}: ${missing.length} class feature(s) absent (may be archetype-replaced): ${missing.join(", ")}`);
    }

    report.push({ name: a.name, race: a.items.find(i => i.type === "race")?.name, level,
      classes: classes.map(c => `${c.name} ${c.system.level}`), hp, skills, feats, traits: traitInfo, classFeatures, flags });
  }
  return JSON.stringify(report, null, 1);
})()
