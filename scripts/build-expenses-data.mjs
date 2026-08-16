#!/usr/bin/env node
// Aggregates the Expenses app's per-expense source files into the single
// data/expenses.json the frontend consumes.
//
// Source of truth (committed):
//   apps/expenses/data/meta.json                          currency rates
//   apps/expenses/data/projects.json                      project registry
//   apps/expenses/data/categories.json                    category registry (shared)
//   apps/expenses/data/expenses/<project>/<yyyy>/<mm>/<id>.json  one expense per file
//
// Output (generated, gitignored — exists only in deploy output):
//   apps/expenses/data/expenses.json
//
// Usage:
//   node scripts/build-expenses-data.mjs           build (validates first)
//   node scripts/build-expenses-data.mjs --check   validate only (CI)

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'expenses');
const DATA_DIR = join(APP_DIR, 'data');
const EXPENSES_DIR = join(DATA_DIR, 'expenses');
const OUT_FILE = join(DATA_DIR, 'expenses.json');
const CHECK_ONLY = process.argv.includes('--check');

const errors = [];
const fail = (file, msg) => errors.push(`${file}: ${msg}`);

function readJSON(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    fail(label, `unreadable or invalid JSON (${e.message})`);
    return null;
  }
}

const meta = readJSON(join(DATA_DIR, 'meta.json'), 'data/meta.json');
const categories = readJSON(join(DATA_DIR, 'categories.json'), 'data/categories.json');
const projects = readJSON(join(DATA_DIR, 'projects.json'), 'data/projects.json');

const projectIds = new Set(Array.isArray(projects) ? projects.map((p) => p.id) : []);
if (Array.isArray(projects)) {
  if (!projects.length) fail('data/projects.json', 'at least one project is required');
  for (const p of projects) {
    if (!p.id || !/^[a-z0-9][a-z0-9-]*$/.test(p.id)) {
      fail('data/projects.json', `project id must be a lowercase slug, got ${JSON.stringify(p.id)}`);
    }
    if (!p.name) fail('data/projects.json', `project ${p.id} missing name`);
  }
  if (projectIds.size !== projects.length) fail('data/projects.json', 'duplicate project ids');
} else if (projects !== null) {
  fail('data/projects.json', 'must be an array of projects');
}

const categoryIds = new Set(Array.isArray(categories) ? categories.map((c) => c.id) : []);
if (Array.isArray(categories)) {
  for (const c of categories) {
    if (!c.id || !c.name) fail('data/categories.json', `category missing id or name: ${JSON.stringify(c)}`);
  }
}

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function validCurrency(cur) {
  return cur === 'EUR' || (meta && meta.fixedRates && typeof meta.fixedRates[cur] === 'number');
}

const expenses = [];
const records = []; // { exp, rel } for cross-file duplicate checks
const seenIds = new Map(); // id -> file that declared it

function checkExpense(exp, rel, year, month) {
  for (const key of ['id', 'date', 'amount', 'currency', 'vendor', 'category']) {
    if (exp[key] === undefined || exp[key] === '') fail(rel, `missing required field "${key}"`);
  }
  if (exp.id && rel.split('/').pop() !== `${exp.id}.json`) {
    fail(rel, `filename does not match id "${exp.id}"`);
  }
  if (exp.id) {
    if (seenIds.has(exp.id)) fail(rel, `duplicate id also declared in ${seenIds.get(exp.id)}`);
    else seenIds.set(exp.id, rel);
  }
  if (exp.date !== undefined) {
    if (typeof exp.date !== 'string' || !ISO_DATE.test(exp.date)) {
      fail(rel, `date "${exp.date}" is not an ISO YYYY-MM-DD date`);
    } else if (!exp.date.startsWith(`${year}-${month}-`)) {
      fail(rel, `date "${exp.date}" does not belong in folder ${year}/${month}/`);
    }
  }
  if (exp.amount !== undefined && (typeof exp.amount !== 'number' || !Number.isFinite(exp.amount) || exp.amount <= 0)) {
    fail(rel, `amount must be a positive number, got ${JSON.stringify(exp.amount)}`);
  }
  if (exp.currency !== undefined && !validCurrency(exp.currency)) {
    fail(rel, `currency "${exp.currency}" is not EUR and has no rate in meta.fixedRates`);
  }
  if (exp.category !== undefined && !categoryIds.has(exp.category)) {
    fail(rel, `unknown category "${exp.category}"`);
  }
  if (exp.attachments !== undefined) {
    if (!Array.isArray(exp.attachments)) {
      fail(rel, 'attachments must be an array');
      return;
    }
    for (const a of exp.attachments) {
      if (!a.file || !a.originalName) {
        fail(rel, `attachment missing file or originalName: ${JSON.stringify(a)}`);
        continue;
      }
      const abs = join(APP_DIR, a.file);
      if (!existsSync(abs)) {
        fail(rel, `attachment file not found on disk: ${a.file}`);
      } else if (typeof a.size === 'number' && statSync(abs).size !== a.size) {
        fail(rel, `attachment ${a.file} size ${statSync(abs).size} does not match declared ${a.size}`);
      }
      if (a.extractedText !== undefined && typeof a.extractedText !== 'string') {
        fail(rel, `attachment ${a.file} extractedText must be a string`);
      }
      // Content hash powers cheap exact-duplicate detection (grep for
      // the hash) — required on every attachment.
      if (typeof a.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(a.sha256)) {
        fail(rel, `attachment ${a.file} needs a "sha256" (64 lowercase hex chars)`);
      }
    }
  }
  if (exp.allowDuplicate !== undefined && exp.allowDuplicate !== true) {
    fail(rel, 'allowDuplicate, when present, must be exactly true');
  }
}

