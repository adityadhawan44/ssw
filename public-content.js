(() => {
  const config = window.SHWETA_STUDIO_CONFIG || {};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const kindFor = type => ({'Case Analysis':'Case','Rights Guide':'Rights guide','Research':'Research','Opinion':'Perspective','Essay':'Perspective'}[type] || 'Article');
  const routeFor = post => `/post?slug=${encodeURIComponent(post.slug)}`;
  const summaryFor = post => post.subtitle || '';
  const publicDbPromise = (async () => {
    if (!config.supabaseUrl || !config.supabaseAnonKey) return null;
    try {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      const db = createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      window.SHWETA_PUBLIC_DB = db;
      return db;
    } catch (error) {
      console.warn('The reader account service could not be initialized.', error);
      return null;
    }
  })();
  window.SHWETA_PUBLIC_DB_READY = publicDbPromise;
  const livePostsPromise = (async () => {
    const db = await publicDbPromise;
    if (!db) return [];
    try {
      const { data: { user } } = await db.auth.getUser();
      const result = user
        ? await db.from('posts').select('id,title,slug,subtitle,post_type,body,tags,sources,published_at,updated_at').eq('status','published').order('published_at',{ascending:false}).limit(100)
        : await db.rpc('get_public_post_teasers');
      const { data, error } = result;
      if (error) throw error;
      window.SHWETA_PUBLISHED_POSTS = data || [];
      return data || [];
    } catch (error) {
      console.warn('Published articles could not be refreshed from the publishing service.', error);
      return [];
    }
  })();
  window.SHWETA_PUBLIC_CONTENT_READY = livePostsPromise;
  window.SHWETA_PUBLIC_SEARCH_ITEMS = livePostsPromise.then(posts => posts.map(post => ({ id:`post:${post.slug}`, kind:kindFor(post.post_type), title:post.title, summary:summaryFor(post), topic:(post.tags||[]).join(' '), url:routeFor(post) })));

  function postCard(post, number) {
    const kind=kindFor(post.post_type), label=kind.toUpperCase(), summary=summaryFor(post), href=routeFor(post);
    if (kind==='Case') return `<article class="case-row" data-item data-category="${esc((post.tags||[]).join(' ').toLowerCase())}" data-search="${esc((post.title+' '+summary+' '+label).toLowerCase())}"><div class="case-year">NEW<span>SHWETA</span></div><div><p class="eyebrow">${label}</p><a href="${href}"><h2>${esc(post.title)}</h2></a><p>${esc(summary)}</p></div><span class="row-arrow">↗</span></article>`;
    if (kind==='Rights guide') return `<a class="topic-row" data-item data-category="${esc((post.tags||[]).join(' ').toLowerCase())}" href="${href}"><span>${String(number).padStart(2,'0')}</span><div><h2>${esc(post.title)}</h2><p>${esc(summary)}</p></div><i>↗</i></a>`;
    if (kind==='Research') return `<article class="research-row" data-item data-category="research" data-search="${esc((post.title+' '+summary).toLowerCase())}"><div><p class="eyebrow">RESEARCH · NEW</p><a href="${href}"><h2>${esc(post.title)}</h2></a><p>${esc(summary)}</p></div><button class="save-button" data-save="post:${esc(post.slug)}" aria-label="Save ${esc(post.title)}">♡</button><span class="row-arrow">↗</span></article>`;
    return `<article class="story-row" data-item data-category="${esc((post.tags||[]).join(' ').toLowerCase())}" data-search="${esc((post.title+' '+summary+' '+label).toLowerCase())}"><div class="story-meta"><span>${label}</span><span>NEW</span></div><div class="story-copy"><a href="${href}"><h2>${esc(post.title)}</h2></a><p>${esc(summary)}</p><div class="byline">SHWETA <span>·</span> ${post.published_at?new Date(post.published_at).toLocaleDateString():''}</div></div><button class="save-button" data-save="post:${esc(post.slug)}" aria-label="Save ${esc(post.title)}">♡</button></article>`;
  }

  livePostsPromise.then(posts => {
    const path=location.pathname.replace(/\/$/,'') || '/';
    const targets = {'/journal':['Article','Opinion','Essay'],'/perspective':['Opinion','Essay'],'/casebook':['Case Analysis'],'/rights':['Rights Guide'],'/research':['Research']};
    const target=targets[path];
    if (target) {
      const container=document.querySelector(path==='/casebook'?'.case-list':path==='/rights'?'.topic-list':path==='/research'?'.research-list':'.story-list');
      const selected=posts.filter(post=>target.includes(post.post_type) && post.slug);
      if (container && selected.length) container.insertAdjacentHTML('beforeend',selected.map((post,i)=>postCard(post,i+1)).join(''));
    }
    if (path==='/' && posts.length) {
      const container=document.querySelector('.home-index');
      if(container) container.insertAdjacentHTML('beforeend',posts.slice(0,4).map((post,i)=>`<a class="index-row" href="${routeFor(post)}"><span>${String(i+5).padStart(2,'0')}</span><small>${esc(kindFor(post.post_type).toUpperCase())}</small><strong>${esc(post.title)}</strong><i>↗</i></a>`).join(''));
    }
  });

  async function renderPostPage() {
    const root=document.querySelector('#published-post');
    if(!root) return;
    const slug=new URLSearchParams(location.search).get('slug');
    if(!slug) { root.innerHTML='<p class="muted">This publication could not be found.</p>'; return; }
    const posts=await livePostsPromise; let post=posts.find(item=>item.slug===slug);
    if(!post) { root.innerHTML='<p class="muted">This publication is unavailable or is no longer published.</p>'; return; }
    const {data:{user:reader}}=await window.SHWETA_PUBLIC_DB.auth.getUser();
    if(!reader) {
      root.innerHTML=`<article class="reading-page wrap" data-reading><div class="breadcrumbs"><a href="/journal">Journal</a><span> / </span>${esc(kindFor(post.post_type))}</div><header class="reading-header"><p class="eyebrow">${esc(kindFor(post.post_type).toUpperCase())} · SHWETA</p><h1>${esc(post.title)}</h1><p class="reading-deck">${esc(post.subtitle||'A SHWETA publication')}</p><div class="reading-byline">BY SHWETA <span>·</span> ${post.published_at?new Date(post.published_at).toLocaleDateString():''}</div></header><div class="article-body"><section class="reader-access-card"><p class="eyebrow">A FREE READER ACCOUNT</p><h2>Continue with the complete article.</h2><p>Create a free account or sign in to read the full publication, case analysis and rights guide.</p><a class="button-primary" href="/sign-in?next=${encodeURIComponent(location.pathname+location.search)}">Sign in or create an account</a></section></div></article>`;
      document.title=`${post.title} · SHWETA`;
      return;
    }
    const {data:fullPost,error:fullPostError}=await window.SHWETA_PUBLIC_DB.from('posts').select('id,title,slug,subtitle,post_type,body,tags,sources,published_at,updated_at').eq('id',post.id).eq('status','published').single();
    if(fullPostError||!fullPost) { root.innerHTML='<p class="muted wrap">This publication could not be loaded. Please sign in again and retry.</p>'; return; }
    post=fullPost;
    const safeSources=(post.sources||[]).map(source=>typeof source==='string'?{url:source,label:source}:{url:source.url,label:source.label||source.url}).filter(source=>/^https?:\/\//i.test(source.url||''));
    const paragraphs=(post.body||'').split(/\n\s*\n/).filter(Boolean).map(text=>`<p>${esc(text).replace(/\n/g,'<br>')}</p>`).join('');
    root.innerHTML=`<article class="reading-page wrap" data-reading><div class="breadcrumbs"><a href="/journal">Journal</a><span> / </span>${esc(kindFor(post.post_type))}</div><header class="reading-header"><p class="eyebrow">${esc(kindFor(post.post_type).toUpperCase())} · SHWETA</p><h1>${esc(post.title)}</h1><p class="reading-deck">${esc(post.subtitle)}</p><div class="reading-byline">BY SHWETA <span>·</span> ${post.published_at?new Date(post.published_at).toLocaleDateString():''}<button class="save-button" data-save="post:${esc(post.slug)}" aria-label="Save this piece">♡ Save</button></div></header><div class="article-body"><div class="published-copy">${paragraphs}</div><aside class="legal-note"><strong>Information, not legal advice.</strong> This publication is educational and does not establish a lawyer–client relationship. Check current law and primary sources before relying on it.</aside>${safeSources.length?`<section class="sources"><p class="eyebrow">SOURCES & FURTHER READING</p><ul>${safeSources.map(source=>`<li><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.label)} ↗</a></li>`).join('')}</ul></section>`:''}<section class="reader-interactions" aria-label="Reader responses"><h2>Join the conversation</h2><p class="fine-print">Please do not post private case details or sensitive personal information. Comments are reviewed before they appear.</p><div class="reader-auth"></div><div class="reader-actions" hidden><button type="button" class="button-primary" id="reader-like">Like</button><button type="button" class="tool-button" id="reader-bookmark">Save to my account</button><button type="button" class="tool-button" id="reader-signout">Sign out</button></div><p class="reader-status" role="status"></p><form class="reader-comment-form" hidden><label for="reader-comment">Add a comment</label><textarea id="reader-comment" maxlength="4000" required rows="4"></textarea><button class="button-primary" type="submit">Submit for review</button></form><div class="reader-comments"><h3>Approved comments</h3><div class="reader-comment-list"></div></div></section></div></article>`;
    document.title=`${post.title} · SHWETA`;
    const db=window.SHWETA_PUBLIC_DB;
    if(!db) return;
    const authRoot=root.querySelector('.reader-auth'), actions=root.querySelector('.reader-actions'), status=root.querySelector('.reader-status'), form=root.querySelector('.reader-comment-form');
    authRoot.innerHTML='<p class="fine-print">Reader access is available through a free account. <a href="/sign-in">Sign in or create an account</a>. Do not share confidential or personal case details in comments.</p>';
    const setStatus=(text,isError=false)=>{status.textContent=text;status.dataset.kind=isError?'error':'success';};
    const ensureProfile=async user=>{const display=(user.user_metadata?.display_name||user.email?.split('@')[0]||'Reader').slice(0,80);await db.from('reader_profiles').upsert({user_id:user.id,display_name:display},{onConflict:'user_id'});};
    async function loadComments(){
      const {data,error}=await db.from('comments').select('id,body,created_at,user_id').eq('post_id',post.id).eq('status','visible').order('created_at',{ascending:true}).limit(100);
      if(error) return;
      const ids=[...new Set((data||[]).map(item=>item.user_id))];
      const {data:profiles}=ids.length?await db.from('reader_profiles').select('user_id,display_name').in('user_id',ids):{data:[]};
      const names=new Map((profiles||[]).map(item=>[item.user_id,item.display_name]));
      root.querySelector('.reader-comment-list').innerHTML=(data||[]).length?data.map(item=>`<article class="reader-comment"><p>${esc(item.body)}</p><small>${esc(names.get(item.user_id)||'Reader')} · ${new Date(item.created_at).toLocaleDateString()}</small></article>`).join(''):'<p class="muted">No approved comments yet.</p>';
    }
    async function showUser(user){
      if(!user){actions.hidden=true;form.hidden=true;authRoot.hidden=false;return;}
      authRoot.hidden=true;actions.hidden=false;form.hidden=false;
      await ensureProfile(user);
      const [{data:likes},{data:marks}]=await Promise.all([db.from('post_likes').select('post_id').eq('post_id',post.id).eq('user_id',user.id),db.from('bookmarks').select('post_id').eq('post_id',post.id).eq('user_id',user.id)]);
      root.querySelector('#reader-like').textContent=likes?.length?'Liked':'Like';
      root.querySelector('#reader-bookmark').textContent=marks?.length?'Saved to my account':'Save to my account';
      await loadComments();
    }
    const {data:{user}}=await db.auth.getUser(); await showUser(user);
    root.querySelector('#reader-signout').addEventListener('click',async()=>{const {error}=await db.auth.signOut();if(error)setStatus(error.message,true);else location.reload();});
    root.querySelector('#reader-like').addEventListener('click',async()=>{const {data:{user:active}}=await db.auth.getUser();if(!active)return;const button=root.querySelector('#reader-like');const result=button.textContent==='Liked'?await db.from('post_likes').delete().eq('post_id',post.id).eq('user_id',active.id):await db.from('post_likes').insert({post_id:post.id,user_id:active.id});if(result.error)setStatus('Could not update your like. Please try again.',true);else{button.textContent=button.textContent==='Liked'?'Like':'Liked';setStatus('Your response is saved.');}});
    root.querySelector('#reader-bookmark').addEventListener('click',async()=>{const {data:{user:active}}=await db.auth.getUser();if(!active)return;const button=root.querySelector('#reader-bookmark');const result=button.textContent==='Saved to my account'?await db.from('bookmarks').delete().eq('post_id',post.id).eq('user_id',active.id):await db.from('bookmarks').insert({post_id:post.id,user_id:active.id});if(result.error)setStatus('Could not update your reading list. Please try again.',true);else{button.textContent=button.textContent==='Saved to my account'?'Save to my account':'Saved to my account';setStatus('Your reading list is updated.');}});
    form.addEventListener('submit',async event=>{event.preventDefault();const {data:{user:active}}=await db.auth.getUser();if(!active)return;const body=new FormData(form).get('comment').trim();if(!body)return;const {error}=await db.from('comments').insert({post_id:post.id,user_id:active.id,body,status:'pending'});if(error)setStatus('Comment could not be submitted. Please sign in again and retry.',true);else{form.reset();setStatus('Thanks. Your comment is awaiting review.');}});
    await loadComments();
  }
  renderPostPage();
})();
