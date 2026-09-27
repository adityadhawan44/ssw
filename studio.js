const config = window.SHWETA_STUDIO_CONFIG || {};
const notice = document.querySelector('#studio-notice');
const login = document.querySelector('#studio-login');
const mfa = document.querySelector('#studio-mfa');
const app = document.querySelector('#studio-app');
const editor = document.querySelector('#studio-editor');
let client, currentUser, posts = [], comments = [], selectedState = 'all', pendingFactor;
const message = (text, kind = 'info') => { notice.textContent = text; notice.dataset.kind = kind; notice.hidden = false; };
const safe = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

if (config.supabaseUrl && config.supabaseAnonKey) {
  try {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    client = createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    login.hidden = false;
    message('Sign in with Shweta’s owner account. The database verifies owner access and requires a second factor.');
    const { data: sessionData } = await client.auth.getSession();
    if (sessionData.session) await authorizeOwner();
  } catch (error) { message(`The publishing service could not be reached: ${error.message}`, 'error'); }
} else {
  message('The private publishing service is not connected yet. The public site remains available, but there is no demo login or client-side publishing bypass. A maintainer must configure Supabase and the single owner account before this studio can be activated.');
}

async function authorizeOwner() {
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) { message('Please sign in with Shweta’s owner account.', 'error'); login.hidden = false; return; }
  const { data: isOwner, error: ownerError } = await client.rpc('is_site_owner');
  if (ownerError || isOwner !== true) { await client.auth.signOut(); message('This account is not the publication owner.', 'error'); login.hidden = false; return; }
  currentUser = user;
  const { data: aal, error: aalError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError) { message('Could not verify the second factor. Please sign in again.', 'error'); return; }
  if (aal.currentLevel !== 'aal2') {
    const { data: factors } = await client.auth.mfa.listFactors();
    const factor = factors?.totp?.find(item => item.status === 'verified');
    if (factor) {
      const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId: factor.id });
      if (challengeError) { message(challengeError.message, 'error'); return; }
      pendingFactor = { id: factor.id, challengeId: challenge.id };
      login.hidden = true; mfa.hidden = false; message('Enter the current six-digit code from Shweta’s authenticator app.');
      return;
    }
    message('Owner confirmed. MFA is not enrolled yet. Have the technical maintainer enable and enroll an authenticator factor before using publishing controls.', 'error');
    return;
  }
  login.hidden = true; mfa.hidden = true; notice.hidden = true; app.hidden = false;
  document.querySelector('#studio-greeting').textContent = `Welcome, ${user.user_metadata?.full_name || 'Shweta'}.`;
  await refresh();
}

login?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(login);
  message('Checking owner sign-in…');
  const { error } = await client.auth.signInWithPassword({ email: form.get('email'), password: form.get('password') });
  if (error) { message(error.message, 'error'); return; }
  await authorizeOwner();
});
mfa?.addEventListener('submit', async event => {
  event.preventDefault(); const code = new FormData(mfa).get('code');
  const { error } = await client.auth.mfa.verify({ factorId: pendingFactor.id, challengeId: pendingFactor.challengeId, code });
  if (error) { message('That code could not be verified. Try the latest code from the authenticator app.', 'error'); return; }
  await authorizeOwner();
});
document.querySelector('#studio-signout')?.addEventListener('click', async () => { await client.auth.signOut(); location.reload(); });

