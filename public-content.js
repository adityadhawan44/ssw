(async () => {
  const c = window.SHWETA_STUDIO_CONFIG || {};
  if (!c.supabaseUrl || !c.supabaseAnonKey) return;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  const db = createClient(c.supabaseUrl, c.supabaseAnonKey);
  const { data: posts = [], error } = await db.from('posts').select('id,title,slug,subtitle,post_type,body,sources,published_at').eq('status','published').order('published_at',{ascending:false});
  if (error) { console.warn('Published posts unavailable', error); return; }
  const esc = s => String(s || '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const kind = p => ({'Case Analysis':'Case','Rights Guide':'Rights guide','Research':'Research','Opinion':'Perspective','Essay':'Perspective'}[p.post_type] || 'Article');
  window.SHWETA_PUBLIC_DB = db;
  const path = location.pathname.replace(/\/$/, '') || '/';
  const typeFor = {'/journal':['Article','Opinion','Essay'],'/perspective':['Opinion','Essay'],'/casebook':['Case Analysis'],'/rights':['Rights Guide'],'/research':['Research']};
  const listFor = {'/casebook':'.case-list','/rights':'.topic-list','/research':'.research-list'};
  const chosen = typeFor[path] ? posts.filter(p => typeFor[path].includes(p.post_type) && p.slug) : [];
  const list = document.querySelector(listFor[path] || '.story-list');
  if (list && chosen.length) list.insertAdjacentHTML('beforeend', chosen.map((p,i) => {
    const href='/post?slug='+encodeURIComponent(p.slug), title=esc(p.title), summary=esc(p.subtitle || (p.body||'').replace(/\s+/g,' ').slice(0,180));
    return '<article class="story-row" data-item><div class="story-meta"><span>'+esc(kind(p))+'</span><span>NEW</span></div><div class="story-copy"><a href="'+href+'"><h2>'+title+'</h2></a><p>'+summary+'</p></div><button class="save-button" data-save="post:'+esc(p.slug)+'">♡</button></article>';
  }).join(''));
  if (path==='/' && posts.length) { const home=document.querySelector('.home-index'); if(home) home.insertAdjacentHTML('beforeend',posts.slice(0,4).map((p,i)=>'<a class="index-row" href="/post?slug='+encodeURIComponent(p.slug)+'"><span>'+String(i+5).padStart(2,'0')+'</span><small>'+esc(kind(p).toUpperCase())+'</small><strong>'+esc(p.title)+'</strong></a>').join('')); }
  const root=document.querySelector('#published-post'); if (!root) return;
  const post=posts.find(p=>p.slug===new URLSearchParams(location.search).get('slug'));
  if(!post){root.textContent='This publication is unavailable.';return;}
  document.title=post.title+' · SHWETA';
  const article=document.createElement('article'); article.className='reading-page wrap';
  article.innerHTML='<p class="eyebrow">'+esc(kind(post).toUpperCase())+' · SHWETA</p><h1>'+esc(post.title)+'</h1><p class="reading-deck">'+esc(post.subtitle)+'</p><p class="fine-print">BY SHWETA · '+(post.published_at?new Date(post.published_at).toLocaleDateString():'')+'</p><div class="published-copy"></div><aside class="legal-note"><strong>Information, not legal advice.</strong> Educational content only; check current law and sources before relying on it.</aside><section class="reader-interactions"><h2>Join the conversation</h2><p class="fine-print">Do not post private case details. Comments are reviewed before appearing.</p><div class="reader-auth"><form class="reader-login"><label>Email <input name="email" type="email" required></label><label>Password <input name="password" type="password" required></label><button class="button-primary">Sign in</button></form><p class="fine-print">Reader registration is not open yet.</p></div><div class="reader-actions" hidden><button id="like">Like</button><button id="bookmark">Save</button><button id="signout">Sign out</button><form id="comment"><label>Comment<textarea name="body" maxlength="4000" required></textarea></label><button class="button-primary">Submit for review</button></form></div><p role="status" class="reader-status"></p><h3>Approved comments</h3><div class="comments"></div></section>';
  const copy=article.querySelector('.published-copy'); (post.body||'').split(/\n\s*\n/).filter(Boolean).forEach(t=>{const p=document.createElement('p');p.textContent=t;copy.append(p);});
  root.replaceChildren(article);
  const status=article.querySelector('.reader-status'), auth=article.querySelector('.reader-auth'), actions=article.querySelector('.reader-actions');
  const say=t=>status.textContent=t;
  async function refresh(){const {data:{user}}=await db.auth.getUser();auth.hidden=!!user;actions.hidden=!user;if(!user)return;
    const liked=await db.from('post_likes').select('post_id').eq('post_id',post.id).eq('user_id',user.id);article.querySelector('#like').textContent=liked.data?.length?'Liked':'Like';
    const saved=await db.from('bookmarks').select('post_id').eq('post_id',post.id).eq('user_id',user.id);article.querySelector('#bookmark').textContent=saved.data?.length?'Saved':'Save';
    const {data:comments=[]}=await db.from('comments').select('body,created_at').eq('post_id',post.id).eq('status','visible').order('created_at');
    article.querySelector('.comments').replaceChildren(...comments.map(c=>{const p=document.createElement('p');p.textContent=c.body+' · '+new Date(c.created_at).toLocaleDateString();return p;}));
  }
  article.querySelector('.reader-login').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const {error}=await db.auth.signInWithPassword({email:f.get('email'),password:f.get('password')});say(error?error.message:'Signed in.');await refresh();});
  article.querySelector('#signout').addEventListener('click',async()=>{await db.auth.signOut();await refresh();say('Signed out.');});
  for (const [id,table,label] of [['like','post_likes','Like'],['bookmark','bookmarks','Save']]) article.querySelector('#'+id).addEventListener('click',async()=>{const {data:{user}}=await db.auth.getUser();if(!user)return;const b=article.querySelector('#'+id),exists=b.textContent!==(label);const result=exists?await db.from(table).delete().eq('post_id',post.id).eq('user_id',user.id):await db.from(table).insert({post_id:post.id,user_id:user.id});say(result.error?'Could not save your response.':'Updated.');await refresh();});
  article.querySelector('#comment').addEventListener('submit',async e=>{e.preventDefault();const {data:{user}}=await db.auth.getUser();if(!user)return;const body=new FormData(e.currentTarget).get('body').trim();const {error}=await db.from('comments').insert({post_id:post.id,user_id:user.id,body,status:'pending'});say(error?'Could not submit comment.':'Thanks. Your comment is awaiting review.');if(!error)e.currentTarget.reset();});
  await refresh();
})();
