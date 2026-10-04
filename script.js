(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const openDialog = selector => { const dialog = $(selector); if (dialog && !dialog.open) dialog.showModal(); };
  const closeDialog = button => button.closest('dialog')?.close();

  const menuButton = $('.menu-toggle');
  const nav = $('.main-nav');
  menuButton?.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') !== 'true';
    menuButton.setAttribute('aria-expanded', String(open));
    nav?.classList.toggle('open', open);
  });
  $$('.main-nav a').forEach(a => a.addEventListener('click', () => {
    nav?.classList.remove('open'); menuButton?.setAttribute('aria-expanded', 'false');
  }));

  $$('.search-open').forEach(button => button.addEventListener('click', () => {
    openDialog('.search-dialog'); setTimeout(() => $('#site-search')?.focus(), 40);
  }));
  $$('.saved-open').forEach(button => button.addEventListener('click', () => { renderSaved(); openDialog('.saved-dialog'); }));
  $$('.reader-open').forEach(button => button.addEventListener('click', () => openDialog('.preferences-dialog')));
  $$('.overlay-close').forEach(button => button.addEventListener('click', () => closeDialog(button)));
  $$('.overlay').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }));

  let savedStorageKey='shweta-saved';
  const savedMemory=new Map();
  const getSaved = () => { const memory=savedMemory.get(savedStorageKey);try { const items=JSON.parse(localStorage.getItem(savedStorageKey) || '[]');const clean=Array.isArray(items)?items.filter(item=>typeof item==='string'):[];if(memory&&memory.length>clean.length)return memory;savedMemory.set(savedStorageKey,clean);return clean; } catch { return memory||[]; } };
  const setSaved = items => { savedMemory.set(savedStorageKey,items);try { localStorage.setItem(savedStorageKey, JSON.stringify(items)); return true; } catch { return false; } };
  let indexPromise;
  const getIndex = () => indexPromise ||= Promise.all([fetch('/search-index.json').then(response => response.ok ? response.json() : []).catch(() => []), window.SHWETA_PUBLIC_SEARCH_ITEMS || Promise.resolve([])]).then(([staticItems,publishedItems]) => [...staticItems,...publishedItems]);
  let readerDb=null,readerUserId=null,bookmarkSyncRunning=false;
  const setSavedNotice=text=>{const note=$('.saved-dialog .fine-print');if(note)note.textContent=text;};
  async function syncReaderBookmarks(){
    if(bookmarkSyncRunning)return;bookmarkSyncRunning=true;
    try{
      readerDb=await window.SHWETA_PUBLIC_DB_READY;if(!readerDb)return;
      const {data:{user}}=await readerDb.auth.getUser();readerUserId=user?.id||null;if(!user)return;
      const accountKey=`shweta-saved:${user.id}`;let anonymousSaved=[];
      try{if(localStorage.getItem(accountKey)===null)anonymousSaved=JSON.parse(localStorage.getItem('shweta-saved')||'[]').filter(item=>typeof item==='string');}catch{}
      savedStorageKey=accountKey;
      const {data:rows,error}=await readerDb.from('bookmarks').select('post_id,posts(slug)').eq('user_id',user.id);
      if(error){setSavedNotice('Your device reading list is available. We could not sync it to your account just now.');return;}
      const published=await (window.SHWETA_PUBLIC_CONTENT_READY||Promise.resolve([]));
      const byId=new Map((published||[]).map(post=>[post.id,post])),bySlug=new Map((published||[]).map(post=>[post.slug,post]));
      const cloudIds=(rows||[]).map(row=>{const slug=row.posts?.slug||byId.get(row.post_id)?.slug;return slug?`post:${slug}`:null;}).filter(Boolean);
      const localIds=[...new Set([...getSaved(),...anonymousSaved])],merged=[...new Set([...localIds,...cloudIds])];
      setSaved(merged);updateSavedControls();
      const cloudSet=new Set(cloudIds);
      for(const id of localIds){if(!id.startsWith('post:')||cloudSet.has(id))continue;const post=bySlug.get(id.slice(5));if(!post)continue;const {error:saveError}=await readerDb.from('bookmarks').insert({post_id:post.id,user_id:user.id});if(saveError&&saveError.code!=='23505'){setSavedNotice('Some saved articles could not sync yet. Your device list remains available.');break;}}
      if($('.saved-dialog')?.open)renderSaved();
    }catch{setSavedNotice('Your device reading list is available. Account sync could not connect.');}
    finally{bookmarkSyncRunning=false;}
  }
  const updateSavedControls = () => {
    const saved = getSaved();
    $$('.saved-count').forEach(node => node.textContent = String(saved.length));
    $$('[data-save]').forEach(button => {
      const active = saved.includes(button.dataset.save);
      button.classList.toggle('is-saved', active);
      if (button.textContent.trim().startsWith('♡') || button.textContent.trim().startsWith('♥')) {
        button.innerHTML = active ? '♥' : '♡';
      }
      button.setAttribute('aria-pressed', String(active));
    });
  };
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-save]');
    if (!button) return;
    const saved = getSaved(), id = button.dataset.save;
    const wasSaved=saved.includes(id);
    const localSaved=setSaved(wasSaved ? saved.filter(item => item !== id) : [...saved, id]);
    updateSavedControls();
    if ($('.saved-dialog')?.open) renderSaved();
    if(!localSaved)setSavedNotice('This browser blocks device storage. Signed-in article bookmarks can still sync with your account.');
    if(readerDb&&readerUserId&&id.startsWith('post:')){
      try{
        const published=await (window.SHWETA_PUBLIC_CONTENT_READY||Promise.resolve([])),post=(published||[]).find(item=>`post:${item.slug}`===id);
        if(post){const result=wasSaved?await readerDb.from('bookmarks').delete().eq('post_id',post.id).eq('user_id',readerUserId):await readerDb.from('bookmarks').insert({post_id:post.id,user_id:readerUserId});if(result.error&&result.error.code!=='23505')setSavedNotice('This article is saved on this device. Account sync could not complete; please try again later.');}
      }catch{setSavedNotice('This article is saved on this device. Account sync could not complete; please try again later.');}
    }
  });
  async function renderSaved() {
    const root = $('.saved-results'); if (!root) return;
    const saved = getSaved(), items = await getIndex();
    const selected = saved.map(id => items.find(item => item.id === id)).filter(Boolean);
    root.innerHTML = selected.length ? selected.map(item => `<a href="${item.url}"><span>${item.kind.toUpperCase()}</span><strong>${escapeHtml(item.title)}</strong></a>`).join('') : '<p class="muted">Nothing saved yet. Use the ♡ on an article, case or research preview to keep it here.</p>';
  }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
  updateSavedControls();
  Promise.resolve(window.SHWETA_PUBLIC_DB_READY||null).then(async db=>{
    if(!db)return;readerDb=db;const {data:{user}}=await db.auth.getUser();readerUserId=user?.id||null;if(user){savedStorageKey=`shweta-saved:${user.id}`;updateSavedControls();syncReaderBookmarks();}
    db.auth.onAuthStateChange((_event,session)=>{readerUserId=session?.user?.id||null;if(session?.user){savedStorageKey=`shweta-saved:${session.user.id}`;updateSavedControls();syncReaderBookmarks();}else{savedStorageKey='shweta-saved';updateSavedControls();if($('.saved-dialog')?.open)renderSaved();}});
  }).catch(()=>{});

  const searchInput = $('#site-search');
  let searchTimer;
  async function runSearch() {
    if (!searchInput) return;
    const query = searchInput.value.trim().toLowerCase(), type = $('#search-type')?.value || 'all', topic = $('#search-topic')?.value || 'all';
    const root = $('.search-results'); if (!root) return;
    const items = await getIndex();
    if (!query) { root.innerHTML = '<p class="muted">Search across articles, judgments, guides and research.</p>'; return; }
    const found = items.filter(item => (type === 'all' || item.kind.toLowerCase() === type.toLowerCase()) && (topic === 'all' || item.topic.toLowerCase().includes(topic.toLowerCase())) && `${item.title} ${item.summary} ${item.topic}`.toLowerCase().includes(query));
    if (!found.length) { root.innerHTML = '<p class="muted">No matching pieces yet. Try a broader word or browse the Journal and Casebook.</p>'; return; }
    const groups = [...new Set(found.map(item => item.kind))];
    root.innerHTML = groups.map(group => `<p class="result-group-title">${escapeHtml(group.toUpperCase())} · ${found.filter(item => item.kind === group).length}</p>${found.filter(item => item.kind === group).map(item => `<a class="search-result" href="${item.url}"><span>${escapeHtml(item.topic)}</span><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.summary)}</span></a>`).join('')}`).join('');
  }
  searchInput?.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 100); });
  $('#search-type')?.addEventListener('change', runSearch); $('#search-topic')?.addEventListener('change', runSearch);

  $$('.filter-button').forEach(button => button.addEventListener('click', () => {
    const group = button.closest('.archive-section') || document;
    $$('.filter-button', group).forEach(item => item.classList.remove('is-active'));
    button.classList.add('is-active');
    const wanted = button.dataset.filter;
    $$('[data-item]', group).forEach(item => {
      const categories = (item.dataset.category || '').toLowerCase();
      item.hidden = wanted !== 'all' && !categories.includes(wanted);
    });
  }));

  const prefs = (() => { try { return JSON.parse(localStorage.getItem('shweta-reading') || '{}'); } catch { return {}; } })();
  function applyPreference(name, value) {
    const body = document.body;
    if (name === 'font') body.dataset.font = value;
    if (name === 'width') body.dataset.width = value;
    if (name === 'theme') {
      if (value === 'light') delete body.dataset.theme; else body.dataset.theme = value;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value === 'dark' ? '#20231f' : '#f6f4ef');
    }
    prefs[name] = value; try { localStorage.setItem('shweta-reading', JSON.stringify(prefs)); } catch { /* Keep the preference for this page even when storage is blocked. */ }
    $$(`[data-${name}]`, $('.preferences-dialog') || document).forEach(btn => btn.classList.toggle('is-active', btn.dataset[name] === value));
  }
  Object.entries(prefs).forEach(([name, value]) => applyPreference(name, value));
  $$('.preferences-dialog [data-font],.preferences-dialog [data-width],.preferences-dialog [data-theme]').forEach(button => {
    const key = button.hasAttribute('data-font') ? 'font' : button.hasAttribute('data-width') ? 'width' : 'theme';
    button.addEventListener('click', () => applyPreference(key, button.dataset[key]));
  });

  const progress = $('#reading-progress');
  if (progress && $('[data-reading]')) {
    const update = () => {
      const range = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.width = `${range > 0 ? Math.min(100, Math.max(0, window.scrollY / range * 100)) : 0}%`;
    };
    window.addEventListener('scroll', update, { passive: true }); window.addEventListener('resize', update); update();
  }
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openDialog('.search-dialog'); setTimeout(() => searchInput?.focus(), 40); }
  });

  // Reader wall: show previews to visitors and keep dynamic article bodies behind
  // authenticated Supabase reads. The database policy is the access-control boundary.
  const path = location.pathname.replace(/\/$/, '') || '/';
  if (!['/sign-in', '/studio', '/404'].includes(path)) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    if (nav && !nav.querySelector('.studio-nav-link')) {
      const studioLink = document.createElement('a');
      studioLink.className = 'studio-nav-link';
      studioLink.href = '/studio';
      studioLink.textContent = 'Admin studio';
      nav.append(studioLink);
    }
    Promise.resolve(window.SHWETA_PUBLIC_DB_READY || window.SHWETA_PUBLIC_CONTENT_READY).catch(() => null).then(async resolvedDb => {
      const db = resolvedDb || window.SHWETA_PUBLIC_DB;
      if (!db) return;
      let { data: { user } = {} } = await db.auth.getUser();
      const accountLink = document.createElement('a');
      accountLink.className = 'reader-account-link';
      accountLink.href = `/sign-in?next=${encodeURIComponent(returnTo)}`;
      accountLink.textContent = user ? 'Reader account' : 'Reader sign in';
      $('.header-tools')?.prepend(accountLink);
      if (user) return;

      const gate = document.createElement('aside');
      gate.className = 'reader-wall';
      gate.setAttribute('role', 'dialog');
      gate.setAttribute('aria-modal', 'true');
      gate.setAttribute('aria-labelledby', 'reader-wall-title');
      gate.innerHTML = `<div class="reader-wall-card"><p class="eyebrow">SHWETA · READER ACCESS</p><h2 id="reader-wall-title">Stay for the full thought.</h2><p>Sign in or create a free reader account to continue with the complete article, case analysis and rights guides.</p><a class="button-primary" href="/sign-in?next=${encodeURIComponent(returnTo)}">Sign in to continue</a><p class="reader-wall-note">Your account is handled securely by Supabase. Your password is never saved as readable text.</p><button class="reader-wall-top" type="button">Return to the beginning</button></div>`;
      document.body.append(gate);
      const activate = () => {
        if (document.body.classList.contains('reader-wall-active')) return;
        document.body.classList.add('reader-wall-active');
        document.querySelector('main')?.setAttribute('inert', '');
        document.querySelector('.site-header')?.setAttribute('inert', '');
        gate.querySelector('a')?.focus({ preventScroll: true });
      };
      const deactivate = () => {
        document.body.classList.remove('reader-wall-active');
        document.querySelector('main')?.removeAttribute('inert');
        document.querySelector('.site-header')?.removeAttribute('inert');
      };
      gate.querySelector('.reader-wall-top')?.addEventListener('click', () => {
        deactivate(); window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      const checkPosition = () => { if (window.scrollY > 300) activate(); };
      window.addEventListener('scroll', checkPosition, { passive: true });
      checkPosition();
      db.auth.onAuthStateChange((_event, session) => {
        if (session?.user) { user = session.user; deactivate(); }
        else if (user) { location.reload(); }
      });
    }).catch(() => {});
  }
})();
