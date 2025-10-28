// basic helpers and state keys
const $ = (id) => document.getElementById(id);
const STOR_KEY = 'polyglot_boxes_v1';
const HIST_KEY = 'polyglot_history_v1';
const THEME_KEY = 'polyglot_theme';

// dom refs
const inputEl  = $('input');
const statusEl = $('status-hint');
const boxSummary = $('box-summary');
const boxTranslation = $('box-translation');
const boxNotes = $('box-notes');
const boxQuiz = $('box-quiz');
const boxSources = $('box-sources');
const langEl = $('lang');

// buttons
$('btn-summarize').onclick = withLoading($('btn-summarize'),'Summarizing…', doSummarize);
$('btn-translate').onclick = withLoading($('btn-translate'),'Translating…', doTranslate);
$('btn-notes').onclick     = withLoading($('btn-notes'),'Working…', doNotes);
$('btn-quiz').onclick      = withLoading($('btn-quiz'),'Working…', doQuiz);
$('btn-sources').onclick   = withLoading($('btn-sources'),'Searching…', doFindSources);

$('btn-minimize').onclick = () => { document.body.classList.toggle('collapsed'); saveState(); };
$('btn-quit').onclick = quitClean;
$('btn-theme').onclick = toggleTheme;
$('btn-history').onclick = openHistory;
$('btn-history-close').onclick = closeHistory;
$('btn-history-clear').onclick = clearHistory;

// loading wrapper
function withLoading(btn, label, fn){
  return async () => {
    const prev = btn.textContent;
    btn.disabled = true; btn.textContent = label;
    try { await fn(); } finally { btn.disabled = false; btn.textContent = prev; }
  };
}

// capability checks
const lmAvailable          = () => !!(globalThis.LanguageModel || globalThis.Prompt);
const summarizerAvailable  = () => !!globalThis.Summarizer;
const translatorAvailable  = () => !!globalThis.Translator;
const detectorAvailable    = () => !!globalThis.LanguageDetector;

// lm session
async function lmSession(expectedInputs=[{type:'text'}]) {
  if (globalThis.LanguageModel?.create)
    return await LanguageModel.create({ expectedInputs, expectedOutputs:[{type:'text'}] });
  if (globalThis.Prompt?.create)
    return await Prompt.create({ expectedInputs, expectedOutputs:[{type:'text'}] });
  throw new Error('Local model not available.');
}

// persist state
async function saveState() {
  const s = {
    input: inputEl.value,
    summary: boxSummary.textContent,
    translation: boxTranslation.textContent,
    notes: boxNotes.textContent,
    quiz: boxQuiz.textContent,
    sources: boxSources.innerHTML,
    lang: langEl.value,
    theme: document.documentElement.getAttribute('data-theme') || 'dark',
    collapsed: document.body.classList.contains('collapsed')
  };
  try { await chrome.storage.local.set({ [STOR_KEY]: s }); } catch {}
}
async function restoreState() {
  try {
    const obj = await chrome.storage.local.get([STOR_KEY, THEME_KEY]);
    const s = obj?.[STOR_KEY];
    const t = obj?.[THEME_KEY];
    if (t) document.documentElement.setAttribute('data-theme', t);
    if (!s) return;
    inputEl.value = s.input || '';
    if (s.summary) boxSummary.textContent = s.summary;
    if (s.translation) boxTranslation.textContent = s.translation;
    if (s.notes) boxNotes.textContent = s.notes;
    if (s.quiz) boxQuiz.textContent = s.quiz;
    if (s.sources) boxSources.innerHTML = s.sources;
    if (s.lang) langEl.value = s.lang;
    if (s.theme) document.documentElement.setAttribute('data-theme', s.theme);
    document.body.classList.toggle('collapsed', !!s.collapsed);
  } catch {}
}

