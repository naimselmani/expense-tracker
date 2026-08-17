#!/usr/bin/env node
// Aggregates the Expenses app's per-expense source files into the single
// data/expenses.json the frontend consumes.
//
// Source of truth (committed):
//   data/meta.json                          currency rates
//   data/projects.json                      project registry
//   data/categories.json                    expense category registry (shared)
//   data/stages.json                        project lifecycle stages, ordered
//   data/doctypes.json                      document types, each mapped to a stage
//   data/expenses/<project>/<yyyy>/<mm>/<id>.json   one expense per file
//   data/documents/<project>/<yyyy>/<mm>/<id>.json  one document per file
//
// Expenses are money; documents are the paper trail (contract, property
// extract, construction permit). They live in separate trees and never mix.
//
// Output (generated, gitignored — exists only in deploy output):
//   data/expenses.json
//
// Usage:
//   node scripts/build-expenses-data.mjs           build (validates first)
//   node scripts/build-expenses-data.mjs --check   validate only (CI)

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(APP_DIR, 'data');
const EXPENSES_DIR = join(DATA_DIR, 'expenses');
const DOCUMENTS_DIR = join(DATA_DIR, 'documents');
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
const stages = readJSON(join(DATA_DIR, 'stages.json'), 'data/stages.json');
const docTypes = readJSON(join(DATA_DIR, 'doctypes.json'), 'data/doctypes.json');

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

const stageIds = new Set(Array.isArray(stages) ? stages.map((s) => s.id) : []);
if (Array.isArray(stages)) {
  for (const s of stages) {
    if (!s.id || !s.name) fail('data/stages.json', `stage missing id or name: ${JSON.stringify(s)}`);
    if (typeof s.order !== 'number') fail('data/stages.json', `stage ${s.id} needs a numeric order`);
  }
  if (stageIds.size !== stages.length) fail('data/stages.json', 'duplicate stage ids');
}

const docTypeIds = new Set(Array.isArray(docTypes) ? docTypes.map((t) => t.id) : []);
if (Array.isArray(docTypes)) {
  for (const t of docTypes) {
    if (!t.id || !t.name) fail('data/doctypes.json', `document type missing id or name: ${JSON.stringify(t)}`);
    // `stage` is optional — "other" deliberately advances nothing.
    if (t.stage !== undefined && !stageIds.has(t.stage)) {
      fail('data/doctypes.json', `document type ${t.id} references unknown stage "${t.stage}"`);
    }
  }
  if (docTypeIds.size !== docTypes.length) fail('data/doctypes.json', 'duplicate document type ids');
}

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function validCurrency(cur) {
  return cur === 'EUR' || (meta && meta.fixedRates && typeof meta.fixedRates[cur] === 'number');
}

const expenses = [];
const documents = [];
const records = []; // { exp, rel } for cross-file duplicate checks
const docRecords = []; // { doc, rel } — same, for the document tree
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
  checkAttachments(exp.attachments, rel);
  if (exp.allowDuplicate !== undefined && exp.allowDuplicate !== true) {
    fail(rel, 'allowDuplicate, when present, must be exactly true');
  }
}

