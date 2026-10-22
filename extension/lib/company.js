// The company that publishes and operates Infera Agent Web: its public
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
  // Registered with the UK Information Commissioner's Office as a data controller (renewed yearly).
  ico: { reference: 'ZC275369', registered: '2026-10-15', expires: '2027-10-14', url: 'https://ico.org.uk/ESDWebPages/Entry/ZC275369' },
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

// The data-protection registration line.
export function icoLine(lang = 'en') {
  return lang === 'ar'
    ? `مسجّلة لدى مكتب مفوّض المعلومات في المملكة المتحدة (ICO) كجهة متحكّمة في البيانات، برقم التسجيل ${COMPANY.ico.reference}.`
    : `Registered with the UK Information Commissioner's Office (ICO) as a data controller, registration reference ${COMPANY.ico.reference}.`;
}

// One disclosure line: name · place and number of registration · registered office.
export function companyLine(lang = 'en') {
  return lang === 'ar'
    ? `${COMPANY.legalName} — شركة خاصة محدودة بالأسهم مسجّلة في ${COMPANY.registeredIn.ar} (رقم الشركة ${COMPANY.number}). المقر المسجّل: ${COMPANY.office}.`
    : `${COMPANY.legalName} — a private company limited by shares, registered in ${COMPANY.registeredIn.en} (company no. ${COMPANY.number}). Registered office: ${COMPANY.office}.`;
}