// history
async function getHistory(){ try { return (await chrome.storage.local.get(HIST_KEY))?.[HIST_KEY] || []; } catch { return []; } }
async function setHistory(arr){ try { await chrome.storage.local.set({ [HIST_KEY]: arr }); } catch {} }
async function addHistory(kind){
  const rec = { ts: Date.now(), kind,
    input: (inputEl.value||'').slice(0,4000),
    summary: boxSummary.textContent, translation: boxTranslation.textContent,
    notes: boxNotes.textContent, quiz: boxQuiz.textContent
  };
  const hist = await getHistory(); hist.unshift(rec); await setHistory(hist.slice(0,200));
}
async function openHistory(){
  const modal = $('history-modal'), list = $('history-list');
  list.innerHTML = '';
  const hist = await getHistory();
  if (!hist.length) list.innerHTML = '<div class="history-card"><em>No history.</em></div>';
  for (const h of hist){
    const d = document.createElement('div'); d.className='history-card';
    d.innerHTML = `
      <div class="row-top"><strong>${h.kind}</strong><div class="spacer"></div>
      <span class="ts">${new Date(h.ts).toLocaleString()}</span></div>
      <div class="snippet"><strong>Input:</strong> ${(h.input||'').slice(0,200)}${(h.input||'').length>200?'…':''}</div>
      <div class="row-actions">
        <button class="btn-small" data-a="restore">Restore</button>
        <button class="btn-small" data-a="copy">Copy Summary</button>
      </div>`;
    d.querySelector('[data-a="restore"]').onclick = async () => {
      inputEl.value = h.input || '';
      boxSummary.textContent = h.summary || '';
      boxTranslation.textContent = h.translation || '';
      boxNotes.textContent = h.notes || '';
      boxQuiz.textContent = h.quiz || '';
      await saveState(); closeHistory();
    };
    d.querySelector('[data-a="copy"]').onclick = async () => {
      try { await navigator.clipboard.writeText(h.summary || ''); status('Copied.'); } catch {}
    };
    list.appendChild(d);
  }
  modal.showModal();
}
function closeHistory(){ $('history-modal').close(); }
async function clearHistory(){ await setHistory([]); openHistory(); }

// feedback line
function status(msg){ statusEl.textContent = msg || ''; }

// language detect
async function detectLangSafe(text){
  if (!detectorAvailable()) return null;
  try {
    const d = await LanguageDetector.create();
    const r = await d.detect(text);
    return r?.[0]?.detectedLanguage || null;
  } catch { return null; }
}

// summarize
async function doSummarize(){
  const raw = (inputEl.value || '').trim();
  if (!raw){ boxSummary.textContent = 'Paste some text, then click Summarize.'; await saveState(); return; }
  boxSummary.textContent = 'Working on summary… please wait';

  try{
    if (summarizerAvailable()){
      // supply outputLanguage to avoid the error you saw
      const outLang = 'en';
      const sum = await Summarizer.create({
        type: 'key-points',
        format: 'markdown',
        length: 'medium',
        outputLanguage: outLang
      });
      const out = await sum.summarize(raw, { context: 'Concise, factual study bullets.' });
      boxSummary.textContent = out || '(No summary returned)';
    } else if (lmAvailable()){
      const s = await lmSession([{type:'text'}]);
      const out = await s.prompt(`Summarize clearly in 5–7 bullet points:\n${raw}`);
      boxSummary.textContent = String(out||'(No summary returned)');
    } else {
      const bullets = raw.split(/(?<=[.!?])\s+/).slice(0,6).map(x=>'• '+x.trim()).join('\n');
      boxSummary.textContent = bullets || '(No summary returned)';
    }
    await addHistory('summary');
  } catch(e){
    boxSummary.textContent = `Summary error: ${e?.message||e}`;
  }
  await saveState();
}

// translate
async function doTranslate(){
  const base = (inputEl.value || '').trim();
  if (!base){ boxTranslation.textContent = 'Paste text, then click Translate.'; await saveState(); return; }
  const tgt = langEl.value || 'en';
  boxTranslation.textContent = 'Working on translation… please wait';
  try{
    if (translatorAvailable()){
      let src = await detectLangSafe(base);
      if (!src) src = 'auto';                 // keep string, not undefined
      const tr = await Translator.create({ sourceLanguage: src, targetLanguage: tgt });
      const out = await tr.translate(base);
      boxTranslation.textContent = out || '(No translation returned)';
    } else if (lmAvailable()){
      const s = await lmSession([{type:'text'}]);
      const out = await s.prompt(`Translate into ${tgt}. Keep meaning and technical terms.\n${base}`);
      boxTranslation.textContent = String(out||'(No translation returned)');
    } else {
      boxTranslation.textContent = 'Translation not available on this Chrome build.';
    }
    await addHistory('translation');
  } catch(e){
    boxTranslation.textContent = `Translate error: ${e?.message||e}`;
  }
  await saveState();
}

