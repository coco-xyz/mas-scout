/**
 * MAS Scout Outreach — 个性化多渠道外联
 *
 * 输入：完整客户档案（公司 + 联系人 + 牌照类型）
 * 输出：自动化外联序列
 *
 * 职责：
 * 1. 按牌照类型生成个性化邮件内容
 * 2. 多渠道序列调度：Email → LinkedIn → Follow-up
 * 3. 人工审核门控（高置信度自动、边缘case人工）
 *
 * TODO: Lucy 实现
 */

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
 * 生成个性化邮件内容
 * @param {{ company: object, contact: object, licenseType: string }} prospect
 * @returns {Promise<string>}
 */
async function generateEmail(prospect) {
  // TODO: LLM 集成生成个性化内容
  const hook = REGULATORY_HOOKS[prospect.licenseType] || {
    obligation: '合规法规要求建立 KYC/AML 系统',
    products: ['Artemis (KYC)'],
  };

  console.log(`[outreach] 生成邮件: ${prospect.contact.name} @ ${prospect.company.name}`);
  return `邮件模板占位 — ${prospect.company.name} / ${hook.obligation}`;
}

/**
 * 创建多渠道外联序列
 * @param {{ company: object, contact: object, licenseType: string }} prospect
 * @returns {Promise<Array<{channel: string, day: number, content: string}>>}
 */
async function createSequence(prospect) {
  // TODO: 完整序列生成
  const emailContent = await generateEmail(prospect);

  return [
    { channel: 'email', day: 1, content: emailContent },
    { channel: 'linkedin', day: 3, content: 'LinkedIn 连接请求' },
    { channel: 'linkedin', day: 7, content: 'LinkedIn 消息跟进' },
    { channel: 'email', day: 10, content: '跟进邮件' },
  ];
}

export { generateEmail, createSequence, REGULATORY_HOOKS };
