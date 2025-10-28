// live grammar checker for editable fields

// debounce helper
const debounce = (fn, ms=350) => {
  let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); };
};

// find editable elements
function isEditable(node){
  if (!node || node.nodeType !== 1) return false;
  const el = node;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT' && el.type === 'text') return true;
  if (el.isContentEditable) return true;
  return false;
}

// scan and bind
function forEachEditable(root, cb){
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
  let n = root; cb(n);
  while ((n = w.nextNode())) cb(n);
}

const overlayClass = 'pg-suggest-pop';

// create suggestion popup
function showPopup(target, suggestions){
  removePopup();
  const rect = target.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = overlayClass;
  pop.style.left = `${rect.left + window.scrollX}px`;
  pop.style.top  = `${rect.bottom + window.scrollY + 6}px`;
  pop.innerHTML = suggestions.map(s=>`<button data-repl="${s}">${s}</button>`).join('');
  document.body.appendChild(pop);
  pop.addEventListener('mousedown', e => {
    const btn = e.target.closest('button'); if (!btn) return;
    applyReplacement(target, btn.getAttribute('data-repl'));
    removePopup();
    e.preventDefault();
  });
  setTimeout(()=>document.addEventListener('mousedown', onDocDown, { once:true }), 0);
}
function removePopup(){
  const old = document.querySelector('.'+overlayClass);
  if (old) old.remove();
}
function onDocDown(e){
  if (!e.target.closest('.'+overlayClass)) removePopup();
}

// text getters/setters
function getText(el){
  if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text')) return el.value;
  return el.innerText;
}
function setText(el, text){
  if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text')) el.value = text;
  else el.innerText = text;
}

// apply single replacement
function applyReplacement(el, replacement){
  const data = el.__pg_lastProof;
  if (!data) return;
  const { text, start, end } = data; // last clicked range
  const before = text.slice(0, start);
  const after  = text.slice(end);
  const newText = before + replacement + after;
  setText(el, newText);
}

// underline builder
function renderUnderlines(el, issues){
  // remove previous marks
  el.querySelectorAll('span.pg-err').forEach(s=>{
    const p = s.parentNode; while(s.firstChild) p.insertBefore(s.firstChild, s); p.removeChild(s);
  });
  if (!issues || !issues.length) return;

  // only apply on contentEditable; inputs use native spellcheck styling
  if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text')) {
    // fallback: no wraps, rely on popup only
    el.__pg_ranges = issues.map(it => ({ start: it.startIndex, end: it.endIndex, repl: it.replacements?.[0]?.replacement || '' }));
    return;
  }

  // walk text nodes and wrap ranges
  const text = el.innerText;
  let cursor = 0;
  function wrapRange(start, end){
    // simple split approach
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let pos = 0, node;
    const spans = [];
    while ((node = walker.nextNode())) {
      const nextPos = pos + node.textContent.length;
      const hitStart = Math.max(start, pos);
      const hitEnd   = Math.min(end, nextPos);
      if (hitStart < hitEnd) {
        const relStart = hitStart - pos;
        const relEnd   = hitEnd - pos;
        const t = node.textContent;
        const before = document.createTextNode(t.slice(0, relStart));
        const mark   = document.createElement('span');
        mark.className = 'pg-err';
        mark.textContent = t.slice(relStart, relEnd);
        const after  = document.createTextNode(t.slice(relEnd));
        const parent = node.parentNode;
        parent.insertBefore(before, node);
        parent.insertBefore(mark, node);
        parent.insertBefore(after, node);
        parent.removeChild(node);
        spans.push(mark);
      }
      pos = nextPos;
      if (pos >= end) break;
    }
    spans.forEach((sp,i)=>{
      sp.addEventListener('click', (ev)=> {
        el.__pg_lastProof = { text, start, end };
        const sug = [];
        const match = issues.find(k => k.startIndex===start && k.endIndex===end);
        if (match && match.replacements) sug.push(...match.replacements.slice(0,3).map(x=>x.replacement));
        if (!sug.length && match?.suggestion) sug.push(match.suggestion);
        if (!sug.length) sug.push(sp.textContent);
        showPopup(sp, sug);
        ev.stopPropagation();
      });
    });
  }

  issues.forEach(it => wrapRange(it.startIndex, it.endIndex));
  el.__pg_text = text;
}

// proofread and render
const runProof = debounce(async (el) => {
  const text = getText(el);
  if (!text || !globalThis.Proofreader?.create) { renderUnderlines(el, []); return; }
  try {
    const pf = await Proofreader.create({ expectedInputLanguages: ['en'] });
    const res = await pf.proofread(text);
    const issues = (res?.changes || []).map(ch => ({
      startIndex: ch?.original?.startIndex ?? ch?.startIndex ?? 0,
      endIndex: ch?.original?.endIndex ?? ch?.endIndex ?? 0,
      replacements: ch?.replacements || (ch?.replacement ? [{ replacement: ch.replacement }] : [])
    })).filter(x => x.endIndex > x.startIndex);
    renderUnderlines(el, issues);
  } catch {
    renderUnderlines(el, []);
  }
}, 300);

// bind listener
function bind(el){
  if (!isEditable(el) || el.__pg_bound) return;
  el.__pg_bound = true;
  el.addEventListener('input', ()=> runProof(el));
  el.addEventListener('keyup', (e)=> { if (e.key === ' ') runProof(el); });
  el.addEventListener('change', ()=> runProof(el));
  runProof(el);
}

// observe DOM
const obs = new MutationObserver((muts)=> {
  muts.forEach(m => {
    m.addedNodes && m.addedNodes.forEach(n => { if (n.nodeType===1) forEachEditable(n, bind); });
    if (m.type === 'attributes' && isEditable(m.target)) bind(m.target);
  });
});
obs.observe(document.documentElement, { childList:true, subtree:true, attributes:true, attributeFilter:['contenteditable'] });

// first pass
forEachEditable(document.documentElement, bind);
