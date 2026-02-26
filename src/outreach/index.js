/**
 * MAS Scout Outreach — 个性化多渠道外联
 *
 * 输入：完整客户档案（公司 + 联系人 + 牌照类型）
 * 输出：自动化外联序列 + 人工审核门控
 */

import { callLLM } from '../shared/llm.js';

const CONFIDENCE_THRESHOLD = 0.7;

/**
 * 按牌照类型获取监管义务模板
 */
const REGULATORY_HOOKS = {
  'Capital Markets Services Licensee': {
    obligation: 'SFA 第 339 条要求 CMS 持牌人建立完善的 KYC/AML 程序',
    products: ['Artemis (KYC)', 'Athena (交易监控)'],
  },
  'Major Payment Institution': {
    obligation: 'PSA 第 29 条要求 MPI 持有人实施客户尽职调查和交易监控',
    products: ['Artemis (KYC)', 'Athena (交易监控)', 'Iris (合规顾问)'],
  },
  'Standard Payment Institution': {
    obligation: 'PSA 要求 SPI 实施基础反洗钱程序',
    products: ['Artemis (KYC)'],
  },
};

/**
 * 计算 prospect 置信度分数
 * @param {{ company: object, contact: object, licenseType: string }} prospect
 * @returns {number} 0-1 confidence score
 */
function calculateConfidence(prospect) {
  let score = 0;
  // Known license type
  if (REGULATORY_HOOKS[prospect.licenseType]) score += 0.3;
  // Has contact email
  if (prospect.contact?.email) score += 0.25;
  // Has contact title matching compliance roles
  if (prospect.contact?.title) {
    const title = prospect.contact.title.toLowerCase();
    const complianceKeywords = ['compliance', 'cco', 'mlro', 'aml', 'kyc', 'regulatory'];
    if (complianceKeywords.some(k => title.includes(k))) score += 0.25;
  }
  // Has company info
  if (prospect.company?.name && prospect.company?.website) score += 0.2;
  return Math.min(score, 1);
}

/**
 * 生成个性化邮件内容
 * @param {{ company: object, contact: object, licenseType: string }} prospect
 * @returns {Promise<string>}
 */
async function generateEmail(prospect) {
  const hook = REGULATORY_HOOKS[prospect.licenseType] || {
    obligation: '合规法规要求建立 KYC/AML 系统',
    products: ['Artemis (KYC)'],
  };

  console.log(`[outreach] 生成邮件: ${prospect.contact.name} @ ${prospect.company.name}`);

  const systemPrompt = `You are a sales development representative at Cynopsis Solutions, a RegTech company in Singapore. Write professional, concise outreach emails in English. The tone should be congratulatory but focused on regulatory obligations. Never be pushy. Always reference the specific regulation.`;

  const userPrompt = `Write a personalized cold email to:
- Name: ${prospect.contact.name}
- Title: ${prospect.contact.title}
- Company: ${prospect.company.name}
- License type: ${prospect.licenseType}
- Regulatory obligation: ${hook.obligation}
- Recommended products: ${hook.products.join(', ')}
${prospect.company.headcount ? `- Company size: ~${prospect.company.headcount} employees` : ''}

The email should:
1. Congratulate them on obtaining the MAS license
2. Briefly mention the regulatory compliance obligations
3. Position Cynopsis products as a solution
4. End with a soft CTA (15-min call)

Keep it under 200 words. Output only the email body, no subject line.`;

  const llmResult = await callLLM(systemPrompt, userPrompt);

  if (llmResult) return llmResult;

  // Fallback template
  return `Dear ${prospect.contact.name},

Congratulations to ${prospect.company.name} on obtaining the ${prospect.licenseType} license from MAS.

As you may know, ${hook.obligation}. Building a robust compliance infrastructure early is critical to avoiding regulatory penalties.

At Cynopsis Solutions, we help newly licensed firms get compliance-ready with ${hook.products.join(' and ')} — trusted by 100+ financial institutions across Asia Pacific.

Would you be open to a brief 15-minute call to discuss how we can support ${prospect.company.name}'s compliance setup?

Best regards,
Cynopsis Solutions`;
}

/**
 * 生成 LinkedIn 连接请求消息
 * @param {{ company: object, contact: object, licenseType: string }} prospect
 * @returns {Promise<string>}
 */
async function generateLinkedInConnect(prospect) {
  const systemPrompt = `Write a short LinkedIn connection request message (under 300 characters). Professional, friendly, reference their new MAS license.`;
  const userPrompt = `Connection request to ${prospect.contact.name} (${prospect.contact.title}) at ${prospect.company.name}, recently licensed as ${prospect.licenseType}.`;

  const llmResult = await callLLM(systemPrompt, userPrompt);

  return llmResult || `Hi ${prospect.contact.name}, congratulations on ${prospect.company.name}'s MAS ${prospect.licenseType} license! I work with RegTech solutions for newly licensed firms — would love to connect.`;
}

