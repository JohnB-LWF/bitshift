export const $ = id => document.getElementById(id);
export function modal(html) { $('dialog-content').innerHTML = html; if (!$('dialog').open) $('dialog').showModal(); }
export function closeModal() { $('dialog').close(); }
export function animate(el, name) {
  return new Promise(resolve => {
    el.classList.remove('chunk--correct', 'chunk--incorrect', 'fall', 'drop');
    void el.offsetWidth;
    el.classList.add(name);
    let timer;
    const finish = () => { clearTimeout(timer); el.removeEventListener('animationend', finish); el.classList.remove(name); resolve(); };
    el.addEventListener('animationend', finish, { once: true });
    timer = setTimeout(finish, 900);
  });
}
export function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
