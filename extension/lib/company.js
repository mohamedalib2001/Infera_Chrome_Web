// The company that publishes and operates Infera Agent for Chrome: its public
// Companies House facts (England & Wales), the same as the platform's own record
// (apps/server/src/company.ts on inferaagent.com). A UK limited company shows its
// registered name, number, place of registration and registered office wherever it
// trades; the settings page and the agent's own description use these.
export const COMPANY = {
  legalName: 'Infera Engine Ltd',
  brand: 'Infera Agent',
  number: '17520775',
  registeredIn: { en: 'England and Wales', ar: 'إنجلترا وويلز' },
  incorporated: '2026-10-14',
  office: '128 City Road, London, EC1V 2NX, United Kingdom',
  website: 'https://inferaengine.com',
  product: 'https://inferaagent.com',
  privacyUrl: 'https://inferaagent.com/privacy',
  termsUrl: 'https://inferaagent.com/terms',
  emails: {
    support: 'support@inferaengine.com',
    privacy: 'privacy@inferaengine.com',
    legal: 'legal@inferaengine.com',
    security: 'security@inferaengine.com',
  },
};

// One disclosure line: name · place and number of registration · registered office.
export function companyLine(lang = 'en') {
  return lang === 'ar'
    ? `${COMPANY.legalName} — شركة خاصة محدودة بالأسهم مسجّلة في ${COMPANY.registeredIn.ar} (رقم الشركة ${COMPANY.number}). المقر المسجّل: ${COMPANY.office}.`
    : `${COMPANY.legalName} — a private company limited by shares, registered in ${COMPANY.registeredIn.en} (company no. ${COMPANY.number}). Registered office: ${COMPANY.office}.`;
}
