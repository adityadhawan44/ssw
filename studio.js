const config = window.SHWETA_STUDIO_CONFIG || {};
const notice = document.querySelector('#studio-notice');
const login = document.querySelector('#studio-login');
const passwordReset = document.querySelector('#studio-password-reset');
const mfa = document.querySelector('#studio-mfa');
const app = document.querySelector('#studio-app');
const editor = document.querySelector('#studio-editor');
let enrollPanel = document.querySelector('#studio-mfa-enroll');
if (!enrollPanel) {
  enrollPanel = document.createElement('section');
  enrollPanel.id = 'studio-mfa-enroll'; enrollPanel.className = 'studio-login'; enrollPanel.hidden = true;
  enrollPanel.innerHTML = '<h2>Secure your studio access</h2><p>Publishing and moderation require an authenticator. Shweta can enroll it with her own device.</p><button id="studio-mfa-start" class="button-primary" type="button">Set up authenticator</button><div id="studio-mfa-setup" hidden><p>Scan the code, then enter the six-digit code from the authenticator app.</p><img id="studio-mfa-qr" alt="Authenticator setup QR code" hidden style="width:200px;max-width:100%;background:#fff;padding:12px"><p>Manual setup key: <code id="studio-mfa-secret"></code></p><form id="studio-mfa-enroll-form" class="studio-login" hidden><label>Authenticator code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><button class="button-primary" type="submit">Verify authenticator</button></form></div>';
  login.insertAdjacentElement('afterend', enrollPanel);
}

let client, currentUser, posts = [], comments = [], selectedState = 'all', selectedType = 'all', pendingFactor;
const structuredFields={
  'Case Analysis':[['case_citation','Citation'],['court','Court'],['year','Year'],['bench','Bench'],['subject','Subject'],['background','Background'],['facts','Facts'],['legal_questions','Legal questions'],['arguments','Arguments'],['reasoning','Court’s reasoning'],['judgment','Judgment'],['significance','Why it matters'],['later_developments','Later developments'],['primary_judgment_url','Primary judgment URL'],['related_cases','Related cases']],
  'Rights Guide':[['audience','Who this is for'],['topic','Topic'],['basic_rule','The basic rule'],['what_counts','What the right covers'],['law_summary','What the law says'],['practical_steps','What you can do'],['documents_to_keep','Documents to keep'],['common_questions','Common questions'],['official_resources','Official resources']],
  'Research':[['research_question','Research question'],['executive_summary','Executive summary'],['methodology','Methodology'],['key_findings','Key findings'],['evidence','Evidence'],['analysis','Analysis'],['limitations','Limitations'],['downloads','Downloads and data']],
  'Opinion':[['opening','Opening'],['perspective','Perspective'],['authors_note','Author’s note'],['related_pieces','Related pieces']],
  'Essay':[['opening','Opening'],['perspective','Perspective'],['closing','Closing'],['authors_note','Author’s note']],
  'Announcement':[['issue_number','Issue number'],['introduction','Introduction'],['featured_case','Featured case'],['legal_development','Legal development'],['one_to_understand','One thing to understand'],['recommended_reading','Recommended reading'],['closing_note','Closing note'],['newsletter_subject','Newsletter subject'],['preview_text','Newsletter preview text']]
};
const structuredDrafts=new Map();
const message = (text, kind = 'info') => { notice.textContent = text; notice.dataset.kind = kind; notice.hidden = false; };
const safe = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function readStructuredData(){return Object.fromEntries([...document.querySelectorAll('#studio-structured-fields [data-structured-field]')].map(input=>[input.dataset.structuredField,input.value.trim()]).filter(([,value])=>value));}
function renderStructuredFields(type,data={}){const root=document.querySelector('#studio-structured-fields');if(!root)return;const fields=structuredFields[type]||[];root.hidden=!fields.length;root.innerHTML=fields.length?`<p class="eyebrow">${safe(type==='Announcement'?'THE BRIEF ISSUE DETAILS':`${type.toUpperCase()} DETAILS`)}</p><div class="studio-structured-grid">${fields.map(([name,label])=>`<label>${safe(label)}${name==='year'?`<input data-structured-field="${name}" inputmode="numeric" maxlength="4" value="${safe(data[name]||'')}">`:`<textarea data-structured-field="${name}" rows="${['case_citation','court','year','bench','subject','audience','topic','primary_judgment_url','issue_number','newsletter_subject','preview_text'].includes(name)?2:3}">${safe(data[name]||'')}</textarea>`}</label>`).join('')}</div>`:'';}