async function refresh() {
  const { data, error } = await client.from('posts').select('*').order('updated_at', { ascending: false });
  if (error) { message(`Could not load posts: ${error.message}`, 'error'); return; }
  posts = data || [];
  document.querySelector('#studio-stats').innerHTML = [
    ['Published', posts.filter(p=>p.status==='published').length], ['Case files', posts.filter(p=>p.post_type==='Case Analysis'&&p.status!=='trashed').length],
    ['Rights guides', posts.filter(p=>p.post_type==='Rights Guide'&&p.status!=='trashed').length], ['Drafts', posts.filter(p=>p.status==='draft').length],
    ['Scheduled', posts.filter(p=>p.status==='scheduled').length]
  ].map(([label,count])=>`<div><strong>${count}</strong><span>${label}</span></div>`).join('');
  await renderPosts(); await refreshComments();
}
async function renderPosts() {
  const filtered = posts.filter(p=>selectedState==='all'||p.status===selectedState);
  document.querySelector('#studio-posts').innerHTML = filtered.length ? filtered.map(p=>`<article class="studio-post"><div><span class="studio-status ${safe(p.status)}">${safe(p.status)}</span><h3>${safe(p.title)}</h3><small>${safe(p.post_type)} · Updated ${new Date(p.updated_at).toLocaleDateString()}</small></div><div class="studio-actions">${p.status==='trashed'?`<button data-action="restore" data-id="${p.id}">Restore</button><button data-action="purge" data-id="${p.id}">Delete permanently</button>`:`<button data-action="edit" data-id="${p.id}">Edit</button><button data-action="trash" data-id="${p.id}">Move to trash</button>`}</div></article>`).join('') : '<p class="muted">No posts in this view yet.</p>';
}
document.querySelectorAll('.studio-filters button').forEach(button=>button.addEventListener('click',()=>{selectedState=button.dataset.state;document.querySelectorAll('.studio-filters button').forEach(b=>b.classList.toggle('is-active',b===button));renderPosts();}));
document.querySelector('#studio-new')?.addEventListener('click',()=>openEditor());
document.querySelector('#studio-cancel')?.addEventListener('click',()=>editor.hidden=true);
document.querySelector('#studio-post-form [name=status]')?.addEventListener('change',event=>{document.querySelector('#schedule-field').hidden=event.target.value!=='scheduled';});
function openEditor(post) {
  const form=document.querySelector('#studio-post-form'); form.reset(); form.elements.id.value=post?.id||''; form.elements.title.value=post?.title||''; form.elements.subtitle.value=post?.subtitle||'';
  form.elements.post_type.value=post?.post_type||'Article'; form.elements.body.value=post?.body||''; form.elements.tags.value=(post?.tags||[]).join(', ');
  form.elements.sources.value=(post?.sources||[]).map(s=>typeof s==='string'?s:s.url).join('\n'); form.elements.status.value=post?.status==='trashed'?'draft':(post?.status||'draft');
  if(post?.scheduled_at){const d=new Date(post.scheduled_at);form.elements.scheduled_at.value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
  document.querySelector('#studio-editor-title').textContent=post?'Edit post':'New post'; document.querySelector('#schedule-field').hidden=form.elements.status.value!=='scheduled'; editor.hidden=false; editor.scrollIntoView({behavior:'smooth',block:'start'});
}
document.querySelector('#studio-posts')?.addEventListener('click',async event=>{
  const button=event.target.closest('button[data-action]'); if(!button)return; const post=posts.find(p=>p.id===button.dataset.id); if(!post)return;
  if(button.dataset.action==='edit')openEditor(post);
  if(button.dataset.action==='trash'&&confirm('Move this post to trash? It will disappear from the public site and can be restored.')) await mutatePost(post.id,{status:'trashed'});
  if(button.dataset.action==='restore') await mutatePost(post.id,{status:'draft'});
  if(button.dataset.action==='purge'&&confirm('Permanently delete this post and its comments? This cannot be undone.')){const {error}=await client.from('posts').delete().eq('id',post.id);if(error)message(error.message,'error');else await refresh();}
});
async function mutatePost(id,changes){const {error}=await client.from('posts').update(changes).eq('id',id);if(error)message(error.message,'error');else await refresh();}
document.querySelector('#studio-post-form')?.addEventListener('submit',async event=>{
  event.preventDefault();const f=new FormData(event.currentTarget),id=f.get('id');
  const record={title:f.get('title').trim(),subtitle:f.get('subtitle').trim(),post_type:f.get('post_type'),body:f.get('body'),tags:f.get('tags').split(',').map(s=>s.trim()).filter(Boolean),sources:f.get('sources').split('\n').map(s=>s.trim()).filter(Boolean).map(url=>({url})),status:f.get('status'),scheduled_at:f.get('status')==='scheduled'?new Date(f.get('scheduled_at')).toISOString():null};
  if(record.status==='scheduled'&&(!f.get('scheduled_at')||new Date(record.scheduled_at)<=new Date())){message('Choose a future date and time for a scheduled post.','error');return;}
  const result=id?await client.from('posts').update(record).eq('id',id):await client.from('posts').insert(record);
  if(result.error){message(`Could not save this post: ${result.error.message}`,'error');return;} editor.hidden=true;message('Post saved.','success');await refresh();
});
async function refreshComments(){
  const {data,error}=await client.from('comments').select('id,body,status,created_at,post_id,reader_profiles(display_name),posts(title)').order('created_at',{ascending:false}).limit(100);
  if(error){document.querySelector('#studio-comment-list').innerHTML='<p class="muted">Comments could not be loaded.</p>';return;}comments=data||[];
  document.querySelector('#studio-comment-list').innerHTML=comments.length?comments.map(c=>`<article class="studio-comment"><div><span class="studio-status ${safe(c.status)}">${safe(c.status)}</span><p>${safe(c.body)}</p><small>${safe(c.reader_profiles?.display_name||'Reader')} · ${safe(c.posts?.title||'Post')}</small></div><div class="studio-actions">${c.status!=='visible'?`<button data-comment-action="approve" data-id="${c.id}">Approve</button>`:''}<button data-comment-action="delete" data-id="${c.id}">Delete</button></div></article>`).join(''):'<p class="muted">No reader comments yet.</p>';
}
document.querySelector('#studio-comment-list')?.addEventListener('click',async event=>{const b=event.target.closest('button[data-comment-action]');if(!b)return;const update=b.dataset.commentAction==='approve'?{status:'visible'}:{status:'deleted'};const {error}=await client.from('comments').update(update).eq('id',b.dataset.id);if(error)message(`Comment action failed: ${error.message}`,'error');else await refreshComments();});