// notes
async function doNotes(){
  const raw = (inputEl.value || '').trim();
  if (!raw){ boxNotes.textContent = 'Paste text, then click Make Study Notes.'; await saveState(); return; }
  boxNotes.textContent = 'Working on notes… please wait';
  try{
    const base = await (async ()=> {
      const dl = await detectLangSafe(raw);
      if (dl && dl.startsWith('en')) return raw;
      if (translatorAvailable()){
        const tr = await Translator.create({ sourceLanguage: dl || 'auto', targetLanguage: 'en' });
        return await tr.translate(raw);
      }
      return raw;
    })();

    if (lmAvailable()){
      const s = await lmSession([{type:'text'}]);
      const prompt = [
        'Rewrite as STUDY NOTES with sections:',
        '• Key Ideas (3–6 bullets)',
        '• Definitions (2–5 term: definition pairs)',
        '• Timeline/Steps (chronological bullets if relevant)',
        '• Key Takeaways (exactly 3 bullets)',
        'Keep it factual and compact.',
        `\nTEXT:\n${base}`
      ].join('\n');
      const out = await s.prompt(prompt);
      boxNotes.textContent = String(out||'(No notes returned)');
    } else {
      const bullets = base.split(/(?<=[.!?])\s+/).slice(0,8).map(x=>'• '+x.trim()).join('\n');
      boxNotes.textContent = `Key Ideas:\n${bullets}\n\nDefinitions:\n• Term — short definition\n• Term — short definition\n\nKey Takeaways:\n• …\n• …\n• …`;
    }
    await addHistory('notes');
  } catch(e){
    boxNotes.textContent = `Notes error: ${e?.message||e}`;
  }
  await saveState();
}

// quiz
async function doQuiz(){
  const raw = (inputEl.value || '').trim();
  if (!raw){ boxQuiz.textContent = 'Paste text, then click Quiz Me.'; await saveState(); return; }
  boxQuiz.textContent = 'Generating questions…';
  try{
    const base = await (async ()=> {
      const dl = await detectLangSafe(raw);
      if (dl && dl.startsWith('en')) return raw;
      if (translatorAvailable()){
        const tr = await Translator.create({ sourceLanguage: dl || 'auto', targetLanguage: 'en' });
        return await tr.translate(raw);
      }
      return raw;
    })();
    if (lmAvailable()){
      const s = await lmSession([{type:'text'}]);
      const out = await s.prompt([
        'Create exactly 5 recall questions.',
        'Mix: two definition/identify, two why/how, one compare/contrast.',
        'Each 8–18 words, end with a question mark. No answers.',
        `TEXT:\n${base}`
      ].join('\n'));
      boxQuiz.textContent = (String(out||'').trim() || '(No questions returned)');
    } else {
      boxQuiz.textContent = '(Local model not available.)';
    }
    await addHistory('quiz');
  } catch(e){
    boxQuiz.textContent = `Quiz error: ${e?.message||e}`;
  }
  await saveState();
}