if (config.supabaseUrl && config.supabaseAnonKey) {
  try {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    client = createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    login.hidden = false;
    message('Sign in with Shweta’s owner account. The database verifies owner access and requires a second factor.');
    const { data: sessionData } = await client.auth.getSession();
    const recoveryFlow = new URLSearchParams(location.search).has('reset') || location.hash.includes('type=recovery');
    if (recoveryFlow && sessionData.session) {
      login.hidden = true;
      passwordReset.hidden = false;
      message('Choose a new password for the owner account.');
    } else if (sessionData.session) await authorizeOwner();
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
    }    const enrollPanel = document.querySelector('#studio-mfa-enroll');
    if (enrollPanel) { login.hidden = true; enrollPanel.hidden = false; }
    message('Before publishing, Shweta needs to enroll an authenticator on her own device.');
    return;
  }
  login.hidden = true; mfa.hidden = true; notice.hidden = true; app.hidden = false;
  document.querySelector('#studio-greeting').textContent = `Welcome, ${user.user_metadata?.full_name || 'Shweta'}.`;
  mountCMSNavigation();
  await mountPostFields();
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
document.querySelector('#studio-forgot-password')?.addEventListener('click', async () => {
  const email = login.elements.email.value.trim();
  if (!email) { login.elements.email.focus(); message('Enter the owner email first, then choose “Forgot password?”.', 'error'); return; }
  message('Sending a secure password reset link…');
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/studio?reset=1` });
  if (error) { message('We could not send a reset link. Check the owner email and try again.', 'error'); return; }
  message('If that owner account exists, Supabase has sent a password reset link. It expires after a short time. Check the inbox and spam folder.');
});
passwordReset?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(passwordReset), password = String(form.get('password')), confirmPassword = String(form.get('confirm_password'));
  if (password.length < 8) { message('Use at least 8 characters for the new password.', 'error'); return; }
  if (password !== confirmPassword) { message('The two passwords do not match.', 'error'); return; }
  const button = passwordReset.querySelector('button[type="submit"]'); button.disabled = true;
  const { error } = await client.auth.updateUser({ password });
  button.disabled = false;
  if (error) { message('The password could not be updated. Request a fresh reset link and try again.', 'error'); return; }
  history.replaceState(null, '', '/studio');
  passwordReset.hidden = true;
  message('Password updated. Verifying owner access…', 'success');
  await authorizeOwner();
});
mfa?.addEventListener('submit', async event => {
  event.preventDefault(); const code = new FormData(mfa).get('code');
  const { error } = await client.auth.mfa.verify({ factorId: pendingFactor.id, challengeId: pendingFactor.challengeId, code });
  if (error) { message('That code could not be verified. Try the latest code from the authenticator app.', 'error'); return; }
  await authorizeOwner();
});document.querySelector('#studio-mfa-start')?.addEventListener('click', async () => {
  message('Preparing authenticator setup…');
  const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'SHWETA publication studio' });
  if (error) { message(error.message, 'error'); return; }
  pendingFactor = { id: data.id };
  document.querySelector('#studio-mfa-qr').src = data.totp.qr_code;
  document.querySelector('#studio-mfa-secret').textContent = data.totp.secret;
  document.querySelector('#studio-mfa-setup').hidden = false;
  document.querySelector('#studio-mfa-qr').hidden = false;
  document.querySelector('#studio-mfa-enroll-form').hidden = false;
  document.querySelector('#studio-mfa-start').hidden = true;
  message('Scan the QR code, then enter the current six-digit authenticator code.');
});
document.querySelector('#studio-mfa-enroll-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  const code = new FormData(event.currentTarget).get('code');
  const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId: pendingFactor.id });
  if (challengeError) { message(challengeError.message, 'error'); return; }
  const { error } = await client.auth.mfa.verify({ factorId: pendingFactor.id, challengeId: challenge.id, code });
  if (error) { message('That code could not be verified. Try the latest six-digit code.', 'error'); return; }
  pendingFactor = undefined;
  await authorizeOwner();
});

document.querySelector('#studio-signout')?.addEventListener('click', async () => { await client.auth.signOut(); location.reload(); });

async function refresh() {
  const { data, error } = await client.from('posts').select('*').order('updated_at', { ascending: false });
  if (error) { message(`Could not load posts: ${error.message}`, 'error'); return; }
  posts = data || [];
  document.querySelector('#studio-stats').innerHTML = [
    ['Published', posts.filter(p=>p.status==='published').length], ['Drafts', posts.filter(p=>p.status==='draft').length],
    ['In review', posts.filter(p=>p.status==='in_review').length], ['Approved', posts.filter(p=>p.status==='approved').length],
    ['Scheduled', posts.filter(p=>p.status==='scheduled').length], ['Case files', posts.filter(p=>p.post_type==='Case Analysis'&&p.status!=='trashed').length],
    ['Rights guides', posts.filter(p=>p.post_type==='Rights Guide'&&p.status!=='trashed').length],
    ['Portfolio items', posts.filter(p=>['Speaking & Events','Project & Initiative','Media & Press','Resource'].includes(p.post_type)&&p.status!=='trashed').length]
  ].map(([label,count])=>`<div><strong>${count}</strong><span>${label}</span></div>`).join('');
  const recent=posts.slice(0,5);
  document.querySelector('#studio-recent > div').innerHTML=recent.length?recent.map(post=>`<article class="studio-recent-row"><span class="studio-status ${safe(post.status)}">${safe(post.status)}</span><strong>${safe(post.title||'Untitled')}</strong><small>${safe(post.post_type)} · ${new Date(post.updated_at).toLocaleDateString()}</small></article>`).join(''):'<p class="muted">Your saved work will appear here.</p>';
  await renderPosts(); await refreshComments();
}
async function renderPosts() {
  const perspectiveTypes=['Opinion','Essay'];
  const filtered = posts.filter(p=>(selectedState==='all'||(selectedState==='trash'?p.status==='trashed':p.status===selectedState))&&(selectedType==='all'||(selectedType==='Perspective'?perspectiveTypes.includes(p.post_type):selectedType==='Journal'?['Article'].includes(p.post_type):p.post_type===selectedType)));
  document.querySelector('#studio-posts').innerHTML = filtered.length ? filtered.map(p=>`<article class="studio-post"><div><span class="studio-status ${safe(p.status)}">${safe(p.status)}</span><h3>${safe(p.title)}</h3><small>${safe(p.post_type)} · Updated ${new Date(p.updated_at).toLocaleDateString()}</small></div><div class="studio-actions">${p.status==='trashed'?`<button data-action="restore" data-id="${p.id}">Restore</button><button data-action="purge" data-id="${p.id}">Delete permanently</button>`:`<button data-action="edit" data-id="${p.id}">Edit</button><button data-action="trash" data-id="${p.id}">Move to trash</button>`}</div></article>`).join('') : '<p class="muted">No posts in this view yet.</p>';
}
document.querySelectorAll('.studio-filters button').forEach(button=>button.addEventListener('click',()=>{selectedState=button.dataset.state;document.querySelectorAll('.studio-filters button').forEach(b=>b.classList.toggle('is-active',b===button));renderPosts();}));
document.querySelectorAll('.studio-nav a').forEach(link=>link.addEventListener('click',event=>{if(link.dataset.workspace){event.preventDefault();if(link.dataset.workspace==='dashboard'||link.dataset.workspace==='content')showWorkspace(link.dataset.workspace);return;}selectedType=link.dataset.contentType||'all';showWorkspace('content');renderPosts();}));
document.querySelectorAll('[data-new-type]').forEach(button=>button.addEventListener('click',()=>{openEditor();document.querySelector('#studio-post-form').elements.post_type.value=button.dataset.newType;}));
document.querySelector('#studio-new')?.addEventListener('click',()=>openEditor());
document.querySelector('#studio-cancel')?.addEventListener('click',()=>editor.hidden=true);
document.querySelector('#studio-post-form [name=status]')?.addEventListener('change',event=>{document.querySelector('#schedule-field').hidden=event.target.value!=='scheduled';});
document.querySelector('#studio-post-form [name=post_type]')?.addEventListener('change',event=>{
  const outlines={
    'Case Analysis':'## Background\n\n## Facts\n\n## Legal questions\n\n## Arguments\n\n## Court’s reasoning\n\n## Judgment\n\n## Why it matters\n\n## Later developments',
    'Rights Guide':'## Who this is for\n\n## The basic rule\n\n## What the law says\n\n## What you can do\n\n## Documents to keep\n\n## Common questions\n\n## Official resources',
    'Research':'## Research question\n\n## Executive summary\n\n## Methodology\n\n## Key findings\n\n## Evidence and analysis\n\n## Limitations',
    'Opinion':'## Opening\n\n## Perspective\n\n## Author’s note',
    'Essay':'## Opening\n\n## Perspective\n\n## Closing',
    'Announcement':'## Introduction\n\n## Featured case\n\n## Legal development\n\n## One thing to understand\n\n## Recommended reading\n\n## Closing note',
    'Speaking & Events':'## Event\n\n## Role\n\n## Date and location\n\n## Key themes\n\n## Recap or recording',
    'Project & Initiative':'## Purpose\n\n## Who it serves\n\n## My contribution\n\n## Outcomes\n\n## Partners and resources',
    'Media & Press':'## Publication or outlet\n\n## Date\n\n## Summary\n\n## Coverage link',
    'Resource':'## Who this resource is for\n\n## How to use it\n\n## Key information\n\n## Official links'
  };
  const body=editorForm.elements.body;
  if(!body.value.trim()&&outlines[event.target.value]&&!structuredFields[event.target.value]){body.value=outlines[event.target.value];updateChecklist();}
});
function openEditor(post) {
  const form=document.querySelector('#studio-post-form'); form.reset(); structuredDrafts.clear(); form.elements.id.value=post?.id||''; form.elements.title.value=post?.title||''; form.elements.subtitle.value=post?.subtitle||'';
  form.elements.slug.value=post?.slug||'';
  form.elements.post_type.value=post?.post_type||'Article'; form.elements.body.value=post?.body||''; form.elements.tags.value=(post?.tags||[]).join(', ');
  form.dataset.structuredType=form.elements.post_type.value;renderStructuredFields(form.elements.post_type.value,post?.structured_data||{});
  form.elements.sources.value=(post?.sources||[]).map(s=>typeof s==='string'?s:s.url).join('\n'); form.elements.status.value=post?.status==='trashed'?'draft':(post?.status||'draft');
  for(const key of ['author_id','seo_title','seo_description','canonical_url','last_reviewed_at','correction_note'])if(form.elements[key])form.elements[key].value=post?.[key]||'';
  if(form.elements.featured)form.elements.featured.checked=Boolean(post?.featured);
  let saved=null;if(!post){try{saved=JSON.parse(localStorage.getItem(autoSaveKey())||'null');if(saved)for(const name of ['title','subtitle','slug','post_type','body','tags','sources'])if(saved[name]!==undefined)form.elements[name].value=saved[name];}catch{}}
  form.dataset.structuredType=form.elements.post_type.value;renderStructuredFields(form.elements.post_type.value,saved?.structured_data||post?.structured_data||{});
  if(post?.scheduled_at){const d=new Date(post.scheduled_at);form.elements.scheduled_at.value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
  document.querySelector('#studio-editor-title').textContent=post?'Edit post':'New post'; document.querySelector('#schedule-field').hidden=form.elements.status.value!=='scheduled'; editor.hidden=false; editor.scrollIntoView({behavior:'smooth',block:'start'});
  updateChecklist();
}
function mountCMSNavigation() {
  const nav=document.querySelector('.studio-nav');
  if(!nav||document.querySelector('#studio-workspace-view'))return;
  const links=[['Sources','sources'],['Authors','authors'],['Media library','media'],['Corrections','corrections'],['Revision history','revisions'],['Activity log','activity'],['Settings','settings']];
  const dashboardLink=nav.querySelector('a[href="#studio-dashboard"]');if(dashboardLink)dashboardLink.dataset.workspace='dashboard';
  const contentLink=nav.querySelector('a[href="#studio-post-view"]:not([data-content-type])');if(contentLink)contentLink.dataset.workspace='content';
  for(const [label,view] of [['Review queue','review'],['Scheduled','scheduled'],...links]){const link=document.createElement('a');link.href='#studio-workspace-view';link.dataset.workspace=view;link.textContent=label;nav.append(link);}
  const workspace=document.createElement('section');workspace.id='studio-workspace-view';workspace.hidden=true;workspace.innerHTML='<div class="studio-toolbar"><button type="button" class="tool-button" data-workspace-back>← Dashboard</button><h2 id="studio-workspace-title">Studio library</h2></div><div id="studio-workspace-content"></div>';
  document.querySelector('#studio-comments-view').before(workspace);
  nav.addEventListener('click',event=>{const link=event.target.closest('a[data-workspace]');if(!link)return;event.preventDefault();showWorkspace(link.dataset.workspace);});
  workspace.addEventListener('click',event=>{if(event.target.closest('[data-workspace-back]'))showWorkspace('dashboard');});
  workspace.addEventListener('submit',handleWorkspaceSubmit);
  workspace.addEventListener('change',handleWorkspaceChange);
  workspace.addEventListener('click',handleWorkspaceAction);
}
async function mountPostFields(){
  const form=document.querySelector('#studio-post-form');if(!form||form.dataset.cmsFields)return;form.dataset.cmsFields='ready';
  const status=form.elements.status;
  for(const [value,label] of [['in_review','Submit for editorial review'],['approved','Approved for publication'],['archived','Archive']]){const option=document.createElement('option');option.value=value;option.textContent=label;status.add(option);}
  const fields=document.createElement('div');fields.className='studio-metadata-fields';fields.innerHTML='<label>Author<select name="author_id"><option value="">SHWETA</option></select></label><label>SEO title<input name="seo_title" maxlength="70" placeholder="Uses the article title when blank"></label><label>Search description<textarea name="seo_description" maxlength="170" rows="3" placeholder="A concise description for search results"></textarea></label><label>Canonical URL<input name="canonical_url" type="url" placeholder="Optional canonical address"></label><label>Last reviewed<input name="last_reviewed_at" type="date"></label><label class="studio-inline-check"><input name="featured" type="checkbox"> Feature on the homepage</label><label>Correction note<textarea name="correction_note" rows="2" placeholder="Optional public correction note"></textarea></label>';
  document.querySelector('#studio-checklist').after(fields);
  const structured=document.createElement('section');structured.id='studio-structured-fields';structured.className='studio-structured-fields';document.querySelector('#studio-checklist').before(structured);
  form.elements.body.required=false;
  form.dataset.structuredType=form.elements.post_type.value;
  form.elements.post_type.addEventListener('change',()=>{const prior=form.dataset.structuredType;if(prior)structuredDrafts.set(prior,readStructuredData());form.dataset.structuredType=form.elements.post_type.value;renderStructuredFields(form.elements.post_type.value,structuredDrafts.get(form.elements.post_type.value)||{});updateChecklist();});
  const {data,error}=await client.from('studio_authors').select('id,name').eq('active',true).order('name');
  if(!error)fields.querySelector('select[name=author_id]').innerHTML='<option value="">SHWETA</option>'+(data||[]).map(author=>`<option value="${safe(author.id)}">${safe(author.name)}</option>`).join('');
  const sourceField=form.elements.sources,sourcePicker=document.createElement('select');sourcePicker.setAttribute('aria-label','Insert a saved source');sourcePicker.innerHTML='<option value="">Insert source from library…</option>';
  sourceField.after(sourcePicker);sourcePicker.addEventListener('change',()=>{const url=sourcePicker.value;if(!url)return;sourceField.value=[sourceField.value.trim(),url].filter(Boolean).join('\n');sourceField.dispatchEvent(new Event('input',{bubbles:true}));sourcePicker.value='';});
  const {data:sources}=await client.from('studio_sources').select('title,url').order('title').limit(100);for(const source of sources||[]){const option=document.createElement('option');option.value=source.url;option.textContent=source.title;sourcePicker.append(option);}
}
const workspaceNames={sources:'Source library',authors:'Authors',media:'Media library',corrections:'Corrections',revisions:'Revision history',activity:'Activity log',settings:'Publication settings',dashboard:'Publication dashboard',review:'Editorial review queue',scheduled:'Scheduled publishing'};
async function showWorkspace(view){
  if(['review','scheduled'].includes(view)){selectedState=view==='review'?'in_review':'scheduled';document.querySelectorAll('.studio-filters button').forEach(button=>button.classList.toggle('is-active',button.dataset.state===selectedState));}
  if(view==='content'){selectedState='all';document.querySelectorAll('.studio-filters button').forEach(button=>button.classList.toggle('is-active',button.dataset.state==='all'));}
  const mainSections=['#studio-dashboard','#studio-post-view','#studio-editor','#studio-comments-view'];
  for(const selector of mainSections){const node=document.querySelector(selector);if(node)node.hidden=view!=='dashboard'&&!(['content','review','scheduled'].includes(view)&&selector==='#studio-post-view');}
  const panel=document.querySelector('#studio-workspace-view');if(!panel)return;panel.hidden=view==='dashboard'||['content','review','scheduled'].includes(view);
  if(view==='dashboard'){document.querySelector('#studio-dashboard').hidden=false;return;}
  if(view==='content'){document.querySelector('#studio-post-view').hidden=false;renderPosts();return;}
  const title=document.querySelector('#studio-workspace-title'),root=document.querySelector('#studio-workspace-content');title.textContent=workspaceNames[view]||'Studio library';root.innerHTML='<p class="muted">Loading…</p>';
  const tableByView={sources:['studio_sources','*','created_at'],authors:['studio_authors','*','name'],media:['studio_media','*','created_at'],corrections:['studio_corrections','*','created_at'],revisions:['studio_revisions','*','created_at'],activity:['studio_activity','*','created_at'],settings:['studio_settings','*','key']};
  if(view==='settings'){await renderSettings(root);return;}
  const [table,columns,order]=tableByView[view]||[];if(!table){root.innerHTML='<p class="muted">Unknown studio view.</p>';return;}
  const {data,error}=await client.from(table).select(columns).order(order,{ascending:false}).limit(100);
  if(error){root.innerHTML=`<p class="studio-notice" data-kind="error">${safe(error.message)}. Apply <code>studio-cms.sql</code> in Supabase to activate these tools.</p>`;return;}
  if(view==='sources')renderSources(root,data||[]);
  if(view==='authors')renderAuthors(root,data||[]);
  if(view==='media'){const assets=await Promise.all((data||[]).map(async item=>{if(!String(item.url||'').startsWith('storage://'))return item;const path=item.url.slice('storage://'.length);const {data:signed}=await client.storage.from('shweta-studio-private-media').createSignedUrl(path,3600);return {...item,display_url:signed?.signedUrl||''};}));renderMedia(root,assets);}
  if(view==='corrections')renderCorrections(root,data||[]);
  if(view==='revisions')renderRevisions(root,data||[]);
  if(view==='activity')renderActivity(root,data||[]);
}
function renderSources(root,rows){root.innerHTML=`<form class="studio-library-form" data-form="source"><h3>Add a legal source</h3><label>Title<input name="title" required maxlength="240"></label><label>Type<select name="source_type"><option>Supreme Court judgment</option><option>High Court judgment</option><option>Act / legislation</option><option>Government notification</option><option>Official document</option><option>Academic paper</option><option>Secondary source</option></select></label><label>Classification<select name="classification"><option>Primary</option><option>Secondary</option></select></label><label>Court or publisher<input name="court_or_publisher"></label><label>Year<input name="year" type="number" min="1800" max="2200"></label><label>Citation<input name="citation"></label><label>URL<input name="url" type="url" required></label><label>Research note<textarea name="notes" rows="2"></textarea></label><button class="button-primary">Save source</button></form><div class="studio-library-list">${rows.length?rows.map(item=>`<article class="studio-post"><div><h3>${safe(item.title)}</h3><small>${safe(item.source_type)} · ${safe(item.classification)} · ${safe(item.court_or_publisher)} ${safe(item.year||'')}</small><p>${safe(item.citation)}</p><a href="${safe(item.url)}" target="_blank" rel="noopener noreferrer">Open source ↗</a><p>${safe(item.notes)}</p></div></article>`).join(''):'<p class="muted">Your source library is empty.</p>'}</div>`;}
function renderAuthors(root,rows){root.innerHTML=`<form class="studio-library-form" data-form="author"><h3>Add an author</h3><label>Name<input name="name" required maxlength="120"></label><label>Role<input name="role" value="Writer"></label><label>Biography<textarea name="bio" rows="3"></textarea></label><label>Photo URL<input name="photo_url" type="url"></label><label>Areas of work<input name="areas" placeholder="Law, rights, research"></label><button class="button-primary">Save author</button></form><div class="studio-library-list">${rows.length?rows.map(item=>`<article class="studio-post"><div><span class="studio-status ${item.active?'published':'archived'}">${item.active?'Active':'Inactive'}</span><h3>${safe(item.name)}</h3><small>${safe(item.role)} · ${safe((item.areas||[]).join(', '))}</small><p>${safe(item.bio)}</p></div><button data-cms-action="toggle-author" data-id="${safe(item.id)}" data-active="${item.active}">${item.active?'Deactivate':'Reactivate'}</button></article>`).join(''):'<p class="muted">Add the publication’s authors here.</p>'}</div>`;}
function renderMedia(root,rows){root.innerHTML=`<form class="studio-library-form" data-form="media-upload"><h3>Upload a private media file</h3><p class="fine-print">Files are private to the studio owner. To publish an image or document, add its approved public URL to the article or source library.</p><label>File<input name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required></label><label>Asset title<input name="title" placeholder="Uses the filename if blank"></label><label>Alternative text<input name="alt_text" required></label><label>Caption<textarea name="caption" rows="2"></textarea></label><label>Credit<input name="credit"></label><button class="button-primary">Upload private file</button></form><form class="studio-library-form" data-form="media"><h3>Register an already public asset</h3><label>Asset title<input name="title" required></label><label>Public image or document URL<input name="url" type="url" required></label><label>Alternative text<input name="alt_text" required></label><label>Caption<textarea name="caption" rows="2"></textarea></label><label>Credit<input name="credit"></label><button class="button-primary">Save public asset</button></form><div class="studio-library-list">${rows.length?rows.map(item=>`<article class="studio-post"><div><h3>${safe(item.title)}</h3>${item.display_url?`<a href="${safe(item.display_url)}" target="_blank" rel="noopener noreferrer">Open private file ↗</a>`:item.url?.startsWith('storage://')?'<span>Private file link unavailable</span>':`<a href="${safe(item.url)}" target="_blank" rel="noopener noreferrer">Open public asset ↗</a>`}<p>${safe(item.alt_text)}</p><small>${safe(item.caption)} · ${safe(item.credit)}</small></div><button data-cms-action="delete-row" data-table="studio_media" data-id="${safe(item.id)}">Remove</button></article>`).join(''):'<p class="muted">No media assets are registered.</p>'}</div>`;}
function renderCorrections(root,rows){root.innerHTML=`<form class="studio-library-form" data-form="correction"><h3>Record a correction</h3><label>Article<select name="post_id"><option value="">No linked article</option>${posts.map(p=>`<option value="${safe(p.id)}">${safe(p.title)}</option>`).join('')}</select></label><label>Reported issue<input name="details" required maxlength="2000"></label><label>Public correction note<textarea name="correction_note" rows="3"></textarea></label><button class="button-primary">Add to correction queue</button></form><div class="studio-library-list">${rows.length?rows.map(item=>`<article class="studio-post"><div><span class="studio-status ${safe(item.status)}">${safe(item.status)}</span><h3>${safe(item.post_title||'Unlinked correction')}</h3><p>${safe(item.details)}</p>${item.correction_note?`<p><strong>Public note:</strong> ${safe(item.correction_note)}</p>`:''}<small>${new Date(item.created_at).toLocaleString()}</small></div><select data-cms-action="correction-status" data-id="${safe(item.id)}"><option ${item.status==='pending'?'selected':''}>pending</option><option ${item.status==='investigating'?'selected':''}>investigating</option><option ${item.status==='resolved'?'selected':''}>resolved</option><option ${item.status==='declined'?'selected':''}>declined</option></select></article>`).join(''):'<p class="muted">No corrections recorded.</p>'}</div>`;}
function renderRevisions(root,rows){root.innerHTML=`<label>Filter by publication<select data-revision-post><option value="">All content</option>${posts.map(p=>`<option value="${safe(p.id)}">${safe(p.title)}</option>`).join('')}</select></label><div class="studio-library-list">${rows.length?rows.map(item=>{const snap=item.snapshot||{};return `<article class="studio-post"><div><h3>${safe(snap.title||'Untitled publication')}</h3><small>${safe(snap.post_type)} · ${safe(snap.status)} · ${new Date(item.created_at).toLocaleString()}</small><details><summary>View saved version</summary><p>${safe(snap.subtitle)}</p><pre>${safe(String(snap.body||'').slice(0,12000))}</pre></details></div><button data-cms-action="restore-revision" data-id="${safe(item.id)}" data-post="${safe(item.post_id)}">Restore this version</button></article>`;}).join(''):'<p class="muted">Saved revisions appear after the migration is applied and content is edited.</p>'}</div>`;}
function renderActivity(root,rows){root.innerHTML=`<p class="fine-print">Owner-only publishing activity. Login details and session secrets are never displayed here.</p><div class="studio-library-list">${rows.length?rows.map(item=>`<article class="studio-recent-row"><span>${new Date(item.created_at).toLocaleString()}</span><strong>${safe(item.summary)}</strong><small>${safe(item.action)} · ${safe(item.object_type)} · ${safe(item.actor_id?(item.actor_id===currentUser?.id?'You':'Studio contributor'):'Scheduled publisher')}</small></article>`).join(''):'<p class="muted">Activity will appear here as publications are saved.</p>'}</div>`;}
async function renderSettings(root){const [{data:settings,error},{data:featured}]=await Promise.all([client.from('studio_settings').select('*').order('key'),client.from('posts').select('id,title,featured').neq('status','trashed')]);if(error){root.innerHTML=`<p class="studio-notice" data-kind="error">${safe(error.message)}. Apply <code>studio-cms.sql</code> in Supabase to activate settings.</p>`;return;}root.innerHTML=`<section class="studio-settings-card"><h3>Homepage feature</h3><p class="fine-print">Choose one publication to feature at the top of the dynamic library. This controls the live homepage list after the accompanying site update.</p><label>Featured publication<select data-featured-post><option value="">No featured publication</option>${(featured||[]).map(p=>`<option value="${safe(p.id)}" ${p.featured?'selected':''}>${safe(p.title)}</option>`).join('')}</select></label><button class="button-primary" data-cms-action="save-featured">Save homepage choice</button></section><form class="studio-library-form" data-form="setting"><h3>Editorial setting</h3><label>Setting key<input name="key" required pattern="[a-z0-9_-]+" placeholder="editorial_notice"></label><label>Value<textarea name="value" rows="3" required placeholder="Plain text or JSON"></textarea></label><button class="button-primary">Save setting</button></form><div class="studio-library-list">${(settings||[]).map(item=>`<article class="studio-post"><div><h3>${safe(item.key)}</h3><pre>${safe(JSON.stringify(item.value,null,2))}</pre></div></article>`).join('')||'<p class="muted">No editorial settings saved.</p>'}</div>`;}
async function handleWorkspaceSubmit(event){const form=event.target.closest('form[data-form]');if(!form)return;event.preventDefault();const values=Object.fromEntries(new FormData(form));let table,payload;
  if(form.dataset.form==='media-upload'){const file=form.elements.file.files[0];const allowed=['image/jpeg','image/png','image/webp','image/gif','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];if(!file||!allowed.includes(file.type)||file.size>25*1024*1024){message('Choose a supported image or document no larger than 25 MB.','error');return;}const cleanName=file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(-120)||'asset';const path=`${currentUser.id}/${crypto.randomUUID()}-${cleanName}`;const {error:uploadError}=await client.storage.from('shweta-studio-private-media').upload(path,file,{upsert:false,contentType:file.type});if(uploadError){message(`Upload failed: ${uploadError.message}`,'error');return;}const {error:rowError}=await client.from('studio_media').insert({title:values.title.trim()||file.name,url:`storage://${path}`,alt_text:values.alt_text.trim(),caption:values.caption||'',credit:values.credit||'',created_by:currentUser.id});if(rowError){await client.storage.from('shweta-studio-private-media').remove([path]);message(`File uploaded but the library record failed: ${rowError.message}`,'error');return;}message('Private file uploaded.','success');form.reset();await showWorkspace('media');return;}
  if(form.dataset.form==='source'){if(!/^https?:\/\//i.test(values.url)){message('Enter a secure HTTP or HTTPS source URL.','error');return;}table='studio_sources';payload={...values,year:values.year?Number(values.year):null,created_by:currentUser.id};}
  if(form.dataset.form==='author'){table='studio_authors';payload={...values,areas:values.areas.split(',').map(x=>x.trim()).filter(Boolean)};}
  if(form.dataset.form==='media'){if(!/^https?:\/\//i.test(values.url)){message('Enter an HTTP or HTTPS media URL.','error');return;}table='studio_media';payload={...values,created_by:currentUser.id};}
  if(form.dataset.form==='correction'){const post=posts.find(p=>p.id===values.post_id);table='studio_corrections';payload={post_id:values.post_id||null,post_title:post?.title||'',details:values.details,correction_note:values.correction_note||'',created_by:currentUser.id};}
  if(form.dataset.form==='setting'){let value;try{value=JSON.parse(values.value);}catch{value=values.value;}table='studio_settings';payload={key:values.key,value,updated_by:currentUser.id,updated_at:new Date().toISOString()};}
  const {error}=await client.from(table).upsert(payload);if(error){message(`Could not save: ${error.message}`,'error');return;}message('Saved successfully.','success');await showWorkspace(form.dataset.form==='setting'?'settings':form.dataset.form==='correction'?'corrections':form.dataset.form==='author'?'authors':form.dataset.form==='media'?'media':'sources');}
async function handleWorkspaceChange(event){const control=event.target.closest('[data-cms-action="correction-status"],[data-revision-post]');if(!control)return;if(control.dataset.cmsAction==='correction-status'){const status=control.value;const patch={status,updated_at:new Date().toISOString(),resolved_at:status==='resolved'?new Date().toISOString():null};const {error}=await client.from('studio_corrections').update(patch).eq('id',control.dataset.id);if(error)message(error.message,'error');else message('Correction queue updated.','success');}if(control.matches('[data-revision-post]')){const {data,error}=await client.from('studio_revisions').select('*').order('created_at',{ascending:false}).limit(100);if(error){message(error.message,'error');return;}renderRevisions(document.querySelector('#studio-workspace-content'),control.value?(data||[]).filter(x=>x.post_id===control.value):data||[]);}}
async function handleWorkspaceAction(event){const button=event.target.closest('[data-cms-action]');if(!button)return;const action=button.dataset.cmsAction;let result;
  if(action==='toggle-author'){result=await client.from('studio_authors').update({active:button.dataset.active!=='true',updated_at:new Date().toISOString()}).eq('id',button.dataset.id);if(!result.error)await showWorkspace('authors');}
  if(action==='delete-row'){const {data:item,error:lookupError}=await client.from(button.dataset.table).select('url').eq('id',button.dataset.id).single();if(lookupError){message(lookupError.message,'error');return;}if(!confirm('Remove this media library entry permanently?'))return;if(String(item.url||'').startsWith('storage://')){const path=item.url.slice('storage://'.length);const {error:storageError}=await client.storage.from('shweta-studio-private-media').remove([path]);if(storageError){message(storageError.message,'error');return;}}result=await client.from(button.dataset.table).delete().eq('id',button.dataset.id);if(!result.error)await showWorkspace('media');}
  if(action==='restore-revision'){const {data:revision,error}=await client.from('studio_revisions').select('snapshot').eq('id',button.dataset.id).single();if(error){message(error.message,'error');return;}const snap=revision.snapshot;const patch={title:snap.title,slug:snap.slug,subtitle:snap.subtitle,post_type:snap.post_type,body:snap.body,structured_data:snap.structured_data||{},tags:snap.tags,sources:snap.sources,author_id:snap.author_id||null,author_name:snap.author_name||'Shweta',seo_title:snap.seo_title||'',seo_description:snap.seo_description||'',canonical_url:snap.canonical_url||'',featured:Boolean(snap.featured),last_reviewed_at:snap.last_reviewed_at||null,correction_note:snap.correction_note||'',status:'draft',scheduled_at:null,published_at:null};if(!confirm('Restore this saved version as a draft?'))return;result=await client.from('posts').update(patch).eq('id',button.dataset.post);if(!result.error){await refresh();message('Version restored as a draft.','success');await showWorkspace('revisions');}}
  if(action==='save-featured'){const featuredId=document.querySelector('[data-featured-post]').value;result=await client.from('posts').update({featured:false}).neq('id','00000000-0000-0000-0000-000000000000');if(!result.error&&featuredId)result=await client.from('posts').update({featured:true}).eq('id',featuredId);if(!result.error){await refresh();message('Homepage feature updated.','success');}}
  if(result?.error)message(result.error.message,'error');}
const editorForm=document.querySelector('#studio-post-form');
const autoSaveKey=()=>`shweta-studio-draft:${currentUser?.id||'owner'}:${editorForm.elements.id.value||'new'}`;
function updateChecklist(){
  if(!editorForm)return;
  const checks=[['Title',editorForm.elements.title.value.trim()],['Excerpt',editorForm.elements.subtitle.value.trim()],['Article body',editorForm.elements.body.value.trim()||Object.keys(readStructuredData()).length>0],['At least one source',editorForm.elements.sources.value.trim()]];
  document.querySelector('#studio-checklist').innerHTML=`<p class="eyebrow">PUBLICATION CHECKLIST</p><ul>${checks.map(([label,value])=>`<li class="${value?'is-complete':'is-pending'}"><span>${value?'✓':'○'}</span>${label}</li>`).join('')}</ul>`;
}
let autosaveTimer;
editorForm?.addEventListener('input',()=>{
  updateChecklist(); clearTimeout(autosaveTimer);
  autosaveTimer=setTimeout(()=>{
    const snapshot=Object.fromEntries(['title','subtitle','slug','post_type','body','tags','sources'].map(name=>[name,editorForm.elements[name].value]));snapshot.structured_data=readStructuredData();
    localStorage.setItem(autoSaveKey(),JSON.stringify(snapshot));
    message('Draft saved on this device.');
  },800);
});
document.querySelectorAll('.studio-editor-tools [data-insert]').forEach(button=>button.addEventListener('click',()=>{
  const area=editorForm.elements.body,template=button.dataset.insert,start=area.selectionStart,end=area.selectionEnd,selected=area.value.slice(start,end)||'text',parts=template.split('|');
  const before=parts[0]||'',after=parts[1]||'',insert=before+selected+after;
  area.setRangeText(insert,start,end,'select'); area.focus(); area.dispatchEvent(new Event('input',{bubbles:true}));
}));
function previewMarkup(text){
  const inline=value=>safe(value).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" rel="noopener noreferrer">$1</a>');
  return String(text||'').trim().split(/\n{2,}/).filter(Boolean).map(block=>{
    const lines=block.split('\n');
    if(/^#{1,3}\s/.test(lines[0])){const level=Math.min(lines[0].match(/^#+/)[0].length+1,4);return `<h${level}>${inline(lines[0].replace(/^#{1,3}\s/,''))}</h${level}>`;}
    if(lines.every(line=>/^>\s?/.test(line)))return `<blockquote>${lines.map(line=>inline(line.replace(/^>\s?/,''))).join('<br>')}</blockquote>`;
    if(lines.every(line=>/^[-*]\s+/.test(line)))return `<ul>${lines.map(line=>`<li>${inline(line.replace(/^[-*]\s+/,''))}</li>`).join('')}</ul>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}
document.querySelector('#studio-preview-open')?.addEventListener('click',()=>{
  const form=editorForm,preview=document.querySelector('#studio-preview');
  document.querySelector('#studio-preview-type').textContent=`${form.elements.post_type.value} · SHWETA`;
  document.querySelector('#studio-preview-title').textContent=form.elements.title.value||'Untitled publication';
  document.querySelector('#studio-preview-subtitle').textContent=form.elements.subtitle.value;
  const structured=readStructuredData(),sections=Object.entries(structured).map(([key,value])=>`## ${key.replace(/_/g,' ')}\n\n${value}`).join('\n\n');
  document.querySelector('#studio-preview-body').innerHTML=previewMarkup([sections,form.elements.body.value.trim()].filter(Boolean).join('\n\n'));
  preview.showModal();
});
document.querySelector('#studio-preview-close')?.addEventListener('click',()=>document.querySelector('#studio-preview').close());
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
  const slug=String(f.get('slug')||'').trim()||f.get('title').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const scheduleValue=String(f.get('scheduled_at')||'');
  if(f.get('status')==='scheduled'&&(!scheduleValue||new Date(scheduleValue)<=new Date())){message('Choose a future date and time for a scheduled post.','error');return;}
  const oldRecord=posts.find(post=>post.id===id);
  const authorOption=editorForm.elements.author_id?.selectedOptions?.[0];
  const structuredData=readStructuredData();
  const record={slug,title:f.get('title').trim(),subtitle:f.get('subtitle').trim(),post_type:f.get('post_type'),body:f.get('body').trim(),structured_data:structuredData,tags:f.get('tags').split(',').map(s=>s.trim()).filter(Boolean),sources:f.get('sources').split('\n').map(s=>s.trim()).filter(Boolean).map(url=>({url})),status:f.get('status'),scheduled_at:f.get('status')==='scheduled'?new Date(scheduleValue).toISOString():null,published_at:f.get('status')==='published'?(oldRecord?.published_at||new Date().toISOString()):null,author_id:f.get('author_id')||null,author_name:authorOption?.value?authorOption.textContent:'Shweta',seo_title:f.get('seo_title')||'',seo_description:f.get('seo_description')||'',canonical_url:f.get('canonical_url')||'',last_reviewed_at:f.get('last_reviewed_at')||null,correction_note:f.get('correction_note')||'',featured:editorForm.elements.featured?.checked||false};
  const hasContent=Boolean(record.body||Object.keys(record.structured_data).length);
  if(['in_review','approved','scheduled','published'].includes(record.status)&&(!record.subtitle||!hasContent||!record.sources.length)){message('Before sending this to review or publishing, add an excerpt, article content, and at least one source. You can still save it as a draft.','error');return;}
  const result=id?await client.from('posts').update(record).eq('id',id):await client.from('posts').insert(record);
  if(result.error){message(`Could not save this post: ${result.error.message}`,'error');return;} localStorage.removeItem(autoSaveKey());editor.hidden=true;message(record.status==='published'?'Publication is live.':'Post saved.','success');await refresh();
});
async function refreshComments(){
  const {data,error}=await client.from('comments').select('id,body,status,created_at,post_id,reader_profiles(display_name),posts(title)').order('created_at',{ascending:false}).limit(100);
  if(error){document.querySelector('#studio-comment-list').innerHTML='<p class="muted">Comments could not be loaded.</p>';return;}comments=data||[];
  document.querySelector('#studio-comment-list').innerHTML=comments.length?comments.map(c=>`<article class="studio-comment"><div><span class="studio-status ${safe(c.status)}">${safe(c.status)}</span><p>${safe(c.body)}</p><small>${safe(c.reader_profiles?.display_name||'Reader')} · ${safe(c.posts?.title||'Post')}</small></div><div class="studio-actions">${c.status!=='visible'?`<button data-comment-action="approve" data-id="${c.id}">Approve</button>`:''}<button data-comment-action="delete" data-id="${c.id}">Delete</button></div></article>`).join(''):'<p class="muted">No reader comments yet.</p>';
}
document.querySelector('#studio-comment-list')?.addEventListener('click',async event=>{const b=event.target.closest('button[data-comment-action]');if(!b)return;const update=b.dataset.commentAction==='approve'?{status:'visible'}:{status:'deleted'};const {error}=await client.from('comments').update(update).eq('id',b.dataset.id);if(error)message(`Comment action failed: ${error.message}`,'error');else await refreshComments();});