/**
 * 生成 LinkedIn 跟进消息
 * @param {{ company: object, contact: object, licenseType: string }} prospect
 * @returns {Promise<string>}
 */
async function generateLinkedInFollowUp(prospect) {
  const hook = REGULATORY_HOOKS[prospect.licenseType] || { products: ['Artemis (KYC)'] };
  const systemPrompt = `Write a brief LinkedIn follow-up message (under 500 characters). Reference regulatory obligations, offer value, suggest a call.`;
  const userPrompt = `Follow-up message to ${prospect.contact.name} at ${prospect.company.name} (${prospect.licenseType}). Products to mention: ${hook.products.join(', ')}.`;

  const llmResult = await callLLM(systemPrompt, userPrompt);

  return llmResult || `Hi ${prospect.contact.name}, following up on my connection request. With the ${prospect.licenseType} license, ${prospect.company.name} will need to set up ${hook.products[0]} systems. Happy to share how other newly licensed firms have approached this. Open to a quick chat?`;
}

/**
 * 生成跟进邮件
 * @param {{ company: object, contact: object, licenseType: string }} prospect
 * @returns {Promise<string>}
 */
async function generateFollowUpEmail(prospect) {
  const systemPrompt = `Write a brief follow-up email (under 150 words). Reference the original email, add urgency around compliance deadlines, offer a resource (whitepaper/case study).`;
  const userPrompt = `Follow-up email to ${prospect.contact.name} (${prospect.contact.title}) at ${prospect.company.name}. License: ${prospect.licenseType}. This is day 10, no response to initial email.`;

  const llmResult = await callLLM(systemPrompt, userPrompt);

  return llmResult || `Dear ${prospect.contact.name},

I wanted to follow up on my previous email regarding ${prospect.company.name}'s compliance setup.

Many newly licensed firms find that the first 90 days are critical for establishing compliant operations. We recently published a guide on "MAS Compliance Readiness for New Licensees" — happy to share it.

Would a brief call this week work for you?

Best regards,
Cynopsis Solutions`;
}

/**
 * 创建多渠道外联序列（全部 LLM 生成）
 * @param {{ company: object, contact: object, licenseType: string }} prospect
 * @returns {Promise<{sequence: Array<{channel: string, day: number, content: string, status: string}>, confidence: number, requiresReview: boolean}>}
 */
async function createSequence(prospect) {
  const confidence = calculateConfidence(prospect);
  const requiresReview = confidence < CONFIDENCE_THRESHOLD;

  console.log(`[outreach] 创建序列: ${prospect.contact.name} @ ${prospect.company.name} (confidence: ${confidence.toFixed(2)}, review: ${requiresReview})`);

  const [emailContent, linkedInConnect, linkedInFollowUp, followUpEmail] = await Promise.all([
    generateEmail(prospect),
    generateLinkedInConnect(prospect),
    generateLinkedInFollowUp(prospect),
    generateFollowUpEmail(prospect),
  ]);

  const sequence = [
    { channel: 'email', day: 1, content: emailContent, status: requiresReview ? 'pending_review' : 'ready' },
    { channel: 'linkedin_connect', day: 3, content: linkedInConnect, status: requiresReview ? 'pending_review' : 'ready' },
    { channel: 'linkedin_message', day: 7, content: linkedInFollowUp, status: requiresReview ? 'pending_review' : 'ready' },
    { channel: 'email', day: 10, content: followUpEmail, status: requiresReview ? 'pending_review' : 'ready' },
  ];

  return { sequence, confidence, requiresReview };
}

/**
 * 审批序列中的某一步
 * @param {Array} sequence
 * @param {number} stepIndex
 * @param {'approved' | 'rejected' | 'edited'} decision
 * @param {string} [editedContent]
 * @returns {Array}
 */
function reviewStep(sequence, stepIndex, decision, editedContent) {
  if (stepIndex < 0 || stepIndex >= sequence.length) return sequence;
  const updated = [...sequence];
  if (decision === 'approved') {
    updated[stepIndex] = { ...updated[stepIndex], status: 'ready' };
  } else if (decision === 'edited' && editedContent) {
    updated[stepIndex] = { ...updated[stepIndex], content: editedContent, status: 'ready' };
  } else if (decision === 'rejected') {
    updated[stepIndex] = { ...updated[stepIndex], status: 'rejected' };
  }
  return updated;
}

export {
  generateEmail,
  createSequence,
  reviewStep,
  calculateConfidence,
  REGULATORY_HOOKS,
  CONFIDENCE_THRESHOLD,
};
