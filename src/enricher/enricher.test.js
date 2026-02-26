import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { normalizeCompanyName, resultMentionsCompany, parseLinkedInResult } from './scraper.js';

describe('rankContacts', () => {
  let rankContacts;

  before(async () => {
    const mod = await import('./index.js');
    rankContacts = mod.rankContacts;
  });

  it('should assign priority 1 to CCO', () => {
    const contacts = [
      { name: 'Alice', title: 'Chief Compliance Officer' },
    ];
    const ranked = rankContacts(contacts);
    assert.strictEqual(ranked[0].priority, 1);
  });

  it('should assign priority 1 to CCO abbreviation', () => {
    const contacts = [
      { name: 'Bob', title: 'CCO' },
    ];
    const ranked = rankContacts(contacts);
    assert.strictEqual(ranked[0].priority, 1);
  });

  it('should assign priority 2 to MLRO', () => {
    const contacts = [
      { name: 'Charlie', title: 'MLRO' },
    ];
    const ranked = rankContacts(contacts);
    assert.strictEqual(ranked[0].priority, 2);
  });

  it('should assign priority 2 to Money Laundering Reporting Officer', () => {
    const contacts = [
      { name: 'Diana', title: 'Money Laundering Reporting Officer' },
    ];
    const ranked = rankContacts(contacts);
    assert.strictEqual(ranked[0].priority, 2);
  });

  it('should assign priority 3 to Head of Compliance', () => {
    const contacts = [
      { name: 'Eve', title: 'Head of Compliance' },
    ];
    const ranked = rankContacts(contacts);
    assert.strictEqual(ranked[0].priority, 3);
  });

  it('should assign priority 4 to VP Compliance', () => {
    const contacts = [
      { name: 'Frank', title: 'VP Compliance' },
    ];
    const ranked = rankContacts(contacts);
    assert.strictEqual(ranked[0].priority, 4);
  });

  it('should assign priority 5 to Compliance Director', () => {
    const contacts = [
      { name: 'Grace', title: 'Compliance Director' },
    ];
    const ranked = rankContacts(contacts);
    assert.strictEqual(ranked[0].priority, 5);
  });

  it('should assign priority 99 to unknown titles', () => {
    const contacts = [
      { name: 'Hank', title: 'Software Engineer' },
    ];
    const ranked = rankContacts(contacts);
    assert.strictEqual(ranked[0].priority, 99);
  });

  it('should sort contacts by priority ascending', () => {
    const contacts = [
      { name: 'Low', title: 'Software Engineer' },
      { name: 'Mid', title: 'Head of Compliance' },
      { name: 'High', title: 'CCO' },
      { name: 'MedHigh', title: 'MLRO' },
    ];

    const ranked = rankContacts(contacts);
    assert.strictEqual(ranked[0].name, 'High');    // priority 1
    assert.strictEqual(ranked[1].name, 'MedHigh');  // priority 2
    assert.strictEqual(ranked[2].name, 'Mid');       // priority 3
    assert.strictEqual(ranked[3].name, 'Low');       // priority 99
  });

  it('should handle contacts with no title gracefully', () => {
    const contacts = [
      { name: 'NoTitle' },
    ];
    const ranked = rankContacts(contacts);
    assert.strictEqual(ranked[0].priority, 99);
  });

  it('should return an empty array for empty input', () => {
    const ranked = rankContacts([]);
    assert.deepStrictEqual(ranked, []);
  });
});

describe('searchContacts', () => {
  let searchContacts;

  before(async () => {
    const mod = await import('./index.js');
    searchContacts = mod.searchContacts;
  });

  it('should return an array', async () => {
    const result = await searchContacts('Test Company');
    assert.ok(Array.isArray(result), 'searchContacts should return an array');
  });
});

describe('enrichCompany', () => {
  let enrichCompany;

  before(async () => {
    const mod = await import('./index.js');
    enrichCompany = mod.enrichCompany;
  });

  it('should return an object with expected shape', async () => {
    const result = await enrichCompany('Test Company', 'https://example.com');
    assert.ok(typeof result === 'object', 'enrichCompany should return an object');
    assert.ok('headcount' in result, 'result should have headcount');
    assert.ok('fundingStage' in result, 'result should have fundingStage');
    assert.ok(Array.isArray(result.techStack), 'techStack should be an array');
    assert.ok(Array.isArray(result.recentNews), 'recentNews should be an array');
  });
});

describe('normalizeCompanyName', () => {
  it('should strip PTE. LTD.', () => {
    assert.strictEqual(normalizeCompanyName('HASHKEY DIGITAL ASSET GROUP PTE. LTD.'), 'HASHKEY DIGITAL ASSET GROUP');
  });

  it('should strip PRIVATE LIMITED', () => {
    assert.strictEqual(normalizeCompanyName('ABC PRIVATE LIMITED'), 'ABC');
  });

  it('should strip (SINGAPORE)', () => {
    assert.strictEqual(normalizeCompanyName('ABC (SINGAPORE) PTE LTD'), 'ABC');
  });

  it('should handle names without legal suffixes', () => {
    assert.strictEqual(normalizeCompanyName('OpenAI'), 'OpenAI');
  });
});

describe('resultMentionsCompany', () => {
  it('should match when company keyword is in title', () => {
    assert.strictEqual(
      resultMentionsCompany('HashKey Group CEO', 'Some snippet', 'HASHKEY DIGITAL ASSET GROUP PTE. LTD.'),
      true
    );
  });

  it('should not match unrelated result', () => {
    assert.strictEqual(
      resultMentionsCompany('Random Person at Google', 'Works at Google', 'HASHKEY DIGITAL ASSET GROUP PTE. LTD.'),
      false
    );
  });
});

describe('parseLinkedInResult', () => {
  it('should parse standard LinkedIn title format', () => {
    const result = parseLinkedInResult(
      'Jane Chen - CCO - ABC Pte Ltd | LinkedIn',
      '',
      'ABC Pte Ltd'
    );
    assert.strictEqual(result.name, 'Jane Chen');
    assert.strictEqual(result.title, 'CCO');
  });

  it('should parse name-only title and extract from snippet', () => {
    const result = parseLinkedInResult(
      'Jane Chen | LinkedIn',
      'Chief Compliance Officer at ABC.',
      'ABC Pte Ltd'
    );
    assert.strictEqual(result.name, 'Jane Chen');
    assert.ok(result.title.includes('Compliance'));
  });

  it('should return null for empty title', () => {
    const result = parseLinkedInResult('', '', 'Test');
    assert.strictEqual(result, null);
  });
});
