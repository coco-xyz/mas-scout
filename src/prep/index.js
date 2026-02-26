/**
 * MAS Scout Prep — 回复处理与会前准备
 *
 * 输入：潜在客户的回复 / 完整客户档案
 * 输出：回复分类 + 会前简报
 *
 * LLM-powered with keyword fallback when API key not configured.
 */

import { callLLM, callLLMJson } from '../shared/llm.js';
import { REGULATORY_HOOKS } from '../outreach/index.js';

/**
 * 回复分类 — LLM with keyword fallback
 * @param {string} replyText
 * @param {{ company?: string, contact?: string }} [context]
 * @returns {Promise<{ category: 'positive'|'neutral'|'objection'|'negative', confidence: number, reasoning: string, suggestedAction: string }>}
 */
async function classifyReply(replyText, context = {}) {
  const systemPrompt = `You are a sales reply classifier for Cynopsis Solutions (RegTech, Singapore). Classify prospect replies into exactly one category.

Categories:
- positive: interested in meeting, demo, call, wants more info
- neutral: polite acknowledgment, forwarded to someone, will review later
- objection: has concerns (budget, timing, existing vendor) but not outright rejection
- negative: not interested, unsubscribe, do not contact

Output JSON only:
{
  "category": "positive|neutral|objection|negative",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "suggestedAction": "what to do next"
}`;

  const userPrompt = `Classify this reply${context.company ? ` from ${context.contact || 'someone'} at ${context.company}` : ''}:

"${replyText}"`;

  const result = await callLLMJson(systemPrompt, userPrompt, { maxTokens: 256 });

  if (result && result.category) {
    return {
      category: result.category,
      confidence: result.confidence || 0.8,
      reasoning: result.reasoning || '',
      suggestedAction: result.suggestedAction || '',
    };
  }

  // Keyword fallback
  const category = classifyByKeywords(replyText);
  return {
    category,
    confidence: 0.5,
    reasoning: 'Keyword-based classification (LLM unavailable)',
    suggestedAction: FALLBACK_ACTIONS[category],
  };
}

const FALLBACK_ACTIONS = {
  positive: 'Schedule a call within 24 hours',
  neutral: 'Send follow-up in 3 days',
  objection: 'Address specific concern, send case study',
  negative: 'Mark as opted out, stop sequence',
};

function classifyByKeywords(replyText) {
  const text = replyText.toLowerCase();
  if (text.includes('not interested') || text.includes('unsubscribe') || text.includes('remove') || text.includes('stop')) {
    return 'negative';
  }
  if (text.includes('interested') || text.includes('schedule') || text.includes('call') || text.includes('demo') || text.includes('meet')) {
    return 'positive';
  }
  if (text.includes('already have') || text.includes('budget') || text.includes('later') || text.includes('not now') || text.includes('next quarter')) {
    return 'objection';
  }
  return 'neutral';
}

/**
 * 生成会前简报 — LLM-powered
 * @param {{ company: object, contact: object, licenseType: string, enrichedData?: object }} prospect
 * @returns {Promise<string>} Markdown brief
 */
async function generateBrief(prospect) {
  console.log(`[prep] 生成会前简报: ${prospect.company.name}`);

  const hook = REGULATORY_HOOKS[prospect.licenseType] || {
    obligation: 'MAS regulations require KYC/AML compliance programs',
    products: ['Artemis (KYC)'],
  };

  const enriched = prospect.enrichedData || {};
  const contacts = enriched.contacts || [];
  const companyInfo = enriched.companyInfo || {};

  const systemPrompt = `You are a sales intelligence analyst at Cynopsis Solutions (RegTech company in Singapore). Generate a concise, actionable pre-meeting brief in English. Use Markdown formatting.

The brief should help a sales rep prepare for a first call with a newly MAS-licensed company. Focus on:
1. Company context — what they do, size, recent developments
2. Regulatory requirements specific to their license
3. Key decision makers and their likely concerns
4. Talking points and potential objections
5. Product recommendations with rationale

Be specific and practical. No fluff.`;

  const userPrompt = `Generate a pre-meeting brief for:

**Company:** ${prospect.company.name}
**License Type:** ${prospect.licenseType}
**Regulatory Obligation:** ${hook.obligation}
**Address:** ${prospect.company.address || 'Unknown'}
**Website:** ${prospect.company.website || 'Unknown'}
${companyInfo.description ? `**Description:** ${companyInfo.description}` : ''}
${companyInfo.headcount ? `**Team Size:** ~${companyInfo.headcount}` : ''}

**Primary Contact:** ${prospect.contact.name} (${prospect.contact.title})
${contacts.length > 1 ? `**Other Contacts:** ${contacts.slice(1).map(c => `${c.name} (${c.title})`).join(', ')}` : ''}

**Recommended Products:** ${hook.products.join(', ')}`;

  const llmBrief = await callLLM(systemPrompt, userPrompt, { maxTokens: 2048 });

  if (llmBrief) return llmBrief;

  // Template fallback
  return generateTemplateBrief(prospect, hook, contacts);
}

function generateTemplateBrief(prospect, hook, contacts) {
  const sections = [
    `# Pre-Meeting Brief — ${prospect.company.name}`,
    '',
    `## Company Overview`,
    `- **Company:** ${prospect.company.name}`,
    `- **License:** ${prospect.licenseType}`,
    `- **Address:** ${prospect.company.address || 'Unknown'}`,
    `- **Website:** ${prospect.company.website || 'Unknown'}`,
    '',
    `## Primary Contact`,
    `- **Name:** ${prospect.contact.name}`,
    `- **Title:** ${prospect.contact.title}`,
    ...(contacts.length > 1 ? [
      '',
      `## Other Decision Makers`,
      ...contacts.slice(1).map(c => `- ${c.name} — ${c.title}`),
    ] : []),
    '',
    `## Regulatory Requirements`,
    `${hook.obligation}`,
    '',
    `Key compliance areas:`,
    `- Customer Due Diligence (CDD)`,
    `- Transaction Monitoring (TM)`,
    `- Suspicious Transaction Reports (STR)`,
    `- Record Keeping & Reporting`,
    '',
    `## Recommended Products`,
    ...hook.products.map(p => `- **${p}**`),
    '',
    `## Talking Points`,
    `1. Congratulate on license — understand their compliance setup timeline`,
    `2. Ask about current compliance infrastructure and pain points`,
    `3. Share relevant case studies from similar licensees`,
    `4. Position Cynopsis as compliance acceleration partner`,
    `5. Propose a compliance readiness assessment (free)`,
    '',
    `## Potential Objections`,
    `- "We already have a compliance vendor" → Offer complementary capabilities`,
    `- "Not a priority right now" → Emphasize MAS enforcement timeline`,
    `- "Budget constraints" → Start with Artemis KYC (most cost-effective)`,
  ];

  return sections.join('\n');
}

export { classifyReply, generateBrief };
