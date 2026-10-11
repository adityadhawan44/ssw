const form=document.querySelector('#editorial-request-form'),status=document.querySelector('#editorial-request-status');
const say=(text,error=false)=>{status.textContent=text;status.dataset.kind=error?'error':'success';};
form?.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!form.reportValidity())return;
  const config=window.SHWETA_STUDIO_CONFIG||{};
  if(!config.supabaseUrl||!config.supabaseAnonKey){say('The contact service is not connected yet. Please try again later.',true);return;}
  const submit=form.querySelector('button[type="submit"]');submit.disabled=true;say('Sending your enquiry…');
  try{
    const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2');
    const client=createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    const data=new FormData(form);
    const {data:accepted,error}=await client.rpc('submit_editorial_request',{p_kind:data.get('kind'),p_name:data.get('name').trim(),p_email:data.get('email').trim(),p_subject:data.get('subject').trim(),p_url:data.get('url').trim(),p_message:data.get('message').trim(),p_website:data.get('website').trim()});
    if(error)throw error;
    if(!accepted){say('Too many requests from this address. Please wait before trying again.',true);return;}
    form.reset();say('Thank you. Your enquiry has been received for editorial review.');
  }catch(error){say(error.message?.includes('Could not find the function')?'The contact inbox is being connected. Please try again later.':'We could not send your enquiry. Please try again in a few minutes.',true);console.error('Editorial enquiry submission failed.',error);}
  finally{submit.disabled=false;}
});