// A duplicate signal blocks the build unless the LATER expense carries
// "allowDuplicate": true — set only after the owner explicitly confirms
// the bill really is a second, intentional entry.
function checkDuplicates(records) {
  // A colliding pair is fine when EITHER side carries the confirmation
  // flag — directory order must not decide which file is "the copy".
  const byHash = new Map(); // attachment sha256 -> { rel, allow }
  const byKey = new Map(); // date|amount|currency|vendor -> { rel, allow }
  for (const { exp, rel } of records) {
    const allow = exp.allowDuplicate === true;
    for (const a of exp.attachments || []) {
      if (!a.sha256) continue;
      const first = byHash.get(a.sha256);
      if (first && !allow && !first.allow) {
        fail(rel, `attachment ${a.file} has the same sha256 as an attachment in ${first.rel} — same document uploaded twice; if intentional, set "allowDuplicate": true after the owner confirms`);
      } else if (!first) {
        byHash.set(a.sha256, { rel, allow });
      }
    }
    // Semantic duplicates are scoped per project (the same vendor and
    // amount on the same date can legitimately exist in two projects);
    // the sha256 check above stays global.
    const key = [exp.project, exp.date, exp.amount, exp.currency,
      String(exp.vendor || '').toLowerCase().replace(/\s+/g, ' ').trim()].join('|');
    const first = byKey.get(key);
    if (first && !allow && !first.allow) {
      fail(rel, `possible duplicate of ${first.rel} (same date + amount + currency + vendor); if intentional, set "allowDuplicate": true after the owner confirms`);
    } else if (!first) {
      byKey.set(key, { rel, allow });
    }
  }
}

if (existsSync(EXPENSES_DIR)) {
  for (const project of readdirSync(EXPENSES_DIR).sort()) {
    if (!projectIds.has(project)) {
      fail(`data/expenses/${project}`, 'directory does not match any project id in projects.json');
      continue;
    }
    for (const year of readdirSync(join(EXPENSES_DIR, project)).sort()) {
      if (!/^\d{4}$/.test(year)) {
        fail(`data/expenses/${project}/${year}`, 'not a 4-digit year directory');
        continue;
      }
      for (const month of readdirSync(join(EXPENSES_DIR, project, year)).sort()) {
        if (!/^(0[1-9]|1[0-2])$/.test(month)) {
          fail(`data/expenses/${project}/${year}/${month}`, 'not a 2-digit month directory (01-12)');
          continue;
        }
        for (const name of readdirSync(join(EXPENSES_DIR, project, year, month)).sort()) {
          const rel = `data/expenses/${project}/${year}/${month}/${name}`;
          if (!name.endsWith('.json')) {
            fail(rel, 'unexpected non-JSON file in expenses tree');
            continue;
          }
          const raw = readJSON(join(EXPENSES_DIR, project, year, month, name), rel);
          if (!raw) continue;
          if (raw.project !== undefined && raw.project !== project) {
            fail(rel, `declared project "${raw.project}" does not match folder ${project}/`);
          }
          checkExpense(raw, rel, year, month);
          // The folder is the source of truth for the project id; the
          // aggregate stamps it onto each expense for the frontend.
          const exp = { ...raw, project };
          records.push({ exp, rel });
          expenses.push(exp);
        }
      }
    }
  }
} else {
  fail('data/expenses', 'directory does not exist');
}

checkDuplicates(records);

if (errors.length) {
  console.error(`Expenses data validation FAILED (${errors.length} problem${errors.length === 1 ? '' : 's'}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`Validated ${expenses.length} expenses across ${projectIds.size} projects, ${categoryIds.size} categories.`);
if (CHECK_ONLY) process.exit(0);

expenses.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id)));
const out = {
  meta: { ...meta, updated: new Date().toISOString() },
  projects,
  categories,
  expenses,
};
writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${OUT_FILE}`);