// sources
async function doFindSources(){
  const base = (inputEl.value || '').trim() || (boxSummary.textContent || '').trim();
  if (!base){ boxSources.innerHTML = 'Paste text or run another action first, then click Find Sources.'; await saveState(); return; }
  boxSources.innerHTML = '<div class="history-card">Finding relevant sources…</div>';
  try{
    const keyTerms = topKeywords(base, 6).join(' ');
    const [papers, wiki] = await Promise.all([
      fetchCrossref(keyTerms),
      fetchWikipedia(keyTerms)
    ]);
    const parts = [];
    if (papers.length){
      parts.push(`<h4>Papers</h4>` + papers.map(p => `
        <div class="history-card">
          <div class="row-top"><div><strong>${escapeHtml(p.title)}</strong></div><div class="spacer"></div><span class="ts">${escapeHtml(p.year||'')}</span></div>
          <div class="ts">${escapeHtml(p.auth||'')}</div>
          <a href="${p.doi}" target="_blank">Open paper</a>
        </div>`).join(''));
    }
    if (wiki.length){
      parts.push(`<h4>Wikipedia</h4>` + wiki.map(w => `
        <div class="history-card">
          <div class="row-top">
            ${w.thumb ? `<img src="${w.thumb}" alt="" style="width:56px;height:56px;border-radius:8px;margin-right:8px;border:1px solid var(--line);object-fit:cover">` : ''}
            <div>
              <div><strong>${escapeHtml(w.title)}</strong></div>
              <div class="ts">${escapeHtml((w.desc||'').slice(0,180))}${w.desc && w.desc.length>180?'…':''}</div>
              <a href="${w.link}" target="_blank">Open article</a>
            </div>
          </div>
        </div>`).join(''));
    }
    boxSources.innerHTML = parts.length ? parts.join('\n') : 'No sources found. Try more specific text.';
    await addHistory('sources');
  } catch(e){
    boxSources.innerHTML = `<div class="history-card">Sources error: ${e?.message||e}</div>`;
  }
  await saveState();
}

// small utils for sources
function topKeywords(text, max=6){
  const stop = new Set('the of and to in a is on for with from by at as or an be this that it are was were into about using use based method model models data network system study paper result analysis figure between within across over under among toward'.split(' '));
  const counts = {};
  for (const w of text.toLowerCase().split(/[^a-z0-9-]+/)) {
    if (!w || w.length<4 || stop.has(w)) continue;
    counts[w] = (counts[w]||0)+1;
  }
  return Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,max).map(([w])=>w);
}
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function fetchCrossref(q){
  const r = await fetch(`https://api.crossref.org/works?rows=5&sort=score&query=${encodeURIComponent(q)}`);
  const j = await r.json();
  return (j.message.items||[]).map(it => ({
    title: Array.isArray(it.title)? it.title[0] : (it.title||'Untitled'),
    doi: it.DOI ? `https://doi.org/${it.DOI}` : (it.URL || '#'),
    auth: (it.author||[]).slice(0,3).map(a=>[a.given,a.family].filter(Boolean).join(' ')).join(', '),
    year: (it.issued?.['date-parts']?.[0]?.[0]) || ''
  }));
}
async function fetchWikipedia(q){
  const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&utf8=&format=json&origin=*`);
  const j = await r.json();
  const hits = (j.query?.search || []).slice(0,5);
  const pages = [];
  for (const h of hits){
    const title = h.title;
    const sumr = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    let desc = '', link = `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`, thumb='';
    if (sumr.ok){ const s = await sumr.json(); desc = s.extract || ''; thumb = s.thumbnail?.source || ''; }
    pages.push({ title, link, desc, thumb });
  }
  return pages;
}

// theme + quit
function toggleTheme(){
  const el = document.documentElement;
  const curr = el.getAttribute('data-theme') || 'dark';
  const next = curr === 'dark' ? 'light' : 'dark';
  el.setAttribute('data-theme', next);
  chrome.storage.local.set({ [THEME_KEY]: next });
  saveState();
}
async function quitClean(){
  try { await chrome.storage.local.set({ [STOR_KEY]: null }); } catch {}
  inputEl.value = '';
  boxSummary.textContent = 'Click Summarize to see your summary.';
  boxTranslation.textContent = 'Click Translate to see your translation.';
  boxNotes.textContent = 'Click Make Study Notes to see structured notes.';
  boxQuiz.textContent = 'Click Quiz Me to get 5 recall questions.';
  boxSources.innerHTML = 'Click Find Sources to fetch papers and Wikipedia.';
  document.body.classList.remove('collapsed');
  await saveState();
  window.close();
}

// init
(async function init(){
  await restoreState();
  const caps = [
    `Summarizer: ${summarizerAvailable() ? 'ready' : (lmAvailable() ? 'local model' : 'unavailable')}`,
    `Translator: ${translatorAvailable() ? 'ready' : (lmAvailable() ? 'local model' : 'unavailable')}`
  ];
  status(caps.join(' • '));
})();
