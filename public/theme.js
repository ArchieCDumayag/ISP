
const Theme = (() => {
  const get = () => document.documentElement.dataset.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const set = theme => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
    window.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
  };

  const applySaved = () => set(localStorage.getItem('theme') || get());

  const toggle = () => set(get() === 'light' ? 'dark' : 'light');

  const bind = container => {
    const btn = (container || document).querySelector('[data-toggle="theme"]');
    if (btn) btn.onclick = toggle;
  };

  return { get, set, applySaved, toggle, bind };
})();
