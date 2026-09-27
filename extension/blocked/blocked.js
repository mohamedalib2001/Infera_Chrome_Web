(() => {
  const q = new URLSearchParams(location.search);
  const ar = (navigator.language || '').startsWith('ar');
  document.documentElement.dir = ar ? 'rtl' : 'ltr';
  document.getElementById('h').textContent = ar ? 'حظر إنفرا إيجنت هذا الموقع' : 'Infera Agent blocked this site';
  document.getElementById('p').textContent = ar
    ? 'لا يعمل الوكيل على هذه الفئة من المواقع (مثل البنوك والتداول والعملات المشفرة والمحتوى الإباحي والمقرصن) أو على المواقع التي حظرتها مؤسستك. يمكنك فتح الموقع بنفسك في تبويب خارج مجموعة إنفرا.'
    : 'The agent does not operate on this category of sites (such as banking, trading, crypto, adult or pirated content) or on sites blocked by your organization. You can open the site yourself in a tab outside the Infera group.';
  document.getElementById('url').textContent = q.get('url') || '';
  document.getElementById('reason').textContent = q.get('reason') || '';
})();