// Shared by expenses and documents — both store scans the same way, under
// files/<guid>.<ext> with a content hash and the transcribed text.
function checkAttachments(atts, rel) {
  if (atts === undefined) return;
  if (!Array.isArray(atts)) {
    fail(rel, 'attachments must be an array');
    return;
  }
  for (const a of atts) {
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

// A document is the paper trail, not money: a contract, a property extract,
// a construction permit. Its type maps to a lifecycle stage, which is how the
// app works out how far a project has progressed.
function checkDocument(doc, rel, year, month) {
  for (const key of ['id', 'date', 'type', 'title']) {
    if (doc[key] === undefined || doc[key] === '') fail(rel, `missing required field "${key}"`);
  }
  if (doc.id && rel.split('/').pop() !== `${doc.id}.json`) {
    fail(rel, `filename does not match id "${doc.id}"`);
  }
  if (doc.id) {
    if (seenIds.has(doc.id)) fail(rel, `duplicate id also declared in ${seenIds.get(doc.id)}`);
    else seenIds.set(doc.id, rel);
  }
  if (doc.date !== undefined) {
    if (typeof doc.date !== 'string' || !ISO_DATE.test(doc.date)) {
      fail(rel, `date "${doc.date}" is not an ISO YYYY-MM-DD date`);
    } else if (!doc.date.startsWith(`${year}-${month}-`)) {
      fail(rel, `date "${doc.date}" does not belong in folder ${year}/${month}/`);
    }
  }
  if (doc.type !== undefined && !docTypeIds.has(doc.type)) {
    fail(rel, `unknown document type "${doc.type}"`);
  }
  if (doc.amount !== undefined) {
    fail(rel, 'documents do not carry an amount — post the cost as an expense under data/expenses/ instead');
  }
  checkAttachments(doc.attachments, rel);
  if (doc.allowDuplicate !== undefined && doc.allowDuplicate !== true) {
    fail(rel, 'allowDuplicate, when present, must be exactly true');
  }
}

// A duplicate signal blocks the build unless the LATER expense carries
// "allowDuplicate": true — set only after the owner explicitly confirms
// the bill really is a second, intentional entry.
// Documents get the same duplicate guard, and the hash side is seeded with
// the expense attachments so one scan cannot be filed as both an expense
// receipt and a project document without confirmation.
function checkDocumentDuplicates(docRecs, expRecs) {
  const byHash = new Map(); // sha256 -> { rel, allow }
  for (const { exp, rel } of expRecs) {
    for (const a of exp.attachments || []) {
      if (a.sha256 && !byHash.has(a.sha256)) {
        byHash.set(a.sha256, { rel, allow: exp.allowDuplicate === true });
      }
    }
  }
  const byKey = new Map(); // project|type|date|reference -> { rel, allow }
  for (const { doc, rel } of docRecs) {
    const allow = doc.allowDuplicate === true;
    for (const a of doc.attachments || []) {
      if (!a.sha256) continue;
      const first = byHash.get(a.sha256);
      if (first && !allow && !first.allow) {
        fail(rel, `attachment ${a.file} has the same sha256 as an attachment in ${first.rel} — same file recorded twice; if intentional, set "allowDuplicate": true after the owner confirms`);
      } else if (!first) {
        byHash.set(a.sha256, { rel, allow });
      }
    }
    const key = [doc.project, doc.type, doc.date,
      String(doc.reference || doc.title || '').toLowerCase().replace(/\s+/g, ' ').trim()].join('|');
    const first = byKey.get(key);
    if (first && !allow && !first.allow) {
      fail(rel, `possible duplicate of ${first.rel} (same project + type + date + reference); if intentional, set "allowDuplicate": true after the owner confirms`);
    } else if (!first) {
      byKey.set(key, { rel, allow });
    }
  }
}

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
  // A ledger with no expenses yet is a valid state — a fresh project set
  // before the first bill is posted. Git cannot track the empty directory,
  // so its absence must not fail the build; the aggregate is simply empty.
  console.warn('data/expenses/ does not exist yet — building an empty ledger.');
}

// Documents live in their own tree, deliberately separate from expenses: an
// invoice is money, a contract or permit is the paper trail. Same folder
// shape so both are cheap to grep and scale the same way.
if (existsSync(DOCUMENTS_DIR)) {
  for (const project of readdirSync(DOCUMENTS_DIR).sort()) {
    if (!projectIds.has(project)) {
      fail(`data/documents/${project}`, 'directory does not match any project id in projects.json');
      continue;
    }
    for (const year of readdirSync(join(DOCUMENTS_DIR, project)).sort()) {
      if (!/^\d{4}$/.test(year)) {
        fail(`data/documents/${project}/${year}`, 'not a 4-digit year directory');
        continue;
      }
      for (const month of readdirSync(join(DOCUMENTS_DIR, project, year)).sort()) {
        if (!/^(0[1-9]|1[0-2])$/.test(month)) {
          fail(`data/documents/${project}/${year}/${month}`, 'not a 2-digit month directory (01-12)');
          continue;
        }
        for (const name of readdirSync(join(DOCUMENTS_DIR, project, year, month)).sort()) {
          const rel = `data/documents/${project}/${year}/${month}/${name}`;
          if (!name.endsWith('.json')) {
            fail(rel, 'unexpected non-JSON file in documents tree');
            continue;
          }
          const raw = readJSON(join(DOCUMENTS_DIR, project, year, month, name), rel);
          if (!raw) continue;
          if (raw.project !== undefined && raw.project !== project) {
            fail(rel, `declared project "${raw.project}" does not match folder ${project}/`);
          }
          checkDocument(raw, rel, year, month);
          const doc = { ...raw, project };
          docRecords.push({ doc, rel });
          documents.push(doc);
        }
      }
    }
  }
}

checkDuplicates(records);
checkDocumentDuplicates(docRecords, records);

if (errors.length) {
  console.error(`Expenses data validation FAILED (${errors.length} problem${errors.length === 1 ? '' : 's'}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`Validated ${expenses.length} expenses and ${documents.length} documents across ${projectIds.size} projects, ${categoryIds.size} categories, ${docTypeIds.size} document types.`);
if (CHECK_ONLY) process.exit(0);

const byDateThenId = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id));
expenses.sort(byDateThenId);
documents.sort(byDateThenId);
const out = {
  meta: { ...meta, updated: new Date().toISOString() },
  projects,
  categories,
  stages,
  docTypes,
  expenses,
  documents,
};
writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${OUT_FILE}`);
