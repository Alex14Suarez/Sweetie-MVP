"use strict";
const db=window.sweetieDb;
const byId=id=>document.getElementById(id);
const screen=byId("screen");
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=value=>new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN",maximumFractionDigits:0}).format(value);
const models={refurb:"Dell OptiPlex Micro 7020",fresh:"Dell Pro Micro QCM1250",latitude:"Dell Latitude 5450",pro14:"Dell Pro 14 PC14250"};
const descriptions={
  login:["Ingresa a Sweetie","Usa tu cuenta para consultar el inventario y guardar cotizaciones."],
  perfil:["Mi perfil","Actualiza tus datos y consulta tus cotizaciones guardadas."],
  equipos:["Equipos disponibles","Consulta computadoras, configuraciones, accesorios y existencias."],
  contratos:["Vigencia de contratos","Consulta y registra las fechas de inicio, vencimiento y duración."],
  admin:["Administración","Revisa los indicadores y actualiza el inventario de Sweetie."]
};
let session=null;
let admin=false;
let sequence=0;
let signUp=false;
function notice(message="",error=false){
  const node=byId("status");node.textContent=message;node.hidden=!message;node.classList.toggle("error",error);
}
function errorText(error){
  if(error?.code==="email_not_confirmed")return "Confirma tu correo antes de iniciar sesión.";
  if(error?.code==="email_address_not_authorized"||/email address.*not authorized/i.test(error?.message||""))return "El envío de confirmaciones está limitado a las cuentas autorizadas en este piloto.";
  if(error?.code==="invalid_credentials")return "Revisa tu correo y contraseña.";
  if(error?.code==="over_email_send_rate_limit")return "Se alcanzó el límite de correos de confirmación. Intenta más tarde.";
  if(error?.code==="weak_password")return "Elige una contraseña más segura.";
  if(error?.code==="23505")return "Ese folio ya existe.";
  return "No se pudo completar la operación. Intenta de nuevo.";
}
function must(response){if(response.error)throw response.error;return response.data;}
function route(){return location.hash.slice(1)||"login";}
function setHeader(key){
  const [title,subtitle]=descriptions[key]||descriptions.login;
  byId("title").textContent=title;byId("subtitle").textContent=subtitle;
  document.title=title+" · Sweetie";
  document.querySelectorAll("[data-admin]").forEach(link=>{link.hidden=!admin;});
  document.querySelectorAll("[data-route]").forEach(link=>{
    if(link.dataset.route===key)link.setAttribute("aria-current","page");else link.removeAttribute("aria-current");
  });
  byId("logout").hidden=!session;
}
function table(headers,rows){
  return '<div class="scroll"><table><thead><tr>'+headers.map(x=>"<th>"+x+"</th>").join("")+'</tr></thead><tbody>'+rows.join("")+'</tbody></table></div>';
}
function login(){
  if(session){screen.innerHTML='<section class="card narrow"><h2>Sesión activa</h2><p>'+esc(session.user.email)+'</p><div class="actions"><a class="button primary" href="#perfil">Ir a mi perfil</a><a class="button" href="./">Abrir cotizador</a></div></section>';return;}
  screen.innerHTML='<section class="card narrow"><h2>'+(signUp?"Crear cuenta":"Iniciar sesión")+'</h2><form id="auth-form"><div class="fields"><label>Correo<input name="email" type="email" required autocomplete="email" maxlength="254"></label><label>Contraseña<input name="password" type="password" required minlength="'+(signUp?8:1)+'" autocomplete="'+(signUp?"new-password":"current-password")+'"></label></div><div class="actions"><button class="primary">'+(signUp?"Registrarme":"Entrar")+'</button><button type="button" data-toggle-auth>'+(signUp?"Ya tengo cuenta":"Crear cuenta")+'</button></div></form></section>';
}
async function profile(){
  const [p,q]=await Promise.all([
    db.from("sweetie_profiles").select("display_name,company").eq("user_id",session.user.id).maybeSingle(),
    db.from("sweetie_quotes").select("created_at,company,budget,total,assigned,requested").order("created_at",{ascending:false}).limit(50)
  ]);
  const item=must(p),quotes=must(q);
  const rows=quotes.map(x=>"<tr><td>"+esc(x.company)+"</td><td>"+esc(new Date(x.created_at).toLocaleDateString("es-MX"))+"</td><td>"+x.assigned+" de "+x.requested+"</td><td>"+money(x.budget)+"</td><td>"+money(x.total)+"</td></tr>");
  return '<section class="card narrow"><h2>Datos de mi cuenta</h2><p class="muted">'+esc(session.user.email)+' · '+(admin?"Administrador":"Usuario")+'</p><form id="profile-form"><div class="fields"><label>Nombre<input name="display_name" required maxlength="100" value="'+esc(item?.display_name)+'"></label><label>Empresa<input name="company" maxlength="120" value="'+esc(item?.company)+'"></label></div><div class="actions"><button class="primary">Guardar perfil</button></div></form></section><section class="card"><h2>Mis cotizaciones</h2>'+(rows.length?table(["Empresa","Fecha","Equipos","Presupuesto","Total"],rows):'<p class="muted">Tus cotizaciones guardadas aparecerán aquí.</p><a class="button" href="./">Abrir cotizador</a>')+'</section>';
}
async function getStock(){
  const [e,a]=await Promise.all([
    db.from("sweetie_equipment").select("id,product,tier,ram,ssd,stock,price").order("product").order("ram").order("ssd"),
    db.from("sweetie_accessories").select("accessory,name,stock,price").order("name")
  ]);
  return {equipment:must(e),accessories:must(a)};
}
function stockControls(row,kind,key){
  const label=kind==="equipo"?models[row.product]:row.name;
  return '<td><input data-stock aria-label="Existencias de '+esc(label)+'" type="number" min="0" max="100000" step="1" value="'+row.stock+'"></td><td><input data-price aria-label="Precio de '+esc(label)+'" type="number" min="1" max="10000000" step="1" value="'+row.price+'"></td><td><button data-stock-save data-kind="'+kind+'" data-key="'+esc(key)+'">Guardar</button></td>';
}
function stockTables(stock,editable){
  const equipment=stock.equipment.filter(row=>editable||row.stock>0).map(row=>'<tr><td>'+esc(models[row.product])+'</td><td>'+(['fresh','pro14'].includes(row.product)?"Nuevo":"Reacondicionado")+'</td><td>'+(row.tier==="advanced"?"Análisis":"Operación")+' · '+row.ram+' GB / SSD '+(row.ssd===1024?"1 TB":row.ssd+" GB")+'</td>'+(editable?stockControls(row,"equipo",row.id):'<td>'+row.stock+'</td><td>'+money(row.price)+'</td>')+'</tr>');
  const extras=stock.accessories.filter(row=>editable||row.stock>0).map(row=>'<tr><td>'+esc(row.name)+'</td>'+(editable?stockControls(row,"accesorio",row.accessory):'<td>'+row.stock+'</td><td>'+money(row.price)+'</td>')+'</tr>');
  const metricHeaders=["Existencias","Precio MXN",...(editable?["Cambios"]:[])];
  return '<section class="card"><h2>Computadoras</h2>'+(equipment.length?table(["Modelo","Condición","Configuración",...metricHeaders],equipment):'<p>Sin computadoras disponibles.</p>')+'</section><section class="card"><h2>Accesorios</h2>'+(extras.length?table(["Accesorio",...metricHeaders],extras):'<p>Sin accesorios disponibles.</p>')+'</section>';
}
const contractFields="id,folio,client,starts_on,ends_on,notes";
const today=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Mexico_City",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const termState=(x,now)=>x.starts_on>now?"Programado":x.ends_on<now?"Vencido":"Vigente";
function contractUI(items){
  const now=today();
  const rows=items.map(x=>{
    const days=Math.round((Date.parse(x.ends_on)-Date.parse(x.starts_on))/86400000)+1;
    return '<tr><td>'+esc(x.folio)+'</td><td>'+esc(x.client)+'</td><td>'+esc(x.starts_on)+'</td><td>'+esc(x.ends_on)+'</td><td>'+days+' días</td><td>'+termState(x,now)+'</td><td><button data-edit-contract="'+x.id+'">Editar</button></td></tr>';
  });
  return '<section class="card"><h2 id="contract-form-title">Registrar contrato</h2><form id="contract-form"><input name="record_id" type="hidden"><div class="fields"><label>Folio<input name="folio" required maxlength="60"></label><label>Cliente<input name="client" required maxlength="140"></label><label>Inicio<input name="starts_on" type="date" required></label><label>Vencimiento<input name="ends_on" type="date" required></label></div><label style="margin-top:8px">Notas<textarea name="notes" maxlength="600" rows="2"></textarea></label><div class="actions"><button class="primary">Guardar contrato</button><button type="button" data-clear-contract>Limpiar</button></div></form></section><section class="card"><h2>Contratos registrados</h2>'+(rows.length?table(["Folio","Cliente","Inicio","Vencimiento","Duración","Estado","Acción"],rows):'<p class="muted">Todavía no hay contratos registrados.</p>')+'</section>';
}
let contracts=[];
async function view(key){
  if(key==="perfil")return profile();
  if(key==="equipos")return '<p class="muted">Catálogo inicial con precios y existencias de prueba en MXN.</p>'+stockTables(await getStock(),false);
  if(key==="contratos"){
    contracts=must(await db.from("sweetie_contracts").select(contractFields).order("ends_on"));
    return contractUI(contracts);
  }
  const [stock,list]=await Promise.all([getStock(),db.from("sweetie_contracts").select("starts_on,ends_on")]);
  const active=must(list).filter(x=>termState(x,today())==="Vigente").length;
  const units=stock.equipment.reduce((sum,x)=>sum+x.stock,0);
  return '<section class="card"><h2>Resumen</h2><div class="stats"><div class="stat"><strong>'+units+'</strong>Equipos en inventario</div><div class="stat"><strong>'+stock.equipment.filter(x=>x.stock>0).length+'</strong>Configuraciones disponibles</div><div class="stat"><strong>'+active+'</strong>Contratos vigentes</div></div><div class="actions"><a class="button" href="#contratos">Ver contratos</a></div></section>'+stockTables(stock,true);
}
async function render(){
  const token=++sequence;
  const key=route();
  if(!Object.hasOwn(descriptions,key)){location.hash="login";return;}
  setHeader(key);
  if(key==="login"){login();return;}
  if(!session){screen.innerHTML='<section class="card narrow"><h2>Inicia sesión para continuar</h2><a class="button primary" href="#login">Ir al login</a></section>';return;}
  if((key==="admin"||key==="contratos")&&!admin){screen.innerHTML='<section class="card narrow"><h2>Acceso reservado a administradores</h2><a class="button" href="#perfil">Volver a mi perfil</a></section>';return;}
  screen.innerHTML="<p>Cargando…</p>";
  try{const html=await view(key);if(token===sequence)screen.innerHTML=html;}
  catch(error){if(token===sequence){screen.innerHTML='<p class="status error">'+esc(errorText(error))+'</p>';}}
}
async function identify(next){
  session=next;admin=false;
  if(next){
    const result=await db.rpc("sweetie_admin_status");
    if(session===next)admin=!result.error&&result.data===true;
  }
  await render();
}
function resetContract(){
  byId("contract-form").reset();
  byId("contract-form").elements.record_id.value="";
  byId("contract-form-title").textContent="Registrar contrato";
}
async function perform(button,work){
  if(button)button.disabled=true;
  notice();
  try{await work();}catch(error){notice(errorText(error),true);}
  finally{if(button)button.disabled=false;}
}
screen.addEventListener("submit",event=>{
  event.preventDefault();
  const form=event.target, values=Object.fromEntries(new FormData(form));
  void perform(event.submitter,async()=>{
    if(form.id==="auth-form"){
      if(signUp){
        const result=must(await db.auth.signUp({email:values.email,password:values.password,
          options:{emailRedirectTo:new URL("cuenta.html",location.href).href}}));
        if(result.session){await identify(result.session);location.hash="perfil";}
        else {form.reset();notice("Si el correo puede registrarse, recibirás un enlace de confirmación.");}
      }else{
        const result=must(await db.auth.signInWithPassword({email:values.email,password:values.password}));
        await identify(result.session);location.hash="perfil";
      }
      return;
    }
    if(form.id==="profile-form"){
      const display_name=values.display_name.trim();
      if(!display_name){notice("Escribe tu nombre.",true);return;}
      const record={user_id:session.user.id,display_name,company:values.company.trim()};
      const current=must(await db.from("sweetie_profiles").select("user_id").eq("user_id",session.user.id).maybeSingle());
      if(current)must(await db.from("sweetie_profiles").update({display_name,company:record.company}).eq("user_id",record.user_id).select("user_id").single());
      else must(await db.from("sweetie_profiles").insert(record).select("user_id").single());
      notice("Guardé tu perfil.");return;
    }
    if(form.id==="contract-form"&&admin){
      const {record_id,...record}=values;
      record.client=record.client.trim();record.folio=record.folio.trim();record.notes=record.notes.trim();
      if(!record.client||!record.folio||record.ends_on<record.starts_on){notice("Revisa el folio, el cliente y las fechas.",true);return;}
      const query=record_id?db.from("sweetie_contracts").update(record).eq("id",record_id):db.from("sweetie_contracts").insert(record);
      must(await query.select("id").single());await render();notice("Guardé el contrato.");
    }
  });
});
screen.addEventListener("click",event=>{
  const button=event.target.closest("button");
  if(!button)return;
  if(button.hasAttribute("data-toggle-auth")){signUp=!signUp;notice();login();return;}
  if(button.hasAttribute("data-clear-contract")){resetContract();return;}
  if(button.dataset.editContract&&admin){
    const record=contracts.find(x=>x.id===button.dataset.editContract);if(!record)return;
    const form=byId("contract-form");
    for(const field of ["folio","client","starts_on","ends_on","notes"])form.elements[field].value=record[field];
    form.elements.record_id.value=record.id;byId("contract-form-title").textContent="Editar contrato";
    form.elements.folio.focus();return;
  }
  if(button.hasAttribute("data-stock-save")&&admin){
    const row=button.closest("tr"),stock=row.querySelector("[data-stock]"),price=row.querySelector("[data-price]");
    if(!stock.value||!price.value||!stock.reportValidity()||!price.reportValidity()){notice("Revisa las existencias y el precio.",true);return;}
    const equipment=button.dataset.kind==="equipo";
    const tableName=equipment?"sweetie_equipment":"sweetie_accessories", key=equipment?"id":"accessory";
    void perform(button,async()=>{
      must(await db.from(tableName).update({stock:Number(stock.value),price:Number(price.value)}).eq(key,button.dataset.key).select(key).single());
      await render();notice("Guardé los cambios de inventario.");
    });
  }
});
byId("logout").addEventListener("click",event=>void perform(event.currentTarget,async()=>{
  must(await db.auth.signOut());await identify(null);location.hash="login";
}));
window.addEventListener("hashchange",()=>{notice();void render();});
async function start(){
  if(!db){screen.innerHTML='<p class="status error">No se pudo cargar la conexión con Supabase. Recarga la página.</p>';return;}
  try{
    const active=must(await db.auth.getSession());
    await identify(active.session);
    db.auth.onAuthStateChange((event,next)=>{
      if(event!=="SIGNED_OUT"&&event!=="SIGNED_IN")return;
      if(next?.user.id===session?.user.id&&Boolean(next)===Boolean(session))return;
      setTimeout(()=>void identify(next),0);
    });
  }catch(error){screen.innerHTML='<p class="status error">'+esc(errorText(error))+'</p>';}
}
void start();
