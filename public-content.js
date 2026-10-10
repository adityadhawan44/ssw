(() => {
  const config = window.SHWETA_STUDIO_CONFIG || {};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const kindFor = type => ({'Case Analysis':'Case','Rights Guide':'Rights guide','Research':'Research','Opinion':'Perspective','Essay':'Perspective','Announcement':'The Brief','Speaking & Events':'Speaking & events','Project & Initiative':'Project','Media & Press':'Media & press','Resource':'Resource'}[type] || 'Article');
  const renderBody = value => {
    const inline = text => esc(text).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" rel="noopener noreferrer">$1</a>');
    return String(value||'').trim().split(/\n{2,}/).filter(Boolean).map(block=>{
      const lines=block.split('\n');
      if(/^#{1,3}\s/.test(lines[0])){const level=Math.min(lines[0].match(/^#+/)[0].length+1,4);return `<h${level}>${inline(lines[0].replace(/^#{1,3}\s/,''))}</h${level}>`;}
      if(lines.every(line=>/^>\s?/.test(line)))return `<blockquote>${lines.map(line=>inline(line.replace(/^>\s?/,''))).join('<br>')}</blockquote>`;
      if(lines.every(line=>/^[-*]\s+/.test(line)))return `<ul>${lines.map(line=>`<li>${inline(line.replace(/^[-*]\s+/,''))}</li>`).join('')}</ul>`;
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    }).join('');
  };
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
        ? await db.from('posts').select('id,title,slug,subtitle,post_type,body,structured_data,tags,sources,published_at,updated_at,author_name,seo_title,seo_description,canonical_url,featured,last_reviewed_at,correction_note').eq('status','published').order('featured',{ascending:false}).order('published_at',{ascending:false}).limit(100)
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

  const portfolioGroups=[
    {label:'Writing & essays',types:['Article','Opinion','Essay']},
    {label:'Legal case studies',types:['Case Analysis']},
    {label:'Research & reports',types:['Research']},
    {label:'Rights guides',types:['Rights Guide']},
    {label:'Speaking & events',types:['Speaking & Events']},
    {label:'Projects & initiatives',types:['Project & Initiative']},
    {label:'Media & press',types:['Media & Press']},
    {label:'Resources',types:['Resource']},
    {label:'Updates & announcements',types:['Announcement']}
  ];
  function renderPortfolio(posts){
    const grid=document.querySelector('#portfolio-grid');if(!grid)return;
    const available=portfolioGroups.filter(group=>posts.some(post=>group.types.includes(post.post_type)));
    const filters=document.querySelector('#portfolio-filters');
    if(filters){filters.innerHTML=`<button type="button" class="is-active" data-portfolio-filter="all" aria-pressed="true">Everything</button>${available.map(group=>`<button type="button" data-portfolio-filter="${esc(group.label)}" aria-pressed="false">${esc(group.label)}</button>`).join('')}`;filters.addEventListener('click',event=>{const button=event.target.closest('[data-portfolio-filter]');if(!button)return;filters.querySelectorAll('button').forEach(item=>{const active=item===button;item.classList.toggle('is-active',active);item.setAttribute('aria-pressed',String(active));});grid.querySelectorAll('[data-portfolio-card]').forEach(card=>{card.hidden=button.dataset.portfolioFilter!=='all'&&card.dataset.portfolioCard!==button.dataset.portfolioFilter;});},{once:true});}
    const visible=posts.filter(post=>post.slug&&portfolioGroups.some(group=>group.types.includes(post.post_type))).slice(0,24);
    grid.innerHTML=visible.length?visible.map(post=>{const group=portfolioGroups.find(item=>item.types.includes(post.post_type));return `<article class="portfolio-card" data-portfolio-card="${esc(group.label)}"><p class="eyebrow">${esc(group.label)}</p><h3><a href="${routeFor(post)}">${esc(post.title)}</a></h3><p>${esc(summaryFor(post)||'Explore this publication and its key details.')}</p><a class="text-link" href="${routeFor(post)}">Explore <span aria-hidden="true">↗</span></a></article>`;}).join(''):'<p class="muted portfolio-empty">Published work across writing, research, events and projects will appear here.</p>';
  }

  livePostsPromise.then(posts => {
    renderPortfolio(posts);
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
      if(container){
        const featured=posts.find(post=>post.featured);
        const knownTitles=new Set([...container.querySelectorAll('.index-row strong')].map(node=>node.textContent.trim()));
        if(featured){
          const first=container.querySelector('.index-row');
          const existing=[...container.querySelectorAll('.index-row')].find(row=>row.querySelector('strong')?.textContent.trim()===featured.title);
          if(existing){existing.dataset.cmsFeatured='';existing.href=routeFor(featured);const small=existing.querySelector('small');if(small)small.textContent=`${kindFor(featured.post_type).toUpperCase()} · FEATURED`;if(first&&existing!==first)container.insertBefore(existing,first);}
          else {const row=`<a class="index-row" data-cms-featured href="${routeFor(featured)}"><span>01</span><small>${esc(kindFor(featured.post_type).toUpperCase())} · FEATURED</small><strong>${esc(featured.title)}</strong><i>↗</i></a>`;if(first)first.insertAdjacentHTML('beforebegin',row);else container.insertAdjacentHTML('beforeend',row);}
        }
        const latest=posts.filter(post=>post.id!==featured?.id).slice(0,4);
        container.insertAdjacentHTML('beforeend',latest.map((post,i)=>`<a class="index-row" href="${routeFor(post)}"><span>${String(i+5).padStart(2,'0')}</span><small>${esc(kindFor(post.post_type).toUpperCase())}</small><strong>${esc(post.title)}</strong><i>↗</i></a>`).join(''));
      }
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
      document.title=`${post.seo_title||post.title} · SHWETA`;
      const guestDescription=document.querySelector('meta[name="description"]');if(guestDescription&&post.seo_description)guestDescription.content=post.seo_description;
      const guestCanonical=document.querySelector('link[rel="canonical"]');if(guestCanonical&&post.canonical_url)guestCanonical.href=post.canonical_url;
      const guestByline=root.querySelector('.reading-byline');if(guestByline)guestByline.firstChild.textContent=`BY ${post.author_name||'SHWETA'} `;
      return;
    }
    const {data:fullPost,error:fullPostError}=await window.SHWETA_PUBLIC_DB.from('posts').select('id,title,slug,subtitle,post_type,body,structured_data,tags,sources,published_at,updated_at,author_name,seo_title,seo_description,canonical_url,featured,last_reviewed_at,correction_note').eq('id',post.id).eq('status','published').single();
    if(fullPostError||!fullPost) { root.innerHTML='<p class="muted wrap">This publication could not be loaded. Please sign in again and retry.</p>'; return; }
    post=fullPost;
    const safeSources=(post.sources||[]).map(source=>typeof source==='string'?{url:source,label:source}:{url:source.url,label:source.label||source.url}).filter(source=>/^https?:\/\//i.test(source.url||''));
    const structuredMarkdown=Object.entries(post.structured_data||{}).map(([key,value])=>`## ${key.replace(/_/g,' ')}\n\n${value}`).join('\n\n');
    const paragraphs=renderBody([structuredMarkdown,post.body].filter(Boolean).join('\n\n'));
    root.innerHTML=`<article class="reading-page wrap" data-reading><div class="breadcrumbs"><a href="/journal">Journal</a><span> / </span>${esc(kindFor(post.post_type))}</div><header class="reading-header"><p class="eyebrow">${esc(kindFor(post.post_type).toUpperCase())} · SHWETA</p><h1>${esc(post.title)}</h1><p class="reading-deck">${esc(post.subtitle)}</p><div class="reading-byline">BY SHWETA <span>·</span> ${post.published_at?new Date(post.published_at).toLocaleDateString():''}<button class="save-button" data-save="post:${esc(post.slug)}" aria-label="Save this piece">♡ Save</button></div></header><div class="article-body"><div class="published-copy">${paragraphs}</div><aside class="legal-note"><strong>Information, not legal advice.</strong> This publication is educational and does not establish a lawyer–client relationship. Check current law and primary sources before relying on it.</aside>${safeSources.length?`<section class="sources"><p class="eyebrow">SOURCES & FURTHER READING</p><ul>${safeSources.map(source=>`<li><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.label)} ↗</a></li>`).join('')}</ul></section>`:''}<section class="reader-interactions" aria-label="Reader responses"><h2>Join the conversation</h2><p class="fine-print">Please do not post private case details or sensitive personal information. Comments are reviewed before they appear.</p><div class="reader-auth"></div><div class="reader-actions" hidden><button type="button" class="button-primary" id="reader-like">Like</button><button type="button" class="tool-button" id="reader-bookmark">Save to my account</button><button type="button" class="tool-button" id="reader-signout">Sign out</button></div><p class="reader-status" role="status"></p><form class="reader-comment-form" hidden><label for="reader-comment">Add a comment</label><textarea id="reader-comment" maxlength="4000" required rows="4"></textarea><button class="button-primary" type="submit">Submit for review</button></form><div class="reader-comments"><h3>Approved comments</h3><div class="reader-comment-list"></div></div></section></div></article>`;
    document.title=`${post.seo_title||post.title} · SHWETA`;
    const metaDescription=document.querySelector('meta[name="description"]');if(metaDescription&&post.seo_description)metaDescription.content=post.seo_description;
    const canonical=document.querySelector('link[rel="canonical"]');if(canonical&&post.canonical_url)canonical.href=post.canonical_url;
    const byline=root.querySelector('.reading-byline');if(byline)byline.firstChild.textContent=`BY ${post.author_name||'SHWETA'} `;
    if(post.correction_note){const note=document.createElement('aside');note.className='correction-note';const heading=document.createElement('strong');heading.textContent='Correction / update';const copy=document.createElement('p');copy.textContent=post.correction_note;note.append(heading,copy);root.querySelector('.article-body')?.prepend(note);}
    const legalNote=root.querySelector('.legal-note');if(legalNote&&post.last_reviewed_at){const reviewed=document.createElement('span');reviewed.textContent=` Last reviewed ${new Date(post.last_reviewed_at+'T00:00:00').toLocaleDateString()}.`;legalNote.append(reviewed);}
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
